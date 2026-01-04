/**
 * Limit Order Strategy Model
 *
 * Based on academic research:
 * - Cont & Kukanov (arXiv:1210.1625): Optimal order placement
 * - Columbia Business School: Fill probability estimation with deep learning
 * - Practical implementation from prediction market arbitrage bots
 *
 * Key insight: Limit orders capture better prices but sacrifice fill certainty.
 * The optimal strategy depends on time to expiry, liquidity, and edge size.
 */

import {
  calculateTimeDecay,
  getLimitOrderAdjustmentFactor,
  parseExpiryTime,
  type TimeDecayModel,
} from './time-decay.js';

export interface OrderSuggestion {
  type: 'market' | 'limit';
  price: number;
  edge: number; // Edge captured at this price
  fillProbability: number; // 0-1
  estimatedFillTime?: string; // "~2 days"
  reasoning: string;
}

export interface LadderSuggestion {
  prices: number[];
  amounts: number[]; // Percentage of total at each price
  avgPrice: number;
  avgEdge: number;
  reasoning: string;
}

export interface LimitOrderSuggestion {
  marketOrder: OrderSuggestion;
  limitOrder: OrderSuggestion;
  ladderOrder?: LadderSuggestion;
  recommendation: 'market' | 'limit' | 'ladder';
  capitalTieUpWarning?: string;
  timeBasedAdjustment: string;
}

// Fill probability estimation parameters
const BASE_DAILY_VOLATILITY = 0.03; // 3% daily price movement assumption
const FILL_PROBABILITY_CURVE_K = 2.5; // Steepness of fill probability curve

/**
 * Estimate the probability that a limit order fills before expiry
 *
 * Based on:
 * - Distance from current price (larger gap = lower fill probability)
 * - Time to expiry (more time = higher fill probability)
 * - Historical volatility (higher vol = higher fill probability)
 *
 * Uses a simplified model based on price reaching limit via random walk
 */
export function estimateFillProbability(
  limitPrice: number,
  currentPrice: number,
  daysToExpiry: number,
  volatility: number = BASE_DAILY_VOLATILITY
): number {
  if (daysToExpiry <= 0) return 0;

  const priceGap = Math.abs(limitPrice - currentPrice);

  // If limit is at or beyond current price in favorable direction, instant fill
  if (priceGap <= 0.001) return 1.0;

  // Expected price range over remaining time (simplified random walk)
  const expectedMove = volatility * Math.sqrt(daysToExpiry);

  // Probability of reaching limit price
  // Using complementary error function approximation
  const zScore = priceGap / expectedMove;
  const fillProb = Math.exp(-FILL_PROBABILITY_CURVE_K * zScore * zScore);

  return Math.max(0, Math.min(1, fillProb));
}

/**
 * Estimate time until limit order fills (in days)
 */
export function estimateFillTime(
  limitPrice: number,
  currentPrice: number,
  volatility: number = BASE_DAILY_VOLATILITY
): number {
  const priceGap = Math.abs(limitPrice - currentPrice);
  if (priceGap <= 0.001) return 0;

  // Time for expected movement to reach price gap
  // From: expectedMove = volatility × sqrt(days)
  // Solve: days = (priceGap / volatility)^2
  const estimatedDays = Math.pow(priceGap / volatility, 2);

  return Math.max(0.1, estimatedDays); // Minimum 0.1 days (~2.4 hours)
}

/**
 * Format fill time estimate for display
 */
function formatFillTime(days: number): string {
  if (days < 0.1) return 'instant';
  if (days < 1) return `~${Math.round(days * 24)} hours`;
  if (days < 7) return `~${Math.round(days)} days`;
  return `~${Math.round(days / 7)} weeks`;
}

/**
 * Calculate optimal limit price based on edge and time
 *
 * Strategy:
 * - More time = more aggressive limit (capture better price)
 * - Less time = limit closer to market (prioritize fill)
 * - Larger edge = can afford to be patient
 */
export function calculateOptimalLimitPrice(
  fairValue: number,
  marketPrice: number,
  daysToExpiry: number,
  direction: 'BUY YES' | 'BUY NO'
): number {
  const adjustmentFactor = getLimitOrderAdjustmentFactor(daysToExpiry);
  const edgeGap = Math.abs(fairValue - marketPrice);

  if (direction === 'BUY YES') {
    // Want to buy YES, so limit should be between current price and fair value
    // Lower limit = better price but lower fill probability
    const targetGap = edgeGap * adjustmentFactor;
    return marketPrice + (fairValue - marketPrice) * (1 - adjustmentFactor);
  } else {
    // Want to buy NO (sell YES), limit should be higher than market
    return marketPrice - (marketPrice - fairValue) * (1 - adjustmentFactor);
  }
}

/**
 * Generate ladder order prices
 *
 * Spreads entry across multiple price levels to average into position
 */
export function generateLadderPrices(
  fairValue: number,
  marketPrice: number,
  direction: 'BUY YES' | 'BUY NO',
  levels: number = 3
): { prices: number[]; amounts: number[] } {
  const edgeGap = Math.abs(fairValue - marketPrice);
  const prices: number[] = [];
  const amounts: number[] = [];

  // Split evenly across levels
  const amountPerLevel = 100 / levels;

  for (let i = 0; i < levels; i++) {
    // Progress from aggressive (close to market) to patient (close to fair value)
    const progress = (i + 1) / (levels + 1);

    if (direction === 'BUY YES') {
      // Limit prices between market and fair value
      prices.push(marketPrice + edgeGap * progress * 0.5);
    } else {
      prices.push(marketPrice - edgeGap * progress * 0.5);
    }

    amounts.push(amountPerLevel);
  }

  return { prices, amounts };
}

/**
 * Main function: Generate comprehensive limit order suggestion
 */
export function suggestLimitOrder(
  fairValue: number,
  marketPrice: number,
  direction: 'BUY YES' | 'BUY NO',
  closeTime: string | Date | undefined,
  positionSize: number = 100, // Dollar amount
  liquidity?: number
): LimitOrderSuggestion {
  const timeDecay = calculateTimeDecay(closeTime);
  const expiry = parseExpiryTime(closeTime);
  const rawEdge = Math.abs(fairValue - marketPrice);

  // Market Order
  const marketOrder: OrderSuggestion = {
    type: 'market',
    price: marketPrice,
    edge: rawEdge,
    fillProbability: 1.0,
    reasoning: `Instant fill at ${(marketPrice * 100).toFixed(0)}¢. Captures full ${(rawEdge * 100).toFixed(1)}% edge immediately.`,
  };

  // Limit Order
  const limitPrice = calculateOptimalLimitPrice(
    fairValue,
    marketPrice,
    expiry.daysToExpiry,
    direction
  );
  const limitEdge =
    direction === 'BUY YES'
      ? fairValue - limitPrice
      : limitPrice - (1 - fairValue);
  const fillProb = estimateFillProbability(
    limitPrice,
    marketPrice,
    expiry.daysToExpiry
  );
  const fillTime = estimateFillTime(limitPrice, marketPrice);

  const limitOrder: OrderSuggestion = {
    type: 'limit',
    price: limitPrice,
    edge: Math.abs(limitEdge),
    fillProbability: fillProb,
    estimatedFillTime: formatFillTime(fillTime),
    reasoning: `Limit at ${(limitPrice * 100).toFixed(0)}¢ captures ${(Math.abs(limitEdge) * 100).toFixed(1)}% edge with ${(fillProb * 100).toFixed(0)}% fill probability.`,
  };

  // Ladder Order (for larger positions or uncertain timing)
  const ladder = generateLadderPrices(fairValue, marketPrice, direction, 3);
  const avgLadderPrice =
    ladder.prices.reduce((a, b) => a + b, 0) / ladder.prices.length;
  const avgLadderEdge = Math.abs(fairValue - avgLadderPrice);

  const ladderOrder: LadderSuggestion = {
    prices: ladder.prices,
    amounts: ladder.amounts,
    avgPrice: avgLadderPrice,
    avgEdge: avgLadderEdge,
    reasoning: `Scale in at ${ladder.prices.map((p) => `${(p * 100).toFixed(0)}¢`).join(', ')} for ~${(avgLadderEdge * 100).toFixed(1)}% avg edge.`,
  };

  // Recommendation logic
  let recommendation: 'market' | 'limit' | 'ladder';
  let timeBasedAdjustment: string;

  if (timeDecay.urgencyLevel === 'critical') {
    recommendation = 'market';
    timeBasedAdjustment = `⚠️ <24 hours to expiry. Use MARKET ORDER only. No time for limits to fill.`;
  } else if (timeDecay.urgencyLevel === 'high') {
    recommendation = rawEdge >= 0.10 ? 'market' : 'limit';
    timeBasedAdjustment = `⏳ ${Math.round(expiry.daysToExpiry)} days left. ${rawEdge >= 0.10 ? 'Large edge - market order recommended.' : 'Limit order viable but monitor closely.'}`;
  } else if (timeDecay.urgencyLevel === 'medium') {
    recommendation = 'limit';
    timeBasedAdjustment = `📅 ${Math.round(expiry.daysToExpiry)} days left. Limit orders recommended to capture better entry.`;
  } else {
    recommendation = positionSize >= 500 ? 'ladder' : 'limit';
    timeBasedAdjustment = `✅ ${Math.round(expiry.daysToExpiry)} days left. Plenty of time. ${positionSize >= 500 ? 'Consider ladder for larger position.' : 'Limit order optimal.'}`;
  }

  // Capital tie-up warning
  let capitalTieUpWarning: string | undefined;
  if (recommendation !== 'market' && expiry.daysToExpiry > 3) {
    const maxTieUpDays = Math.min(expiry.daysToExpiry, fillTime * 2);
    capitalTieUpWarning = `💰 Capital may be tied up for ${formatFillTime(maxTieUpDays)} until order fills or is cancelled.`;
  }

  return {
    marketOrder,
    limitOrder,
    ladderOrder,
    recommendation,
    capitalTieUpWarning,
    timeBasedAdjustment,
  };
}

/**
 * Format limit order suggestion for Discord display
 */
export function formatLimitOrderDisplay(suggestion: LimitOrderSuggestion): string {
  const lines: string[] = [];

  lines.push('💡 **RECOMMENDED ACTIONS**');
  lines.push('');

  // Market Order Option
  lines.push('**Option A: MARKET ORDER (Instant Fill)**');
  lines.push('```');
  lines.push(
    `🟢 BUY @ ${(suggestion.marketOrder.price * 100).toFixed(0)}¢ → Capture ${(suggestion.marketOrder.edge * 100).toFixed(1)}% edge`
  );
  lines.push(`   Fill: Guaranteed | Best if: Event is THIS WEEK`);
  lines.push('```');

  // Limit Order Option
  lines.push('');
  lines.push('**Option B: LIMIT ORDER (Patient Entry)**');
  lines.push('```');
  lines.push(
    `🟡 LIMIT @ ${(suggestion.limitOrder.price * 100).toFixed(0)}¢ → Capture ${(suggestion.limitOrder.edge * 100).toFixed(1)}% edge`
  );
  lines.push(
    `   Fill: ${(suggestion.limitOrder.fillProbability * 100).toFixed(0)}% chance in ${suggestion.limitOrder.estimatedFillTime}`
  );
  lines.push(`   Best if: Event is THIS MONTH, can wait`);
  lines.push('```');

  // Ladder Option (if available)
  if (suggestion.ladderOrder) {
    lines.push('');
    lines.push('**Option C: LADDER (Scale In)**');
    lines.push('```');
    lines.push(
      `🔵 LIMITS @ ${suggestion.ladderOrder.prices.map((p) => `${(p * 100).toFixed(0)}¢`).join(' / ')}`
    );
    lines.push(`   Avg edge: ${(suggestion.ladderOrder.avgEdge * 100).toFixed(1)}%`);
    lines.push(`   Best if: Large position, uncertain timing`);
    lines.push('```');
  }

  // Recommendation
  lines.push('');
  lines.push(suggestion.timeBasedAdjustment);

  // Capital warning
  if (suggestion.capitalTieUpWarning) {
    lines.push(suggestion.capitalTieUpWarning);
  }

  return lines.join('\n');
}
