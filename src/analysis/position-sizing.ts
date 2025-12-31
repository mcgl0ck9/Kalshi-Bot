/**
 * Position Sizing Module
 *
 * Implements Kelly Criterion with adjustments for:
 * - Confidence level
 * - Category risk
 * - Maximum position limits
 */

import type { PositionSizing, EdgeOpportunity, MarketCategory } from '../types/index.js';
import { BANKROLL, MAX_POSITION_PCT } from '../config.js';
import { formatCurrency } from '../utils/index.js';

// Category risk multipliers (lower = more conservative)
const CATEGORY_RISK_MULTIPLIERS: Record<MarketCategory, number> = {
  politics: 0.8,      // Politics can be volatile
  crypto: 0.6,        // Crypto is very volatile
  macro: 0.9,         // Economic data is more predictable
  sports: 1.0,        // Sports outcomes are well-studied
  entertainment: 0.8, // Entertainment can be unpredictable
  geopolitics: 0.5,   // Geopolitics is hard to predict
  weather: 0.7,       // Weather models have uncertainty
  tech: 0.7,          // Tech can be volatile
  other: 0.6,         // Unknown = conservative
};

/**
 * Calculate Kelly Criterion fraction
 *
 * Kelly formula: f* = (bp - q) / b
 * Where:
 *   b = odds received on bet (decimal odds - 1)
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 */
export function kellyCriterion(
  winProb: number,
  odds: number
): number {
  if (winProb <= 0 || winProb >= 1 || odds <= 0) {
    return 0;
  }

  const q = 1 - winProb;
  const b = odds - 1; // Convert decimal odds to net odds

  const kelly = (b * winProb - q) / b;

  // Never bet more than 100% or less than 0%
  return Math.max(0, Math.min(1, kelly));
}

/**
 * Calculate position size with adjustments
 */
export function calculatePositionSize(
  bankroll: number,
  edge: number,
  confidence: number,
  category: MarketCategory,
  marketPrice: number
): PositionSizing {
  // Determine direction
  const direction: 'BUY YES' | 'BUY NO' = edge > 0 ? 'BUY YES' : 'BUY NO';

  // Calculate win probability from edge + market price
  const winProb = marketPrice + edge;

  // Calculate odds (for binary market at price p, odds = 1/p for YES)
  const effectivePrice = direction === 'BUY YES' ? marketPrice : 1 - marketPrice;
  const odds = 1 / effectivePrice;

  // Base Kelly fraction
  const kellyFraction = kellyCriterion(winProb, odds);

  // Apply adjustments
  const categoryMultiplier = CATEGORY_RISK_MULTIPLIERS[category] ?? 0.6;
  const confidenceMultiplier = confidence;

  // Use fractional Kelly (typically 25-50% of full Kelly)
  const fractionalKelly = 0.25;

  let adjustedKelly = kellyFraction * fractionalKelly * categoryMultiplier * confidenceMultiplier;

  // Cap at max position percentage
  adjustedKelly = Math.min(adjustedKelly, MAX_POSITION_PCT);

  // Calculate dollar amount
  const positionSize = Math.round(bankroll * adjustedKelly);

  // Calculate max loss (assuming total loss of position)
  const maxLoss = positionSize;

  return {
    direction,
    positionSize,
    kellyFraction,
    adjustedKelly,
    edge: Math.abs(edge),
    confidence,
    maxLoss,
  };
}

/**
 * Calculate adaptive position for an opportunity
 */
export function calculateAdaptivePosition(
  bankroll: number = BANKROLL,
  opportunity: EdgeOpportunity
): PositionSizing {
  return calculatePositionSize(
    bankroll,
    opportunity.edge,
    opportunity.confidence,
    opportunity.market.category,
    opportunity.market.price
  );
}

/**
 * Format position recommendation for display
 */
export function formatPositionRecommendation(sizing: PositionSizing): string {
  if (sizing.positionSize === 0) {
    return 'No position recommended (edge too small or confidence too low)';
  }

  return [
    `**${sizing.direction}**`,
    `Position: ${formatCurrency(sizing.positionSize)}`,
    `Edge: ${(sizing.edge * 100).toFixed(1)}%`,
    `Confidence: ${(sizing.confidence * 100).toFixed(0)}%`,
    `Max Loss: ${formatCurrency(sizing.maxLoss)}`,
  ].join(' | ');
}

/**
 * Format opportunity with sizing for display
 */
export function formatOpportunityWithSizing(
  opportunity: EdgeOpportunity,
  sizing: PositionSizing
): string {
  const market = opportunity.market;
  const emoji = opportunity.urgency === 'critical' ? '🔴' : opportunity.urgency === 'standard' ? '🟡' : '🟢';

  const lines = [
    `${emoji} **${market.title?.slice(0, 60)}**`,
    `Platform: ${market.platform} | Price: ${(market.price * 100).toFixed(0)}¢`,
    `Edge: ${(opportunity.edge * 100).toFixed(1)}% | Direction: ${sizing.direction}`,
  ];

  if (sizing.positionSize > 0) {
    lines.push(`Position: ${formatCurrency(sizing.positionSize)} (${(sizing.adjustedKelly * 100).toFixed(1)}% of bankroll)`);
  }

  if (market.url) {
    lines.push(`[View Market](${market.url})`);
  }

  return lines.join('\n');
}
