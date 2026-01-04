/**
 * Polymarket WebSocket Stream Client
 *
 * Real-time orderbook and price monitoring using Polymarket's CLOB WebSocket API.
 *
 * Based on:
 * - polymarket-websocket-client (GitHub: discountry)
 * - Polymarket CLOB documentation
 *
 * Key insight: WebSocket provides millisecond-level updates for:
 * - Orderbook changes (bids/asks)
 * - Trade executions
 * - Price movements
 *
 * This enables detection of:
 * - Flash moves (sudden price spikes)
 * - Whale entries (large position builds)
 * - Orderbook imbalances (upcoming moves)
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const POLYMARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

// =============================================================================
// TYPES
// =============================================================================

export interface OrderbookUpdate {
  type: 'book';
  market: string;
  asset_id: string;
  timestamp: number;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

export interface TradeUpdate {
  type: 'trade' | 'last_trade_price';
  market: string;
  asset_id: string;
  timestamp: number;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  maker?: string;
  taker?: string;
}

export interface PriceChangeEvent {
  type: 'price_change';
  market: string;
  asset_id: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  timestamp: number;
}

export interface StreamConfig {
  markets: string[];              // Token IDs to monitor
  autoReconnect?: boolean;
  heartbeatInterval?: number;
  onBook?: (event: OrderbookUpdate) => void;
  onTrade?: (event: TradeUpdate) => void;
  onPriceChange?: (event: PriceChangeEvent) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export type StreamEventType = 'book' | 'trade' | 'price_change' | 'connect' | 'disconnect' | 'error';

// =============================================================================
// POLYMARKET STREAM CLIENT
// =============================================================================

export class PolymarketStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: StreamConfig;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private lastPrices: Map<string, number> = new Map();
  private subscribedMarkets: Set<string> = new Set();

  constructor(config: StreamConfig) {
    super();
    this.config = {
      autoReconnect: true,
      heartbeatInterval: HEARTBEAT_INTERVAL_MS,
      ...config,
    };
  }

  /**
   * Connect to the WebSocket stream
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      logger.debug('WebSocket already connected or connecting');
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(POLYMARKET_WS_URL);

        this.ws.on('open', () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          logger.info('Polymarket WebSocket connected');

          // Subscribe to configured markets
          this.subscribeToMarkets(this.config.markets);

          // Start heartbeat
          this.startHeartbeat();

          this.emit('connect');
          this.config.onConnect?.();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          this.isConnecting = false;
          logger.error(`WebSocket error: ${error.message}`);
          this.emit('error', error);
          this.config.onError?.(error);
          reject(error);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.isConnecting = false;
          this.stopHeartbeat();
          logger.warn(`WebSocket closed: ${code} - ${reason.toString()}`);

          this.emit('disconnect');
          this.config.onDisconnect?.();

          // Auto-reconnect if enabled
          if (this.config.autoReconnect && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.scheduleReconnect();
          }
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket stream
   */
  disconnect(): void {
    this.config.autoReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribedMarkets.clear();
    logger.info('Polymarket WebSocket disconnected');
  }

  /**
   * Subscribe to market updates
   */
  subscribeToMarkets(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe: WebSocket not connected');
      return;
    }

    for (const tokenId of tokenIds) {
      if (this.subscribedMarkets.has(tokenId)) continue;

      // Subscribe message format for Polymarket CLOB
      const subscribeMsg = JSON.stringify({
        type: 'subscribe',
        channel: 'market',
        markets: [tokenId],
      });

      this.ws.send(subscribeMsg);
      this.subscribedMarkets.add(tokenId);
      logger.debug(`Subscribed to market: ${tokenId}`);
    }
  }

  /**
   * Unsubscribe from market updates
   */
  unsubscribeFromMarkets(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const tokenId of tokenIds) {
      if (!this.subscribedMarkets.has(tokenId)) continue;

      const unsubscribeMsg = JSON.stringify({
        type: 'unsubscribe',
        channel: 'market',
        markets: [tokenId],
      });

      this.ws.send(unsubscribeMsg);
      this.subscribedMarkets.delete(tokenId);
      this.lastPrices.delete(tokenId);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get subscribed market count
   */
  getSubscribedCount(): number {
    return this.subscribedMarkets.size;
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle different message types
      switch (message.type) {
        case 'book':
          this.handleBookUpdate(message);
          break;

        case 'trade':
        case 'last_trade_price':
          this.handleTradeUpdate(message);
          break;

        case 'price_change':
          this.handlePriceChange(message);
          break;

        case 'subscribed':
          logger.debug(`Subscription confirmed: ${message.market || message.markets}`);
          break;

        case 'heartbeat':
        case 'pong':
          // Heartbeat response, connection is alive
          break;

        default:
          // Try to detect price changes from book updates
          if (message.bids || message.asks) {
            this.handleBookUpdate(message);
          }
      }
    } catch (error) {
      logger.error(`Failed to parse WebSocket message: ${error}`);
    }
  }

  private handleBookUpdate(message: OrderbookUpdate): void {
    const event: OrderbookUpdate = {
      type: 'book',
      market: message.market || message.asset_id,
      asset_id: message.asset_id,
      timestamp: message.timestamp || Date.now(),
      bids: message.bids || [],
      asks: message.asks || [],
    };

    this.emit('book', event);
    this.config.onBook?.(event);

    // Detect price changes from orderbook
    if (event.bids.length > 0 || event.asks.length > 0) {
      const bestBid = event.bids[0] ? parseFloat(event.bids[0].price) : 0;
      const bestAsk = event.asks[0] ? parseFloat(event.asks[0].price) : 1;
      const midPrice = (bestBid + bestAsk) / 2;

      this.checkPriceChange(event.asset_id, midPrice, event.timestamp);
    }
  }

  private handleTradeUpdate(message: TradeUpdate): void {
    const event: TradeUpdate = {
      type: message.type || 'trade',
      market: message.market || message.asset_id,
      asset_id: message.asset_id,
      timestamp: message.timestamp || Date.now(),
      price: message.price,
      size: message.size,
      side: message.side,
      maker: message.maker,
      taker: message.taker,
    };

    this.emit('trade', event);
    this.config.onTrade?.(event);

    // Update last price and check for significant moves
    const price = parseFloat(message.price);
    this.checkPriceChange(event.asset_id, price, event.timestamp);
  }

  private handlePriceChange(message: PriceChangeEvent): void {
    this.emit('price_change', message);
    this.config.onPriceChange?.(message);
  }

  private checkPriceChange(assetId: string, newPrice: number, timestamp: number): void {
    const oldPrice = this.lastPrices.get(assetId);

    if (oldPrice !== undefined && oldPrice > 0) {
      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

      // Emit price change event if significant (>1%)
      if (Math.abs(changePercent) >= 1) {
        const event: PriceChangeEvent = {
          type: 'price_change',
          market: assetId,
          asset_id: assetId,
          oldPrice,
          newPrice,
          changePercent,
          timestamp,
        };

        this.emit('price_change', event);
        this.config.onPriceChange?.(event);
      }
    }

    this.lastPrices.set(assetId, newPrice);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 5);

    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    setTimeout(() => {
      this.connect().catch(error => {
        logger.error(`Reconnection failed: ${error.message}`);
      });
    }, delay);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Polymarket stream client with default configuration
 */
export function createPolymarketStream(
  markets: string[],
  options?: Partial<StreamConfig>
): PolymarketStream {
  return new PolymarketStream({
    markets,
    autoReconnect: true,
    heartbeatInterval: HEARTBEAT_INTERVAL_MS,
    ...options,
  });
}

/**
 * Create and connect a stream client
 */
export async function connectPolymarketStream(
  markets: string[],
  options?: Partial<StreamConfig>
): Promise<PolymarketStream> {
  const stream = createPolymarketStream(markets, options);
  await stream.connect();
  return stream;
}
