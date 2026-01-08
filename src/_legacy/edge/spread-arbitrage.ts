/**
 * Spread Arbitrage Detection
 *
 * Detects guaranteed profit opportunities when YES + NO < $1.00
 * In prediction markets, buying both YES and NO guarantees $1.00 payout.
 * When the combined cost is less than $1.00, it's a risk-free arbitrage.
 *
 * Important: These opportunities are rare and close quickly.
 * Fees must be considered - Kalshi charges ceil(0.07 × contracts × price × (1-price))
 */

import { logger } from '../utils/index.js';
import type { Market, EdgeOpportunity } from '../types/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Kalshi fee formula: ceil(0.07 × contracts × price × (1-price))
const KALSHI_FEE_RATE = 0.07;

// Minimum profit after fees to alert (in dollars per contract)
const MIN_NET_PROFIT = 0.01; // 1 cent minimum

// Minimum profit percentage to alert
const MIN_PROFIT_PERCENT = 0.5; // 0.5% minimum

// =============================================================================
// TYPES
// =============================================================================

export interface SpreadArbitrageOpportunity {
  market: Market;
  yesPrice: number;          // YES ask price (0-1)
  noPrice: number;           // NO ask price (0-1)
  totalCost: number;         // Combined cost (should be < 1.0)
  grossProfit: number;       // $1.00 - totalCost
  grossProfitPercent: number;
  feeEstimate: number;       // Estimated Kalshi fees
  netProfit: number;         // Profit after fees
  netProfitPercent: number;
  guaranteed: true;
  action: string;
  reasoning: string;
}

// =============================================================================
// FEE CALCULATION
// =============================================================================

/**
 * Calculate Kalshi fee for a trade
 * Formula: ceil(0.07 × contracts × price × (1-price))
 */
export function calculateKalshiFee(
  contracts: number,
  price: number
): number {
  const rawFee = KALSHI_FEE_RATE * contracts * price * (1 - price);
  return Math.ceil(rawFee * 100) / 100; // Ceiling to nearest cent
}

/**
 * Calculate total fees for spread arbitrage (buying both sides)
 */
export function calculateSpreadArbitrageFees(
  contracts: number,
  yesPrice: number,
  noPrice: number
): number {
  const yesFee = calculateKalshiFee(contracts, yesPrice);
  const noFee = calculateKalshiFee(contracts, noPrice);
  return yesFee + noFee;
}

// =============================================================================
// DETECTION
// =============================================================================

/**
 * Check if a market has a spread arbitrage opportunity
 */
export function checkSpreadArbitrage(
  market: Market,
  yesPrice?: number,
  noPrice?: number
): SpreadArbitrageOpportunity | null {
  // Get prices - use provided or calculate from market
  const yes = yesPrice ?? market.price;
  const no = noPrice ?? (1 - market.price);

  // If we have outcome prices, use those
  if (market.outcomes && market.outcomes.length === 2) {
    const yesOutcome = market.outcomes.find(o =>
      o.outcome.toLowerCase() === 'yes' || o.outcome === 'Yes'
    );
    const noOutcome = market.outcomes.find(o =>
      o.outcome.toLowerCase() === 'no' || o.outcome === 'No'
    );

    if (yesOutcome && noOutcome) {
      // Use ask prices if available
      const yesAsk = yesOutcome.price;
      const noAsk = noOutcome.price;

      return checkArbitrageWithPrices(market, yesAsk, noAsk);
    }
  }

  return checkArbitrageWithPrices(market, yes, no);
}

/**
 * Check arbitrage with specific YES/NO prices
 */
function checkArbitrageWithPrices(
  market: Market,
  yesPrice: number,
  noPrice: number
): SpreadArbitrageOpportunity | null {
  const totalCost = yesPrice + noPrice;

  // No arbitrage if combined cost >= $1.00
  if (totalCost >= 1.0) {
    return null;
  }

  const grossProfit = 1.0 - totalCost;
  const grossProfitPercent = (grossProfit / totalCost) * 100;

  // Calculate fees for 100 contracts (standard lot)
  const feeEstimate = calculateSpreadArbitrageFees(100, yesPrice, noPrice) / 100;
  const netProfit = grossProfit - feeEstimate;
  const netProfitPercent = (netProfit / totalCost) * 100;

  // Check if profitable after fees
  if (netProfit < MIN_NET_PROFIT) {
    return null;
  }

  if (netProfitPercent < MIN_PROFIT_PERCENT) {
    return null;
  }

  return {
    market,
    yesPrice,
    noPrice,
    totalCost,
    grossProfit,
    grossProfitPercent,
    feeEstimate,
    netProfit,
    netProfitPercent,
    guaranteed: true,
    action: `Buy YES @ ${(yesPrice * 100).toFixed(0)}¢ + NO @ ${(noPrice * 100).toFixed(0)}¢`,
    reasoning: `Combined cost ${(totalCost * 100).toFixed(0)}¢ < $1.00 payout. ` +
      `Net profit: ${(netProfit * 100).toFixed(1)}¢ per contract after fees.`,
  };
}

/**
 * Scan multiple markets for spread arbitrage opportunities
 */
export function detectSpreadArbitrage(
  markets: Market[]
): SpreadArbitrageOpportunity[] {
  const opportunities: SpreadArbitrageOpportunity[] = [];

  for (const market of markets) {
    const opportunity = checkSpreadArbitrage(market);
    if (opportunity) {
      opportunities.push(opportunity);
    }
  }

  // Sort by net profit (highest first)
  return opportunities.sort((a, b) => b.netProfit - a.netProfit);
}

/**
 * Convert spread arbitrage to EdgeOpportunity format
 */
export function spreadArbitrageToEdge(
  arb: SpreadArbitrageOpportunity
): EdgeOpportunity {
  return {
    market: arb.market,
    source: 'combined',
    edge: arb.netProfit,
    confidence: 1.0, // 100% confidence - it's guaranteed
    urgency: 'critical', // Act fast - these close quickly
    direction: 'BUY YES', // We buy both, but YES is the primary
    signals: {
      crossPlatform: undefined,
      sentiment: undefined,
      whale: undefined,
    },
    sizing: {
      direction: 'BUY YES',
      positionSize: 100, // Standard lot
      kellyFraction: 1.0,
      adjustedKelly: 1.0, // Arbitrage = full kelly
      edge: arb.netProfit,
      confidence: 1.0, // Guaranteed profit
      maxLoss: arb.totalCost * 100,
    },
  };
}

// =============================================================================
// DISCORD FORMATTING
// =============================================================================

/**
 * Format spread arbitrage alert for Discord
 */
export function formatSpreadArbitrageAlert(
  arb: SpreadArbitrageOpportunity
): string {
  const lines: string[] = [];

  // Header
  lines.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  lines.push(`┃  💰 SPREAD ARBITRAGE  •  GUARANTEED ${(arb.netProfit * 100).toFixed(1)}¢ PROFIT         ┃`);
  lines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  lines.push('');

  // Market title
  lines.push(`📊 **${arb.market.title}**`);
  if (arb.market.subtitle) {
    lines.push(`*${arb.market.subtitle}*`);
  }
  lines.push('');

  // Current prices
  lines.push('**Current Prices**');
  lines.push('```');
  lines.push(`YES Ask: ${(arb.yesPrice * 100).toFixed(0)}¢`);
  lines.push(`NO Ask:  ${(arb.noPrice * 100).toFixed(0)}¢`);
  lines.push(`Total:   ${(arb.totalCost * 100).toFixed(0)}¢ (should be 100¢)`);
  lines.push('```');
  lines.push('');

  // Profit breakdown
  lines.push('**Guaranteed Profit**');
  lines.push('┌─────────────────────────────────────────────────────┐');
  lines.push(`│  Buy YES @ ${(arb.yesPrice * 100).toFixed(0)}¢ + Buy NO @ ${(arb.noPrice * 100).toFixed(0)}¢ = ${(arb.totalCost * 100).toFixed(0)}¢ cost           │`);
  lines.push(`│  One MUST pay $1.00 at expiry                      │`);
  lines.push(`│  Gross: ${(arb.grossProfit * 100).toFixed(1)}¢ | Fees: ~${(arb.feeEstimate * 100).toFixed(1)}¢ | Net: ${(arb.netProfit * 100).toFixed(1)}¢           │`);
  lines.push('└─────────────────────────────────────────────────────┘');
  lines.push('');

  // Example calculation
  lines.push('**For $100 capital:**');
  lines.push('```');
  const contracts = Math.floor(100 / arb.totalCost);
  const totalFees = calculateSpreadArbitrageFees(contracts, arb.yesPrice, arb.noPrice);
  const totalProfit = (contracts * arb.grossProfit) - totalFees;
  lines.push(`Buy ${contracts} contracts each side`);
  lines.push(`Cost: $${(contracts * arb.totalCost).toFixed(2)}`);
  lines.push(`Return: $${contracts.toFixed(2)}`);
  lines.push(`Fees: ~$${totalFees.toFixed(2)}`);
  lines.push(`Net Profit: $${totalProfit.toFixed(2)} (${arb.netProfitPercent.toFixed(1)}%)`);
  lines.push('```');
  lines.push('');

  // Warning
  lines.push('⚠️ **Act fast** - these close quickly!');
  lines.push('');

  // Trade link
  if (arb.market.url) {
    lines.push(`[>>> TRADE ON KALSHI <<<](${arb.market.url})`);
  }

  return lines.join('\n');
}

/**
 * Format multiple arbitrage opportunities as summary
 */
export function formatSpreadArbitrageSummary(
  opportunities: SpreadArbitrageOpportunity[]
): string {
  if (opportunities.length === 0) {
    return '✅ No spread arbitrage opportunities found.';
  }

  const lines: string[] = [];

  lines.push(`💰 **${opportunities.length} SPREAD ARBITRAGE OPPORTUNIT${opportunities.length === 1 ? 'Y' : 'IES'}**`);
  lines.push('');

  for (const arb of opportunities) {
    const title = arb.market.title.length > 50
      ? arb.market.title.slice(0, 47) + '...'
      : arb.market.title;

    lines.push(`• **${title}**`);
    lines.push(`  YES ${(arb.yesPrice * 100).toFixed(0)}¢ + NO ${(arb.noPrice * 100).toFixed(0)}¢ = ${(arb.totalCost * 100).toFixed(0)}¢ → Net ${(arb.netProfit * 100).toFixed(1)}¢ profit`);
    lines.push('');
  }

  return lines.join('\n');
}
