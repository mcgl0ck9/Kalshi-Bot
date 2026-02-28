/**
 * Kalshi Order Placement Layer
 *
 * Provides authenticated order management for the Kalshi Trading API v2.
 * Uses the existing RSA-SHA256 auth infrastructure from kalshi-auth.ts.
 *
 * Endpoints:
 *   POST   /trade-api/v2/portfolio/orders          - Place order
 *   DELETE /trade-api/v2/portfolio/orders/{id}      - Cancel order
 *   GET    /trade-api/v2/portfolio/orders           - List orders
 *   GET    /trade-api/v2/portfolio/positions         - Get positions
 *   GET    /trade-api/v2/portfolio/balance           - Get balance
 *   GET    /trade-api/v2/markets/{ticker}/orderbook  - Get orderbook
 */

import { kalshiFetch, kalshiFetchJson, hasKalshiAuth } from '../utils/kalshi-auth.js';
import { logger } from '../utils/index.js';
import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface OrderRequest {
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  /** Price in cents (1-99) */
  yes_price?: number;
  no_price?: number;
  client_order_id?: string;
  time_in_force?: 'fill_or_kill' | 'good_till_canceled' | 'immediate_or_cancel';
  /** If true, order only rests on book (never crosses spread) */
  post_only?: boolean;
  /** Expiration as Unix timestamp in seconds */
  expiration_ts?: number;
}

export interface OrderResponse {
  order: {
    order_id: string;
    client_order_id?: string;
    ticker: string;
    side: string;
    action: string;
    status: string;
    yes_price: number;
    no_price: number;
    count: number;
    remaining_count: number;
    place_count: number;
    created_time: string;
    updated_time: string;
  };
}

export interface CancelResponse {
  order: {
    order_id: string;
    status: string;
  };
  reduced_by: number;
}

export interface Position {
  ticker: string;
  position: number;          // Net position (positive = long, negative = short)
  total_traded: number;
  market_exposure: number;
  realized_pnl: number;
  fees_paid: number;
}

export interface PortfolioPositions {
  market_positions: Position[];
  cursor?: string;
}

export interface Balance {
  balance: number;           // Available balance in cents
  portfolio_value: number;   // Current portfolio value in cents
}

export interface OrderbookLevel {
  price: number;             // In cents (1-99)
  quantity: number;
}

export interface Orderbook {
  yes: OrderbookLevel[];     // YES side bids (sorted high to low)
  no: OrderbookLevel[];      // NO side bids (sorted high to low)
}

export interface OpenOrder {
  order_id: string;
  ticker: string;
  side: string;
  action: string;
  status: string;
  yes_price: number;
  no_price: number;
  count: number;
  remaining_count: number;
  created_time: string;
}

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

/**
 * Place a limit order on Kalshi.
 *
 * For market making, always use post_only: true to ensure we're the maker.
 */
export async function placeOrder(req: OrderRequest): Promise<OrderResponse | null> {
  if (!hasKalshiAuth()) {
    logger.error('Cannot place order: Kalshi auth not configured');
    return null;
  }

  const body = {
    ticker: req.ticker,
    side: req.side,
    action: req.action,
    count: req.count,
    ...(req.yes_price !== undefined && { yes_price: req.yes_price }),
    ...(req.no_price !== undefined && { no_price: req.no_price }),
    client_order_id: req.client_order_id ?? crypto.randomUUID(),
    time_in_force: req.time_in_force ?? 'good_till_canceled',
    ...(req.post_only !== undefined && { post_only: req.post_only }),
    ...(req.expiration_ts !== undefined && { expiration_ts: req.expiration_ts }),
  };

  logger.debug(`Placing order: ${req.action} ${req.count}x ${req.ticker} ${req.side} @ ${req.yes_price ?? req.no_price}¢`);

  const response = await kalshiFetch('/trade-api/v2/portfolio/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response) {
    logger.error('Order placement failed: no response');
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    logger.error(`Order placement failed: ${response.status} - ${errorText.substring(0, 300)}`);
    return null;
  }

  const result = await response.json() as OrderResponse;
  logger.info(`Order placed: ${result.order.order_id} ${req.action} ${req.count}x ${req.ticker} ${req.side} @ ${req.yes_price ?? req.no_price}¢`);
  return result;
}

/**
 * Cancel an order by ID.
 */
export async function cancelOrder(orderId: string): Promise<CancelResponse | null> {
  if (!hasKalshiAuth()) {
    logger.error('Cannot cancel order: Kalshi auth not configured');
    return null;
  }

  const response = await kalshiFetch(`/trade-api/v2/portfolio/orders/${orderId}`, {
    method: 'DELETE',
  });

  if (!response) {
    logger.error(`Cancel failed for ${orderId}: no response`);
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    logger.error(`Cancel failed for ${orderId}: ${response.status} - ${errorText.substring(0, 200)}`);
    return null;
  }

  const result = await response.json() as CancelResponse;
  logger.debug(`Cancelled order ${orderId}, reduced_by: ${result.reduced_by}`);
  return result;
}

/**
 * Cancel all open orders. Used during shutdown.
 */
export async function cancelAllOrders(): Promise<number> {
  const orders = await getOpenOrders();
  if (!orders || orders.length === 0) return 0;

  let cancelled = 0;
  for (const order of orders) {
    const result = await cancelOrder(order.order_id);
    if (result) cancelled++;
    // Small delay to respect rate limits (10 writes/sec basic tier)
    await new Promise(r => setTimeout(r, 120));
  }

  logger.info(`Cancelled ${cancelled}/${orders.length} open orders`);
  return cancelled;
}

// =============================================================================
// PORTFOLIO QUERIES
// =============================================================================

/**
 * Get all open orders.
 */
export async function getOpenOrders(): Promise<OpenOrder[]> {
  const data = await kalshiFetchJson<{ orders?: OpenOrder[] }>(
    '/trade-api/v2/portfolio/orders?status=resting'
  );
  return data?.orders ?? [];
}

/**
 * Get current positions.
 */
export async function getPositions(): Promise<Position[]> {
  const data = await kalshiFetchJson<PortfolioPositions>(
    '/trade-api/v2/portfolio/positions?count_filter=position&limit=200'
  );
  return data?.market_positions ?? [];
}

/**
 * Get position for a specific ticker.
 */
export async function getPosition(ticker: string): Promise<Position | null> {
  const data = await kalshiFetchJson<PortfolioPositions>(
    `/trade-api/v2/portfolio/positions?ticker=${ticker}`
  );
  const positions = data?.market_positions ?? [];
  return positions.length > 0 ? positions[0] : null;
}

/**
 * Get account balance.
 */
export async function getBalance(): Promise<Balance | null> {
  return kalshiFetchJson<Balance>('/trade-api/v2/portfolio/balance');
}

// =============================================================================
// MARKET DATA
// =============================================================================

/**
 * Get orderbook for a specific market.
 */
export async function getOrderbook(ticker: string): Promise<Orderbook | null> {
  const data = await kalshiFetchJson<{ orderbook?: Orderbook }>(
    `/trade-api/v2/markets/${ticker}/orderbook`
  );
  return data?.orderbook ?? null;
}

/**
 * Get detailed market info including yes_bid, yes_ask, volume, OI.
 */
export async function getMarketDetail(ticker: string): Promise<Record<string, unknown> | null> {
  return kalshiFetchJson<Record<string, unknown>>(
    `/trade-api/v2/markets/${ticker}`
  );
}
