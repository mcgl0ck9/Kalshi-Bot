/**
 * Time-Decay Pricing Model for Prediction Markets
 *
 * Based on PhD-level research:
 * - arXiv:2412.14144 "Application of the Kelly Criterion to Prediction Markets"
 * - PNAS Iowa Electronic Markets: Diverging volatility near settlement
 * - 0DTE Options Research: Inverse sigmoid decay pattern
 *
 * Key insight: Binary options in prediction markets follow inverse sigmoid
 * decay near expiry, with theta accelerating in the final 7 days.
 */

export interface TimeDecayModel {
  daysToExpiry: number;
  hoursToExpiry: number;
  theta: number; // 0-1, decay factor (higher = more decay)
  thetaPerDay: number; // Daily decay rate in edge points
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedOrderType: 'limit' | 'market';
  reasoning: string;
}

export interface ThetaAdjustedEdge {
  rawEdge: number;
  adjustedEdge: number;
  decayApplied: number; // Percentage of edge lost to theta
  edgePerDay: number; // How much edge decays per day
  daysUntilEdgeLost: number; // When edge becomes negligible
  reasoning: string;
}

export interface ExpiryInfo {
  expiresAt: Date;
  daysToExpiry: number;
  hoursToExpiry: number;
  isExpiringSoon: boolean; // <7 days
  isExpired: boolean;
  formattedExpiry: string; // "Feb 9, 2026 (36 days)"
}

// Decay rate constants (tuned from options research)
const DECAY_RATE_K = 0.15; // Controls steepness of sigmoid
const INFLECTION_DAYS = 7; // Point where decay accelerates
const MAX_THETA_IMPACT = 0.30; // Max 30% edge reduction from theta
const CRITICAL_DAYS = 1; // Market order only territory
const HIGH_URGENCY_DAYS = 3;
const MEDIUM_URGENCY_DAYS = 7;

/**
 * Parse market close time and calculate time metrics
 */
export function parseExpiryTime(closeTime: string | Date | undefined): ExpiryInfo {
  if (!closeTime) {
    return {
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
      daysToExpiry: 365,
      hoursToExpiry: 365 * 24,
      isExpiringSoon: false,
      isExpired: false,
      formattedExpiry: 'No expiry set',
    };
  }

  const expiresAt = typeof closeTime === 'string' ? new Date(closeTime) : closeTime;
  const now = new Date();
  const msToExpiry = expiresAt.getTime() - now.getTime();
  const hoursToExpiry = msToExpiry / (1000 * 60 * 60);
  const daysToExpiry = hoursToExpiry / 24;

  const isExpired = msToExpiry <= 0;
  const isExpiringSoon = daysToExpiry <= 7 && !isExpired;

  // Format: "Feb 9, 2026 (36 days)"
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const dateStr = expiresAt.toLocaleDateString('en-US', options);
  const daysStr =
    daysToExpiry < 1
      ? `${Math.max(0, Math.round(hoursToExpiry))} hours`
      : `${Math.round(daysToExpiry)} days`;
  const formattedExpiry = isExpired ? 'EXPIRED' : `${dateStr} (${daysStr})`;

  return {
    expiresAt,
    daysToExpiry: Math.max(0, daysToExpiry),
    hoursToExpiry: Math.max(0, hoursToExpiry),
    isExpiringSoon,
    isExpired,
    formattedExpiry,
  };
}

/**
 * Calculate theta (time decay factor) using inverse sigmoid
 *
 * Returns value between 0-1 where:
 * - 0 = no decay (far from expiry)
 * - 1 = full decay (at expiry)
 *
 * Based on 0DTE options research showing non-linear acceleration
 */
export function calculateTheta(daysToExpiry: number): number {
  if (daysToExpiry <= 0) return 1.0; // Expired = full decay
  if (daysToExpiry > 60) return 0.0; // Very far = no decay

  // Inverse sigmoid: θ(t) = 1 / (1 + e^(-k(T-t)))
  // Where T = inflection point, t = days remaining
  const exponent = -DECAY_RATE_K * (INFLECTION_DAYS - daysToExpiry);
  return 1 / (1 + Math.exp(exponent));
}

/**
 * Calculate daily theta decay rate
 * Returns the expected edge loss per day
 */
export function calculateThetaPerDay(daysToExpiry: number, edge: number): number {
  if (daysToExpiry <= 0) return 0;

  // Theta accelerates near expiry
  const theta = calculateTheta(daysToExpiry);
  const thetaTomorrow = calculateTheta(daysToExpiry - 1);
  const dailyThetaChange = thetaTomorrow - theta;

  // Edge lost per day = edge × daily theta change × max impact
  return edge * dailyThetaChange * MAX_THETA_IMPACT;
}

/**
 * Determine urgency level based on time to expiry
 */
export function getUrgencyLevel(
  daysToExpiry: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (daysToExpiry <= CRITICAL_DAYS) return 'critical';
  if (daysToExpiry <= HIGH_URGENCY_DAYS) return 'high';
  if (daysToExpiry <= MEDIUM_URGENCY_DAYS) return 'medium';
  return 'low';
}

/**
 * Determine recommended order type based on time and edge
 */
export function getRecommendedOrderType(
  daysToExpiry: number,
  edge: number
): 'limit' | 'market' {
  // Critical urgency = always market order
  if (daysToExpiry <= CRITICAL_DAYS) return 'market';

  // High edge with little time = market order
  if (daysToExpiry <= HIGH_URGENCY_DAYS && edge >= 0.08) return 'market';

  // Low edge with lots of time = can afford to wait
  if (daysToExpiry > MEDIUM_URGENCY_DAYS && edge < 0.10) return 'limit';

  // Default: depends on edge size
  return edge >= 0.12 ? 'market' : 'limit';
}

/**
 * Generate human-readable reasoning for time decay
 */
function generateTimeDecayReasoning(
  daysToExpiry: number,
  theta: number,
  urgencyLevel: string
): string {
  if (daysToExpiry <= 0) {
    return 'Market has expired - no action possible';
  }

  if (urgencyLevel === 'critical') {
    return `Only ${Math.round(daysToExpiry * 24)} hours remain. Theta decay is maximum. Use market order to ensure fill.`;
  }

  if (urgencyLevel === 'high') {
    return `${Math.round(daysToExpiry)} days to expiry. Theta is accelerating (${(theta * 100).toFixed(0)}% decay factor). Consider market order for edges >8%.`;
  }

  if (urgencyLevel === 'medium') {
    return `${Math.round(daysToExpiry)} days to expiry. Approaching theta inflection point. Limit orders still viable for patient entries.`;
  }

  return `${Math.round(daysToExpiry)} days to expiry. Minimal theta decay. Excellent time for limit orders to capture better prices.`;
}

/**
 * Main function: Calculate complete time decay model for a market
 */
export function calculateTimeDecay(closeTime: string | Date | undefined): TimeDecayModel {
  const expiry = parseExpiryTime(closeTime);
  const theta = calculateTheta(expiry.daysToExpiry);
  const urgencyLevel = getUrgencyLevel(expiry.daysToExpiry);
  const recommendedOrderType = getRecommendedOrderType(expiry.daysToExpiry, 0.08); // Assume 8% edge
  const thetaPerDay = calculateThetaPerDay(expiry.daysToExpiry, 0.10); // 10% edge baseline

  return {
    daysToExpiry: expiry.daysToExpiry,
    hoursToExpiry: expiry.hoursToExpiry,
    theta,
    thetaPerDay,
    urgencyLevel,
    recommendedOrderType,
    reasoning: generateTimeDecayReasoning(expiry.daysToExpiry, theta, urgencyLevel),
  };
}

/**
 * Adjust edge for theta decay
 *
 * As markets approach expiry, edges tend to close due to:
 * 1. More information becoming available
 * 2. Arbitrageurs closing gaps
 * 3. Market efficiency increasing
 *
 * This function estimates the "realized" edge after theta decay
 */
export function adjustEdgeForTheta(
  edge: number,
  closeTime: string | Date | undefined
): ThetaAdjustedEdge {
  const expiry = parseExpiryTime(closeTime);
  const theta = calculateTheta(expiry.daysToExpiry);

  // Edge decay formula: adjustedEdge = rawEdge × (1 - theta × maxImpact)
  const decayMultiplier = 1 - theta * MAX_THETA_IMPACT;
  const adjustedEdge = edge * decayMultiplier;
  const decayApplied = (1 - decayMultiplier) * 100;

  // Calculate edge per day and days until edge is negligible (<1%)
  const edgePerDay = calculateThetaPerDay(expiry.daysToExpiry, edge);
  const daysUntilEdgeLost = edge > 0.01 ? Math.ceil(edge / Math.max(edgePerDay, 0.001)) : 0;

  // Generate reasoning
  let reasoning: string;
  if (expiry.daysToExpiry <= 0) {
    reasoning = 'Market expired - edge no longer actionable';
  } else if (theta > 0.8) {
    reasoning = `High theta (${(theta * 100).toFixed(0)}%) reduces effective edge. Act quickly or accept reduced returns.`;
  } else if (theta > 0.5) {
    reasoning = `Moderate theta (${(theta * 100).toFixed(0)}%). Edge will decay ~${(edgePerDay * 100).toFixed(1)}% per day.`;
  } else if (theta > 0.2) {
    reasoning = `Low theta (${(theta * 100).toFixed(0)}%). Plenty of time to capture edge with limit orders.`;
  } else {
    reasoning = `Minimal theta impact. Full edge available for capture over ${Math.round(expiry.daysToExpiry)} days.`;
  }

  return {
    rawEdge: edge,
    adjustedEdge,
    decayApplied,
    edgePerDay,
    daysUntilEdgeLost,
    reasoning,
  };
}

/**
 * Format theta information for display in Discord alerts
 */
export function formatThetaDisplay(model: TimeDecayModel): string {
  const thetaPercent = (model.theta * 100).toFixed(0);
  const decayPerDay = (model.thetaPerDay * 100).toFixed(2);

  if (model.daysToExpiry <= 0) {
    return '⏰ **EXPIRED**';
  }

  const urgencyEmoji =
    model.urgencyLevel === 'critical'
      ? '🚨'
      : model.urgencyLevel === 'high'
        ? '⚠️'
        : model.urgencyLevel === 'medium'
          ? '⏳'
          : '📅';

  const daysStr =
    model.daysToExpiry < 1
      ? `${Math.round(model.hoursToExpiry)}h`
      : `${Math.round(model.daysToExpiry)}d`;

  return `${urgencyEmoji} **${daysStr} to expiry** | Theta: ${thetaPercent}% | Decay: ~${decayPerDay}%/day`;
}

/**
 * Get time-based limit order adjustment factor
 *
 * Returns what percentage of the edge gap to target with limit orders:
 * - 30+ days: 70% (patient, capture better price)
 * - 14-30 days: 80%
 * - 7-14 days: 90%
 * - <7 days: 100% (market order recommended)
 */
export function getLimitOrderAdjustmentFactor(daysToExpiry: number): number {
  if (daysToExpiry >= 30) return 0.7;
  if (daysToExpiry >= 14) return 0.8;
  if (daysToExpiry >= 7) return 0.9;
  return 1.0; // Use market order
}

// =============================================================================
// EDGE OPPORTUNITY ENHANCEMENT (for output module compatibility)
// =============================================================================

import type { EdgeOpportunity } from '../types/index.js';
import { suggestLimitOrder } from './limit-order.js';

/**
 * Enhance an EdgeOpportunity with time-decay signals and limit order suggestions
 */
export function enhanceWithTimeDecay(opportunity: EdgeOpportunity): EdgeOpportunity {
  const { market, edge, direction } = opportunity;

  // Calculate time decay model
  const timeDecayModel = calculateTimeDecay(market.closeTime);

  // Adjust edge for theta decay
  const adjustedEdge = adjustEdgeForTheta(edge, market.closeTime);

  // Calculate fair value based on direction
  const fairValue = direction === 'BUY YES'
    ? market.price + edge
    : market.price - edge;

  // Get limit order suggestion
  const limitSuggestion = suggestLimitOrder(
    fairValue,
    market.price,
    direction,
    market.closeTime,
    opportunity.sizing?.positionSize
  );

  // Add time decay signal to the opportunity
  opportunity.signals.timeDecay = {
    daysToExpiry: timeDecayModel.daysToExpiry,
    hoursToExpiry: timeDecayModel.hoursToExpiry,
    theta: timeDecayModel.theta,
    thetaPerDay: timeDecayModel.thetaPerDay,
    urgencyLevel: timeDecayModel.urgencyLevel,
    recommendedOrderType: timeDecayModel.recommendedOrderType,
    adjustedEdge: adjustedEdge.adjustedEdge,
    limitOrderSuggestion: {
      price: limitSuggestion.limitOrder.price,
      fillProbability: limitSuggestion.limitOrder.fillProbability,
      estimatedFillTime: limitSuggestion.limitOrder.estimatedFillTime ?? '~3 days',
    },
    reasoning: timeDecayModel.reasoning,
  };

  return opportunity;
}

/**
 * Format time decay information for display
 */
export function formatTimeDecayInfo(opportunity: EdgeOpportunity): string {
  const timeDecay = opportunity.signals.timeDecay;
  if (!timeDecay) {
    return '';
  }

  const urgencyEmoji =
    timeDecay.urgencyLevel === 'critical' ? '🚨' :
    timeDecay.urgencyLevel === 'high' ? '⚠️' :
    timeDecay.urgencyLevel === 'medium' ? '⏳' : '📅';

  const daysStr = timeDecay.daysToExpiry < 1
    ? `${Math.round(timeDecay.hoursToExpiry)}h`
    : `${Math.round(timeDecay.daysToExpiry)}d`;

  const lines = [
    `${urgencyEmoji} **Expires: ${daysStr}**`,
    `📉 Theta: ${(timeDecay.theta * 100).toFixed(0)}% (~${(timeDecay.thetaPerDay * 100).toFixed(1)}%/day)`,
    `Edge after decay: +${(timeDecay.adjustedEdge * 100).toFixed(1)}%`,
    '',
  ];

  // Add order recommendation
  const limitOrderSuggestion = timeDecay.limitOrderSuggestion;
  if (limitOrderSuggestion && timeDecay.recommendedOrderType === 'limit') {
    lines.push('💡 **Order Options:**');
    lines.push(`MARKET @ ${(opportunity.market.price * 100).toFixed(0)}¢  → Instant fill, full edge`);
    lines.push(`LIMIT  @ ${(limitOrderSuggestion.price * 100).toFixed(0)}¢  → ${(limitOrderSuggestion.fillProbability * 100).toFixed(0)}% fill in ~${limitOrderSuggestion.estimatedFillTime}`);
    if (timeDecay.urgencyLevel !== 'low') {
      lines.push('⚠️ Capital tied up until filled or cancelled');
    }
  } else {
    lines.push('💡 **Recommendation:** MARKET ORDER (time-critical)');
  }

  return lines.join('\n');
}
