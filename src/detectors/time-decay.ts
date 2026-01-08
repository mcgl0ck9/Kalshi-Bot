/**
 * Time-Decay Edge Detector (v4)
 *
 * Applies options-style theta decay adjustments to market edges.
 * This is a "meta-detector" that identifies markets where time decay
 * creates urgency or opportunity.
 *
 * Key capabilities:
 * - Flags markets with accelerating theta (expiring soon)
 * - Identifies opportunities where theta-adjusted edge remains strong
 * - Suggests optimal order type (market vs limit) based on time remaining
 *
 * Based on PhD-level research:
 * - arXiv:2412.14144 "Kelly Criterion for Prediction Markets"
 * - PNAS Iowa Electronic Markets: Diverging volatility near settlement
 * - Cont & Kukanov (arXiv:1210.1625): Optimal order placement
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import {
  calculateTimeDecay,
  adjustEdgeForTheta,
  suggestLimitOrder,
  parseExpiryTime,
  type TimeDecayModel,
  type ThetaAdjustedEdge,
  type LimitOrderSuggestion,
} from '../models/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum raw edge to consider (before theta adjustment) */
const MIN_RAW_EDGE = 0.03;

/** Minimum theta-adjusted edge to report */
const MIN_ADJUSTED_EDGE = 0.02;

/** Days threshold for high-urgency markets */
const HIGH_URGENCY_DAYS = 3;

/** Days threshold for critical urgency */
const CRITICAL_URGENCY_DAYS = 1;

// =============================================================================
// TIME DECAY SIGNAL INTERFACE
// =============================================================================

export interface TimeDecaySignal {
  type: 'time-decay';
  daysToExpiry: number;
  hoursToExpiry: number;
  theta: number;
  thetaPerDay: number;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  rawEdge: number;
  adjustedEdge: number;
  decayApplied: number;
  recommendedOrderType: 'limit' | 'market';
  limitOrderSuggestion?: {
    price: number;
    fillProbability: number;
    estimatedFillTime: string;
  };
  reasoning: string;
  // Index signature for EdgeSignal compatibility
  [key: string]: unknown;
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'time-decay',
  description: 'Applies theta decay adjustments and identifies time-sensitive opportunities',
  sources: ['kalshi'],
  minEdge: MIN_ADJUSTED_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    logger.info(`Time-decay detector: Analyzing ${markets.length} markets for time-sensitive opportunities`);

    for (const market of markets) {
      const edge = analyzeTimeDecay(market);
      if (edge) {
        edges.push(edge);
      }
    }

    logger.info(`Time-decay detector: Found ${edges.length} time-sensitive opportunities`);
    return edges;
  },
});

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Analyze a market for time-decay opportunities.
 * Returns an edge if the market has significant time-decay dynamics.
 */
function analyzeTimeDecay(market: Market): Edge | null {
  const { closeTime } = market;

  // Skip markets without expiry
  if (!closeTime) {
    return null;
  }

  // Parse expiry and calculate time decay model
  const expiryInfo = parseExpiryTime(closeTime);

  // Skip expired markets
  if (expiryInfo.isExpired) {
    return null;
  }

  // Calculate time decay model
  const timeDecayModel = calculateTimeDecay(closeTime);

  // Only flag markets with meaningful urgency (< 30 days)
  if (timeDecayModel.daysToExpiry > 30) {
    return null;
  }

  // Calculate base edge from price extremes
  // Markets at extreme prices (near 0 or 1) have implicit edge
  const baseEdge = calculateImplicitEdge(market.price);

  if (baseEdge < MIN_RAW_EDGE) {
    return null;
  }

  // Adjust edge for theta decay
  const thetaAdjusted = adjustEdgeForTheta(baseEdge, closeTime);

  // Skip if adjusted edge is too small
  if (thetaAdjusted.adjustedEdge < MIN_ADJUSTED_EDGE) {
    return null;
  }

  // Calculate fair value and limit order suggestion
  const direction = market.price < 0.5 ? 'YES' : 'NO';
  const fairValue = direction === 'YES'
    ? market.price + baseEdge
    : market.price - baseEdge;

  const limitSuggestion = suggestLimitOrder(
    fairValue,
    market.price,
    direction === 'YES' ? 'BUY YES' : 'BUY NO',
    closeTime
  );

  // Build the signal
  const signal: TimeDecaySignal = {
    type: 'time-decay',
    daysToExpiry: timeDecayModel.daysToExpiry,
    hoursToExpiry: timeDecayModel.hoursToExpiry,
    theta: timeDecayModel.theta,
    thetaPerDay: timeDecayModel.thetaPerDay,
    urgencyLevel: timeDecayModel.urgencyLevel,
    rawEdge: baseEdge,
    adjustedEdge: thetaAdjusted.adjustedEdge,
    decayApplied: thetaAdjusted.decayApplied,
    recommendedOrderType: timeDecayModel.recommendedOrderType,
    limitOrderSuggestion: limitSuggestion.recommendation !== 'market' ? {
      price: limitSuggestion.limitOrder.price,
      fillProbability: limitSuggestion.limitOrder.fillProbability,
      estimatedFillTime: limitSuggestion.limitOrder.estimatedFillTime ?? 'unknown',
    } : undefined,
    reasoning: buildReasoning(timeDecayModel, thetaAdjusted),
  };

  // Calculate confidence based on urgency and edge strength
  const confidence = calculateConfidence(timeDecayModel, thetaAdjusted);

  // Build reason string
  const reason = buildReasonString(market, timeDecayModel, thetaAdjusted);

  return createEdge(
    market,
    direction,
    thetaAdjusted.adjustedEdge,
    confidence,
    reason,
    signal
  );
}

/**
 * Calculate implicit edge from market price.
 * Markets near extremes (< 15 or > 85) often have overconfidence.
 */
function calculateImplicitEdge(price: number): number {
  // Markets at extremes tend to be mispriced
  // Apply regression to mean concept
  if (price < 0.15) {
    // Low-priced markets are often undervalued
    return 0.15 - price + 0.02;
  }
  if (price > 0.85) {
    // High-priced markets are often overvalued
    return price - 0.85 + 0.02;
  }

  // Markets in the middle have less implicit edge from theta
  // Still provide small edge for time-decay analysis
  const distanceFromCenter = Math.abs(price - 0.5);
  return distanceFromCenter * 0.1;
}

/**
 * Calculate confidence based on time decay characteristics.
 */
function calculateConfidence(
  timeDecay: TimeDecayModel,
  thetaAdjusted: ThetaAdjustedEdge
): number {
  let confidence = 0.50;  // Base confidence

  // Higher confidence for larger adjusted edges
  if (thetaAdjusted.adjustedEdge >= 0.10) {
    confidence += 0.15;
  } else if (thetaAdjusted.adjustedEdge >= 0.05) {
    confidence += 0.10;
  }

  // Higher confidence when theta is well-understood
  if (timeDecay.urgencyLevel === 'critical') {
    // Critical urgency = more predictable theta
    confidence += 0.10;
  } else if (timeDecay.urgencyLevel === 'high') {
    confidence += 0.05;
  }

  // Lower confidence if edge has decayed significantly
  if (thetaAdjusted.decayApplied > 20) {
    confidence -= 0.10;
  } else if (thetaAdjusted.decayApplied > 10) {
    confidence -= 0.05;
  }

  return Math.min(0.85, Math.max(0.40, confidence));
}

/**
 * Build detailed reasoning for the time decay analysis.
 */
function buildReasoning(
  timeDecay: TimeDecayModel,
  thetaAdjusted: ThetaAdjustedEdge
): string {
  const parts: string[] = [];

  // Time remaining
  if (timeDecay.daysToExpiry < 1) {
    parts.push(`Only ${Math.round(timeDecay.hoursToExpiry)} hours until expiry.`);
  } else {
    parts.push(`${Math.round(timeDecay.daysToExpiry)} days until expiry.`);
  }

  // Theta impact
  if (timeDecay.theta > 0.5) {
    parts.push(`High theta decay (${(timeDecay.theta * 100).toFixed(0)}%) actively eroding edge.`);
  } else if (timeDecay.theta > 0.2) {
    parts.push(`Moderate theta (${(timeDecay.theta * 100).toFixed(0)}%) beginning to impact.`);
  } else {
    parts.push(`Low theta (${(timeDecay.theta * 100).toFixed(0)}%) - edge stable.`);
  }

  // Order type recommendation
  if (timeDecay.recommendedOrderType === 'market') {
    parts.push('Use MARKET ORDER to ensure fill before expiry.');
  } else {
    parts.push(`LIMIT ORDER viable - time allows for patient entry.`);
  }

  return parts.join(' ');
}

/**
 * Build the main reason string for the edge.
 */
function buildReasonString(
  market: Market,
  timeDecay: TimeDecayModel,
  thetaAdjusted: ThetaAdjustedEdge
): string {
  const timeStr = timeDecay.daysToExpiry < 1
    ? `${Math.round(timeDecay.hoursToExpiry)}h`
    : `${Math.round(timeDecay.daysToExpiry)}d`;

  const urgencyEmoji = timeDecay.urgencyLevel === 'critical' ? '[CRITICAL]' :
                       timeDecay.urgencyLevel === 'high' ? '[HIGH]' :
                       timeDecay.urgencyLevel === 'medium' ? '[MEDIUM]' : '';

  const rawPct = (thetaAdjusted.rawEdge * 100).toFixed(1);
  const adjPct = (thetaAdjusted.adjustedEdge * 100).toFixed(1);

  return `${urgencyEmoji} ${timeStr} to expiry. Edge: ${rawPct}% raw -> ${adjPct}% theta-adjusted. ` +
    `${timeDecay.recommendedOrderType.toUpperCase()} order recommended.`;
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Enhance an existing edge with time-decay information.
 * Can be used by other detectors to add theta adjustments to their edges.
 */
export function enhanceEdgeWithTimeDecay(edge: Edge): Edge {
  const { closeTime } = edge.market;

  if (!closeTime) {
    return edge;
  }

  const expiryInfo = parseExpiryTime(closeTime);
  if (expiryInfo.isExpired) {
    return edge;
  }

  const timeDecayModel = calculateTimeDecay(closeTime);
  const thetaAdjusted = adjustEdgeForTheta(edge.edge, closeTime);

  // Update the edge with theta-adjusted value
  const enhancedEdge: Edge = {
    ...edge,
    edge: thetaAdjusted.adjustedEdge,
    signal: {
      ...edge.signal,
      timeDecay: {
        daysToExpiry: timeDecayModel.daysToExpiry,
        hoursToExpiry: timeDecayModel.hoursToExpiry,
        theta: timeDecayModel.theta,
        thetaPerDay: timeDecayModel.thetaPerDay,
        urgencyLevel: timeDecayModel.urgencyLevel,
        rawEdge: edge.edge,
        adjustedEdge: thetaAdjusted.adjustedEdge,
        decayApplied: thetaAdjusted.decayApplied,
        recommendedOrderType: timeDecayModel.recommendedOrderType,
      },
    },
  };

  // Escalate urgency if time decay warrants it
  if (timeDecayModel.urgencyLevel === 'critical' && edge.urgency !== 'critical') {
    enhancedEdge.urgency = 'critical';
  }

  return enhancedEdge;
}

/**
 * Filter edges based on theta-adjusted edge threshold.
 */
export function filterByThetaAdjustedEdge(
  edges: Edge[],
  minAdjustedEdge: number = MIN_ADJUSTED_EDGE
): Edge[] {
  return edges.filter(edge => {
    const timeDecay = edge.signal.timeDecay as TimeDecaySignal | undefined;
    if (timeDecay) {
      return timeDecay.adjustedEdge >= minAdjustedEdge;
    }
    return edge.edge >= minAdjustedEdge;
  });
}

/**
 * Sort edges by urgency and theta-adjusted value.
 */
export function sortByTimeUrgency(edges: Edge[]): Edge[] {
  const urgencyOrder = { critical: 0, standard: 1, low: 2 };

  return [...edges].sort((a, b) => {
    // First by urgency
    if (a.urgency !== b.urgency) {
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    }

    // Then by adjusted edge (or raw edge if no time decay)
    const aTimeDecay = a.signal.timeDecay as TimeDecaySignal | undefined;
    const bTimeDecay = b.signal.timeDecay as TimeDecaySignal | undefined;

    const aEdge = aTimeDecay?.adjustedEdge ?? a.edge;
    const bEdge = bTimeDecay?.adjustedEdge ?? b.edge;

    return bEdge - aEdge;
  });
}
