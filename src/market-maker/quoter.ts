/**
 * Market Maker Quoting Engine
 *
 * Calculates bid/ask prices with:
 * 1. Base spread (configurable, default 3¢)
 * 2. Inventory-based skew (widen away from overweight side)
 * 3. Volatility scaling (widen on rapid price moves)
 *
 * All orders use post_only: true to ensure maker-only fills.
 */

import { type DiscoveredMarket } from './discovery.js';
import { getOrderbook, type Orderbook } from './kalshi-orders.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface QuoteParams {
  baseSpreadCents: number;       // Base spread in cents (default 3)
  inventoryLimit: number;        // Position that triggers widening
  maxSkewCents: number;          // Maximum inventory skew in cents
  volatilityWindow: number;      // Lookback for volatility calc (# of observations)
}

export interface Quote {
  ticker: string;
  bidSide: 'yes' | 'no';
  bidPrice: number;              // In cents (1-99)
  bidQuantity: number;
  askSide: 'yes' | 'no';
  askPrice: number;              // In cents (1-99)
  askQuantity: number;
  midPrice: number;
  spread: number;
}

export interface InventoryState {
  /** Net YES position (positive = long YES, negative = short / long NO) */
  position: number;
}

// =============================================================================
// DEFAULT PARAMETERS
// =============================================================================

const DEFAULT_PARAMS: QuoteParams = {
  baseSpreadCents: 3,
  inventoryLimit: 30,
  maxSkewCents: 4,
  volatilityWindow: 20,
};

// Price history for volatility tracking
const priceHistory: Map<string, number[]> = new Map();

// =============================================================================
// QUOTING LOGIC
// =============================================================================

/**
 * Calculate bid/ask quotes for a market.
 *
 * @param market - Discovered market with current bid/ask
 * @param inventory - Current inventory state
 * @param params - Quoting parameters
 * @returns Quote with bid and ask prices, or null if can't quote
 */
export function calculateQuote(
  market: DiscoveredMarket,
  inventory: InventoryState,
  params: QuoteParams = DEFAULT_PARAMS,
): Quote | null {
  const mid = market.midPrice;
  if (mid <= 0 || mid >= 100) return null;

  // --- Base half-spread ---
  const halfSpread = Math.ceil(params.baseSpreadCents / 2);

  // --- Inventory skew ---
  // If we're long YES, widen the ask (make it harder to buy more YES)
  // If we're short (long NO), widen the bid
  const inventoryRatio = Math.min(1, Math.abs(inventory.position) / params.inventoryLimit);
  const skew = Math.round(inventoryRatio * params.maxSkewCents);
  const yesSkew = inventory.position > 0 ? skew : 0;    // Push ask up if long YES
  const noSkew = inventory.position < 0 ? skew : 0;     // Push bid down if short

  // --- Volatility scaling ---
  const volMultiplier = calculateVolatilityMultiplier(market.ticker, mid, params);

  // --- Final bid/ask ---
  const effectiveHalfSpread = Math.max(1, Math.round(halfSpread * volMultiplier));

  let bidPrice = mid - effectiveHalfSpread - noSkew;
  let askPrice = mid + effectiveHalfSpread + yesSkew;

  // Clamp to valid range
  bidPrice = Math.max(1, Math.min(98, bidPrice));
  askPrice = Math.max(2, Math.min(99, askPrice));

  // Ensure bid < ask
  if (bidPrice >= askPrice) {
    bidPrice = Math.max(1, askPrice - 2);
  }

  // --- Quantity sizing ---
  // Reduce quantity as position approaches limit
  const positionHeadroom = params.inventoryLimit - Math.abs(inventory.position);
  const baseQty = 5;  // Base quantity per side
  const quantity = Math.max(1, Math.min(baseQty, positionHeadroom));

  // Update price history for volatility tracking
  recordPrice(market.ticker, mid);

  return {
    ticker: market.ticker,
    bidSide: 'yes',
    bidPrice,
    bidQuantity: quantity,
    askSide: 'yes',
    askPrice,
    askQuantity: quantity,
    midPrice: mid,
    spread: askPrice - bidPrice,
  };
}

/**
 * Calculate quotes for multiple markets.
 */
export function calculateQuotes(
  markets: DiscoveredMarket[],
  inventories: Map<string, InventoryState>,
  params: QuoteParams = DEFAULT_PARAMS,
): Quote[] {
  const quotes: Quote[] = [];

  for (const market of markets) {
    const inventory = inventories.get(market.ticker) ?? { position: 0 };
    const quote = calculateQuote(market, inventory, params);
    if (quote) {
      quotes.push(quote);
    }
  }

  return quotes;
}

/**
 * Refresh market mid prices from orderbook.
 * Updates the DiscoveredMarket in-place with fresh bid/ask.
 */
export async function refreshMarketPrices(markets: DiscoveredMarket[]): Promise<void> {
  // Fetch orderbooks in batches to respect rate limits
  const batchSize = 5;
  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (market) => {
        try {
          const book = await getOrderbook(market.ticker);
          if (book) {
            updateMarketFromOrderbook(market, book);
          }
        } catch (e) {
          logger.debug(`Orderbook fetch error for ${market.ticker}: ${e}`);
        }
      })
    );

    // Small delay between batches
    if (i + batchSize < markets.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function updateMarketFromOrderbook(market: DiscoveredMarket, book: Orderbook): void {
  // Best YES bid = highest price someone will buy YES at
  const bestYesBid = book.yes?.[0]?.price ?? 0;
  // Best YES ask = 100 - best NO bid (since buying NO at X = selling YES at 100-X)
  const bestNoBid = book.no?.[0]?.price ?? 0;
  const bestYesAsk = bestNoBid > 0 ? (100 - bestNoBid) : 0;

  if (bestYesBid > 0) market.yesBid = bestYesBid;
  if (bestYesAsk > 0) market.yesAsk = bestYesAsk;
  if (bestYesBid > 0 && bestYesAsk > 0) {
    market.spread = bestYesAsk - bestYesBid;
    market.midPrice = Math.round((bestYesBid + bestYesAsk) / 2);
  }
}

function calculateVolatilityMultiplier(
  ticker: string,
  currentMid: number,
  params: QuoteParams,
): number {
  const history = priceHistory.get(ticker);
  if (!history || history.length < 3) return 1.0;

  // Calculate recent price standard deviation
  const recent = history.slice(-params.volatilityWindow);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const stdDev = Math.sqrt(variance);

  // Normalize: 2¢ std dev = normal, scale linearly above
  const normalVol = 2;
  if (stdDev <= normalVol) return 1.0;

  // Cap at 2x widening
  return Math.min(2.0, stdDev / normalVol);
}

function recordPrice(ticker: string, price: number): void {
  const history = priceHistory.get(ticker) ?? [];
  history.push(price);
  // Keep last 100 observations
  if (history.length > 100) history.shift();
  priceHistory.set(ticker, history);
}
