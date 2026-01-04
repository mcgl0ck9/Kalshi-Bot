/**
 * Real-Time Monitoring Module
 *
 * Provides WebSocket streaming and unusual activity detection for Polymarket:
 * - PolymarketStream: WebSocket client for orderbook and trade updates
 * - UnusualActivityDetector: Detects whales, flash moves, volume spikes
 * - VelocityTracker: Monitors rate-of-change for momentum detection
 *
 * Usage:
 * ```typescript
 * import { connectPolymarketStream, createUnusualActivityDetector } from './realtime';
 *
 * const detector = createUnusualActivityDetector();
 * const stream = await connectPolymarketStream(tokenIds, {
 *   onBook: (update) => detector.processBookUpdate(update),
 *   onTrade: (update) => detector.processTradeUpdate(update),
 *   onPriceChange: (event) => detector.processPriceChange(event),
 * });
 *
 * detector.on('alert', (alert) => {
 *   console.log('Unusual activity:', alert);
 * });
 * ```
 */

// WebSocket Stream Client
export {
  PolymarketStream,
  createPolymarketStream,
  connectPolymarketStream,
  type StreamConfig,
  type OrderbookUpdate,
  type TradeUpdate,
  type PriceChangeEvent,
  type StreamEventType,
} from './polymarket-stream.js';

// Unusual Activity Detection
export {
  UnusualActivityDetector,
  createUnusualActivityDetector,
  DEFAULT_CONFIG as DEFAULT_UNUSUAL_ACTIVITY_CONFIG,
  type UnusualActivityConfig,
  type UnusualActivityType,
  type UnusualActivityAlert,
} from './unusual-activity.js';

// Velocity Tracking
export {
  VelocityTracker,
  MarketVelocityMonitor,
  createVelocityTracker,
  createMarketVelocityMonitor,
  type VelocityPoint,
  type VelocityMetrics,
  type VelocityTrackerConfig,
  type MarketVelocityState,
} from './velocity-tracker.js';

// =============================================================================
// INTEGRATED MONITORING
// =============================================================================

import { PolymarketStream, createPolymarketStream } from './polymarket-stream.js';
import { UnusualActivityDetector, createUnusualActivityDetector, type UnusualActivityAlert } from './unusual-activity.js';
import { MarketVelocityMonitor, createMarketVelocityMonitor } from './velocity-tracker.js';
import { logger } from '../utils/index.js';

export interface RealtimeMonitorConfig {
  tokenIds: string[];
  marketTitles?: Map<string, string>;
  onAlert?: (alert: UnusualActivityAlert) => void;
  autoReconnect?: boolean;
}

/**
 * Integrated real-time monitoring system
 *
 * Combines WebSocket streaming, unusual activity detection, and velocity tracking
 * into a single easy-to-use interface.
 */
export class RealtimeMonitor {
  private stream: PolymarketStream;
  private detector: UnusualActivityDetector;
  private velocityMonitor: MarketVelocityMonitor;
  private alertCallback?: (alert: UnusualActivityAlert) => void;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RealtimeMonitorConfig) {
    this.alertCallback = config.onAlert;

    // Create detector
    this.detector = createUnusualActivityDetector();

    // Set market titles for better alerts
    if (config.marketTitles) {
      for (const [assetId, title] of config.marketTitles) {
        this.detector.setMarketTitle(assetId, title);
      }
    }

    // Create velocity monitor
    this.velocityMonitor = createMarketVelocityMonitor();

    // Create stream with handlers
    this.stream = createPolymarketStream(config.tokenIds, {
      autoReconnect: config.autoReconnect ?? true,
      onBook: (update) => {
        const alerts = this.detector.processBookUpdate(update);
        alerts.forEach(alert => this.handleAlert(alert));
      },
      onTrade: (update) => {
        const alerts = this.detector.processTradeUpdate(update);
        alerts.forEach(alert => this.handleAlert(alert));

        // Track velocity
        const price = parseFloat(update.price);
        const size = parseFloat(update.size);
        this.velocityMonitor.recordTrade(update.asset_id, price, price * size);
      },
      onPriceChange: (event) => {
        const alert = this.detector.processPriceChange(event);
        if (alert) this.handleAlert(alert);

        // Track velocity
        this.velocityMonitor.recordPrice(event.asset_id, event.newPrice);
      },
      onConnect: () => {
        logger.info('RealtimeMonitor connected');
      },
      onDisconnect: () => {
        logger.warn('RealtimeMonitor disconnected');
      },
      onError: (error) => {
        logger.error(`RealtimeMonitor error: ${error.message}`);
      },
    });

    // Wire up detector alerts
    this.detector.on('alert', (alert: UnusualActivityAlert) => {
      this.handleAlert(alert);
    });
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    await this.stream.connect();

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.detector.cleanup();
    }, 60000); // Every minute

    logger.info(`RealtimeMonitor started, watching ${this.stream.getSubscribedCount()} markets`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.stream.disconnect();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.velocityMonitor.clear();
    logger.info('RealtimeMonitor stopped');
  }

  /**
   * Add markets to monitor
   */
  addMarkets(tokenIds: string[], titles?: Map<string, string>): void {
    this.stream.subscribeToMarkets(tokenIds);

    if (titles) {
      for (const [assetId, title] of titles) {
        this.detector.setMarketTitle(assetId, title);
      }
    }
  }

  /**
   * Remove markets from monitoring
   */
  removeMarkets(tokenIds: string[]): void {
    this.stream.unsubscribeFromMarkets(tokenIds);
  }

  /**
   * Get velocity state for a market
   */
  getMarketVelocity(marketId: string) {
    return this.velocityMonitor.getMarketState(marketId);
  }

  /**
   * Get all markets with unusual velocity
   */
  getUnusualVelocityMarkets() {
    return this.velocityMonitor.getUnusualMarkets();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.stream.isConnected();
  }

  /**
   * Get subscribed market count
   */
  getSubscribedCount(): number {
    return this.stream.getSubscribedCount();
  }

  private handleAlert(alert: UnusualActivityAlert): void {
    this.alertCallback?.(alert);
  }
}

/**
 * Create and start a real-time monitor
 */
export async function startRealtimeMonitor(
  config: RealtimeMonitorConfig
): Promise<RealtimeMonitor> {
  const monitor = new RealtimeMonitor(config);
  await monitor.start();
  return monitor;
}
