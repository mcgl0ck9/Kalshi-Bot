/**
 * Time-Decay Edge Enhancement
 *
 * Applies options-style theta decay to edge opportunities.
 * Markets approaching expiry have accelerated time decay,
 * reducing the effective edge and changing order recommendations.
 *
 * Based on PhD-level research:
 * - arXiv:2412.14144 "Kelly Criterion for Prediction Markets"
 * - PNAS Iowa Electronic Markets: Diverging volatility near settlement
 * - Cont & Kukanov (arXiv:1210.1625): Optimal order placement
 */

import type { EdgeOpportunity, Market } from '../types/index.js';
import {
  calculateTimeDecay,
  adjustEdgeForTheta,
  suggestLimitOrder,
  type TimeDecayModel,
  type LimitOrderSuggestion,
} from '../models/index.js';

/**
 * Enhanced opportunity with time-decay information
 */
export interface TimeDecayEnhancedOpportunity extends EdgeOpportunity {
  timeDecayModel: TimeDecayModel;
  limitOrderSuggestion: LimitOrderSuggestion;
}

/**
 * Enhance a single opportunity with time-decay information
 */
export function enhanceWithTimeDecay(
  opportunity: EdgeOpportunity
): EdgeOpportunity {
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
    adjustedEdge: adjustedEdge.adjustedEdge,
    recommendedOrderType: timeDecayModel.recommendedOrderType,
    limitOrderSuggestion: limitSuggestion.recommendation !== 'market' ? {
      price: limitSuggestion.limitOrder.price,
      fillProbability: limitSuggestion.limitOrder.fillProbability,
      estimatedFillTime: limitSuggestion.limitOrder.estimatedFillTime ?? 'unknown',
    } : undefined,
    reasoning: timeDecayModel.reasoning,
  };

  // Adjust urgency based on time decay if needed
  if (timeDecayModel.urgencyLevel === 'critical' && opportunity.urgency !== 'critical') {
    // Only escalate, never de-escalate
    opportunity.urgency = 'critical';
  }

  return opportunity;
}

/**
 * Enhance multiple opportunities with time-decay information
 */
export function enhanceOpportunitiesWithTimeDecay(
  opportunities: EdgeOpportunity[]
): EdgeOpportunity[] {
  return opportunities.map(enhanceWithTimeDecay);
}

/**
 * Filter opportunities based on time-decay criteria
 *
 * Removes opportunities where:
 * - Market has expired
 * - Edge after theta decay is too small
 */
export function filterByTimeDecay(
  opportunities: EdgeOpportunity[],
  minAdjustedEdge: number = 0.02
): EdgeOpportunity[] {
  return opportunities.filter(opp => {
    const td = opp.signals.timeDecay;

    // If no time decay info, keep the opportunity
    if (!td) return true;

    // Filter out expired markets
    if (td.daysToExpiry <= 0) return false;

    // Filter out opportunities where adjusted edge is too small
    if (td.adjustedEdge < minAdjustedEdge) return false;

    return true;
  });
}

/**
 * Sort opportunities by time-adjusted value
 *
 * Considers both edge magnitude and time remaining
 */
export function sortByTimeAdjustedValue(
  opportunities: EdgeOpportunity[]
): EdgeOpportunity[] {
  return [...opportunities].sort((a, b) => {
    const aTd = a.signals.timeDecay;
    const bTd = b.signals.timeDecay;

    // If no time decay info, use raw edge
    const aValue = aTd ? aTd.adjustedEdge : a.edge;
    const bValue = bTd ? bTd.adjustedEdge : b.edge;

    // Sort by urgency first
    const urgencyOrder = { critical: 0, standard: 1, fyi: 2 };
    if (a.urgency !== b.urgency) {
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    }

    // Then by adjusted edge
    return bValue - aValue;
  });
}

/**
 * Get recommendations summary for a set of opportunities
 */
export function getOrderTypeRecommendations(
  opportunities: EdgeOpportunity[]
): { market: number; limit: number; ladder: number } {
  const summary = { market: 0, limit: 0, ladder: 0 };

  for (const opp of opportunities) {
    const td = opp.signals.timeDecay;
    if (td) {
      if (td.recommendedOrderType === 'market') {
        summary.market++;
      } else {
        summary.limit++;
      }
    }
  }

  return summary;
}

/**
 * Format time-decay information for display
 */
export function formatTimeDecayInfo(opportunity: EdgeOpportunity): string[] {
  const td = opportunity.signals.timeDecay;
  if (!td) return [];

  const lines: string[] = [];

  // Expiry information
  const urgencyEmoji = td.urgencyLevel === 'critical' ? '🚨'
    : td.urgencyLevel === 'high' ? '⚠️'
    : td.urgencyLevel === 'medium' ? '⏳'
    : '📅';

  const timeStr = td.daysToExpiry < 1
    ? `${Math.round(td.hoursToExpiry)}h`
    : `${Math.round(td.daysToExpiry)}d`;

  lines.push(`${urgencyEmoji} **${timeStr} to expiry**`);

  // Theta decay
  if (td.theta > 0.01) {
    const thetaPct = (td.theta * 100).toFixed(0);
    const decayPct = (td.thetaPerDay * 100).toFixed(2);
    lines.push(`📉 Theta: ${thetaPct}% decay | ~${decayPct}%/day`);
  }

  // Adjusted edge
  if (td.adjustedEdge !== opportunity.edge) {
    const rawEdge = (opportunity.edge * 100).toFixed(1);
    const adjEdge = (td.adjustedEdge * 100).toFixed(1);
    lines.push(`Edge: ${rawEdge}% → ${adjEdge}% (theta-adjusted)`);
  }

  // Order recommendation
  if (td.recommendedOrderType === 'market') {
    lines.push(`💡 **Recommended: MARKET ORDER** (time is critical)`);
  } else if (td.limitOrderSuggestion) {
    const limit = td.limitOrderSuggestion;
    const limitPrice = (limit.price * 100).toFixed(0);
    const fillProb = (limit.fillProbability * 100).toFixed(0);
    lines.push(`💡 **Recommended: LIMIT @ ${limitPrice}¢**`);
    lines.push(`   Fill probability: ${fillProb}% in ${limit.estimatedFillTime}`);
  }

  return lines;
}
