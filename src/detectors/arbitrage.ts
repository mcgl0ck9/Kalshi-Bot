/**
 * Spread Arbitrage Edge Detector (v4)
 *
 * Detects guaranteed profit opportunities when YES + NO < $1.00.
 * In prediction markets, buying both YES and NO guarantees $1.00 payout.
 * When the combined cost is less than $1.00, it's a risk-free arbitrage.
 *
 * Important: These opportunities are rare and close quickly.
 * Fees must be considered - Kalshi charges ceil(0.07 x contracts x price x (1-price))
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Kalshi fee formula: ceil(0.07 x contracts x price x (1-price))
const KALSHI_FEE_RATE = 0.07;

// Minimum net profit per contract after fees (in dollars)
const MIN_NET_PROFIT = 0.01; // 1 cent minimum

// Minimum profit percentage to report
const MIN_PROFIT_PERCENT = 0.5; // 0.5% minimum

// Standard lot size for fee calculations
const STANDARD_LOT_SIZE = 100;

// =============================================================================
// TYPES
// =============================================================================

interface MarketWithOrderbook extends Market {
  yesAsk?: number;
  noAsk?: number;
  outcomes?: Array<{
    outcome: string;
    price: number;
  }>;
}

interface ArbitrageSignal {
  type: 'arbitrage';
  yesPrice: number;
  noPrice: number;
  totalCost: number;
  grossProfit: number;
  grossProfitPercent: number;
  feeEstimate: number;
  netProfit: number;
  netProfitPercent: number;
  guaranteed: true;
  action: string;
  [key: string]: unknown;  // Index signature for EdgeSignal compatibility
}

// =============================================================================
// FEE CALCULATION
// =============================================================================

/**
 * Calculate Kalshi fee for a trade
 * Formula: ceil(0.07 x contracts x price x (1-price))
 */
function calculateKalshiFee(contracts: number, price: number): number {
  const rawFee = KALSHI_FEE_RATE * contracts * price * (1 - price);
  return Math.ceil(rawFee * 100) / 100; // Ceiling to nearest cent
}

/**
 * Calculate total fees for spread arbitrage (buying both sides)
 */
function calculateSpreadArbitrageFees(
  contracts: number,
  yesPrice: number,
  noPrice: number
): number {
  const yesFee = calculateKalshiFee(contracts, yesPrice);
  const noFee = calculateKalshiFee(contracts, noPrice);
  return yesFee + noFee;
}

// =============================================================================
// ARBITRAGE DETECTION
// =============================================================================

/**
 * Extract YES and NO ask prices from market data
 */
function extractPrices(market: MarketWithOrderbook): { yesPrice: number; noPrice: number } | null {
  // Try explicit yesAsk/noAsk fields first
  if (market.yesAsk !== undefined && market.noAsk !== undefined) {
    return { yesPrice: market.yesAsk, noPrice: market.noAsk };
  }

  // Try outcomes array (common format from API)
  if (market.outcomes && market.outcomes.length === 2) {
    const yesOutcome = market.outcomes.find(
      (o) => o.outcome.toLowerCase() === 'yes'
    );
    const noOutcome = market.outcomes.find(
      (o) => o.outcome.toLowerCase() === 'no'
    );

    if (yesOutcome && noOutcome) {
      return { yesPrice: yesOutcome.price, noPrice: noOutcome.price };
    }
  }

  // Fallback: use market price for YES and derive NO
  // This is less accurate as it assumes mid-market, not actual asks
  if (market.price !== undefined) {
    return { yesPrice: market.price, noPrice: 1 - market.price };
  }

  return null;
}

/**
 * Check if a market has a spread arbitrage opportunity
 */
function checkArbitrage(market: MarketWithOrderbook): Edge | null {
  const prices = extractPrices(market);
  if (!prices) {
    return null;
  }

  const { yesPrice, noPrice } = prices;
  const totalCost = yesPrice + noPrice;

  // No arbitrage if combined cost >= $1.00
  if (totalCost >= 1.0) {
    return null;
  }

  const grossProfit = 1.0 - totalCost;
  const grossProfitPercent = (grossProfit / totalCost) * 100;

  // Calculate fees for standard lot
  const totalFees = calculateSpreadArbitrageFees(STANDARD_LOT_SIZE, yesPrice, noPrice);
  const feePerContract = totalFees / STANDARD_LOT_SIZE;
  const netProfit = grossProfit - feePerContract;
  const netProfitPercent = (netProfit / totalCost) * 100;

  // Check if profitable after fees
  if (netProfit < MIN_NET_PROFIT) {
    logger.debug(
      `Arbitrage: ${market.ticker || market.id} - profitable before fees ($${grossProfit.toFixed(3)}) ` +
      `but not after ($${netProfit.toFixed(3)})`
    );
    return null;
  }

  if (netProfitPercent < MIN_PROFIT_PERCENT) {
    logger.debug(
      `Arbitrage: ${market.ticker || market.id} - profit percent ${netProfitPercent.toFixed(2)}% ` +
      `below threshold ${MIN_PROFIT_PERCENT}%`
    );
    return null;
  }

  const action = `Buy YES @ ${(yesPrice * 100).toFixed(0)}c + NO @ ${(noPrice * 100).toFixed(0)}c`;
  const reason =
    `Guaranteed arbitrage: Combined cost ${(totalCost * 100).toFixed(0)}c < $1.00 payout. ` +
    `Net profit: ${(netProfit * 100).toFixed(1)}c per contract after Kalshi fees (~${(feePerContract * 100).toFixed(1)}c).`;

  const signal: ArbitrageSignal = {
    type: 'arbitrage',
    yesPrice,
    noPrice,
    totalCost,
    grossProfit,
    grossProfitPercent,
    feeEstimate: feePerContract,
    netProfit,
    netProfitPercent,
    guaranteed: true,
    action,
  };

  // Arbitrage is always 100% confidence and critical urgency
  return createEdge(
    market,
    'YES', // Primary direction (we buy both, but YES is conventional)
    netProfit,
    1.0, // 100% confidence - it's guaranteed
    reason,
    signal
  );
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'arbitrage',
  description: 'Detects guaranteed profit opportunities (YES + NO < $1.00)',
  sources: ['kalshi'],
  minEdge: MIN_NET_PROFIT, // Very low threshold since any arb is valuable

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    logger.info(`Arbitrage detector: Scanning ${markets.length} markets`);

    for (const market of markets) {
      const edge = checkArbitrage(market as MarketWithOrderbook);
      if (edge) {
        const signal = edge.signal as unknown as ArbitrageSignal;
        logger.info(
          `Arbitrage FOUND: ${market.ticker || market.id} - ` +
          `${(signal.netProfit * 100).toFixed(1)}c net profit`
        );
        edges.push(edge);
      }
    }

    // Sort by net profit (highest first)
    edges.sort((a, b) => {
      const aSignal = a.signal as unknown as ArbitrageSignal;
      const bSignal = b.signal as unknown as ArbitrageSignal;
      return bSignal.netProfit - aSignal.netProfit;
    });

    if (edges.length > 0) {
      logger.info(`Arbitrage detector: Found ${edges.length} opportunities`);
    } else {
      logger.debug('Arbitrage detector: No opportunities found');
    }

    return edges;
  },
});

// =============================================================================
// EXPORTED UTILITIES (for use by other modules)
// =============================================================================

export { calculateKalshiFee, calculateSpreadArbitrageFees };
export type { ArbitrageSignal };
