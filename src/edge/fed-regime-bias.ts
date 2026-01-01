/**
 * Fed Regime Bias Adjustment
 *
 * QUANT INSIGHT: FedWatch has known systematic biases (Cleveland Fed research)
 *
 * RISING RATE ENVIRONMENT:
 * - FedWatch OVERPREDICTS rate cuts (futures traders too optimistic about pivot)
 * - Adjustment: Reduce FedWatch cut probability by 5-15%
 *
 * FALLING RATE ENVIRONMENT:
 * - FedWatch UNDERPREDICTS rate cuts (futures traders too conservative)
 * - Adjustment: Increase FedWatch cut probability by 5-10%
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Traders using raw FedWatch without bias correction
 * - Why do they lose? They don't know about the academic research on FedWatch biases
 * - Our edge: Information processing advantage from academic research
 *
 * Source: Cleveland Fed "How Well Does the Federal Funds Futures Rate Predict
 * the Future Federal Funds Rate?" and subsequent research
 */

import { logger } from '../utils/index.js';
import type { FedWatchData, FedMeetingProbabilities } from '../types/index.js';
import type { Market, MacroEdgeSignal } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type RateRegime = 'rising' | 'falling' | 'stable';

export interface RegimeAdjustedFedWatch {
  original: FedWatchData;
  regime: RateRegime;
  regimeConfidence: number;
  adjustedProbCut: number;
  adjustedProbHold: number;
  adjustedProbHike: number;
  biasAdjustment: number;  // How much we adjusted cut probability
  reasoning: string;
}

export interface FedRegimeEdge {
  market: Market;
  rawFedWatchProb: number;
  adjustedProb: number;
  kalshiPrice: number;
  rawEdge: number;         // Without bias adjustment
  adjustedEdge: number;    // With bias adjustment
  regime: RateRegime;
  biasAdjustment: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
  signalType: 'regime_adjusted_fed';
}

// =============================================================================
// REGIME DETECTION
// =============================================================================

// Fed rate history for regime detection
// Update this as Fed makes rate decisions
const FED_RATE_HISTORY: Array<{ date: string; rate: number; action: 'cut' | 'hike' | 'hold' }> = [
  { date: '2024-12-18', rate: 4.50, action: 'cut' },    // -25bp
  { date: '2024-11-07', rate: 4.75, action: 'cut' },    // -25bp
  { date: '2024-09-18', rate: 5.00, action: 'cut' },    // -50bp
  { date: '2024-07-31', rate: 5.50, action: 'hold' },
  { date: '2024-06-12', rate: 5.50, action: 'hold' },
  { date: '2024-05-01', rate: 5.50, action: 'hold' },
  { date: '2024-03-20', rate: 5.50, action: 'hold' },
  { date: '2024-01-31', rate: 5.50, action: 'hold' },
  { date: '2023-12-13', rate: 5.50, action: 'hold' },
  { date: '2023-11-01', rate: 5.50, action: 'hold' },
  { date: '2023-09-20', rate: 5.50, action: 'hold' },
  { date: '2023-07-26', rate: 5.50, action: 'hike' },   // +25bp
];

/**
 * Detect current rate regime based on recent Fed actions
 */
export function detectRateRegime(): {
  regime: RateRegime;
  confidence: number;
  reasoning: string;
} {
  // Look at last 4 Fed actions
  const recentActions = FED_RATE_HISTORY.slice(0, 4);

  const cuts = recentActions.filter(a => a.action === 'cut').length;
  const hikes = recentActions.filter(a => a.action === 'hike').length;
  const holds = recentActions.filter(a => a.action === 'hold').length;

  // Calculate net direction
  const netDirection = cuts - hikes;

  let regime: RateRegime;
  let confidence: number;
  let reasoning: string;

  if (netDirection >= 2) {
    regime = 'falling';
    confidence = 0.8 + (netDirection * 0.05);
    reasoning = `${cuts} cuts in last 4 meetings indicates falling rate environment`;
  } else if (netDirection <= -2) {
    regime = 'rising';
    confidence = 0.8 + (Math.abs(netDirection) * 0.05);
    reasoning = `${hikes} hikes in last 4 meetings indicates rising rate environment`;
  } else if (holds >= 3) {
    regime = 'stable';
    confidence = 0.7;
    reasoning = `${holds} holds in last 4 meetings indicates stable/uncertain environment`;
  } else {
    regime = 'stable';
    confidence = 0.5;
    reasoning = 'Mixed signals - treating as stable with low confidence';
  }

  return { regime, confidence: Math.min(confidence, 0.95), reasoning };
}

// =============================================================================
// BIAS ADJUSTMENT
// =============================================================================

/**
 * Bias adjustment factors based on academic research
 *
 * These factors are derived from Cleveland Fed and other research showing
 * that Fed Funds Futures systematically mis-predict in different regimes.
 */
const REGIME_BIAS_ADJUSTMENTS = {
  rising: {
    // In rising rate environments, FedWatch OVERPREDICTS cuts
    // Adjustment: Reduce cut probability, increase hike probability
    cutMultiplier: 0.85,     // Reduce cut prob by 15%
    holdMultiplier: 1.05,    // Slight increase to hold
    hikeMultiplier: 1.15,    // Increase hike prob by 15%
  },
  falling: {
    // In falling rate environments, FedWatch UNDERPREDICTS cuts
    // Adjustment: Increase cut probability, reduce hold probability
    cutMultiplier: 1.10,     // Increase cut prob by 10%
    holdMultiplier: 0.95,    // Slight decrease to hold
    hikeMultiplier: 0.85,    // Reduce hike prob
  },
  stable: {
    // In stable environments, minimal adjustment
    cutMultiplier: 1.0,
    holdMultiplier: 1.0,
    hikeMultiplier: 1.0,
  },
};

/**
 * Apply regime bias adjustment to FedWatch probabilities
 */
export function applyRegimeBiasAdjustment(
  fedWatch: FedWatchData
): RegimeAdjustedFedWatch | null {
  if (!fedWatch.nextMeeting) {
    logger.debug('No next meeting data for regime adjustment');
    return null;
  }

  const { regime, confidence: regimeConfidence, reasoning: regimeReasoning } = detectRateRegime();

  const adjustments = REGIME_BIAS_ADJUSTMENTS[regime];
  const meeting = fedWatch.nextMeeting;

  // Apply adjustments
  let adjustedProbCut = meeting.probCut * adjustments.cutMultiplier;
  let adjustedProbHold = meeting.probHold * adjustments.holdMultiplier;
  let adjustedProbHike = meeting.probHike * adjustments.hikeMultiplier;

  // Normalize to sum to 1
  const total = adjustedProbCut + adjustedProbHold + adjustedProbHike;
  adjustedProbCut /= total;
  adjustedProbHold /= total;
  adjustedProbHike /= total;

  // Calculate how much we adjusted
  const biasAdjustment = adjustedProbCut - meeting.probCut;

  const reasoning = `Regime: ${regime} (${(regimeConfidence * 100).toFixed(0)}% conf). ` +
    `${regimeReasoning}. ` +
    `Adjusted cut prob: ${(meeting.probCut * 100).toFixed(0)}% → ${(adjustedProbCut * 100).toFixed(0)}%`;

  logger.debug(`Fed regime adjustment: ${reasoning}`);

  return {
    original: fedWatch,
    regime,
    regimeConfidence,
    adjustedProbCut,
    adjustedProbHold,
    adjustedProbHike,
    biasAdjustment,
    reasoning,
  };
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Find edge in Fed markets using regime-adjusted FedWatch
 *
 * This is the KEY SIGNAL that passes adversarial testing:
 * - Raw FedWatch arbitrage = BAD (noisy, other traders see it too)
 * - Regime-adjusted FedWatch = GOOD (academic insight, processing edge)
 */
export function findRegimeAdjustedFedEdge(
  market: Market,
  fedWatch: FedWatchData
): FedRegimeEdge | null {
  // Only apply to Fed rate markets
  const title = market.title?.toLowerCase() ?? '';
  const isFedMarket = title.includes('fed') || title.includes('fomc') ||
    title.includes('rate cut') || title.includes('rate hike') ||
    title.includes('interest rate');

  if (!isFedMarket) return null;

  // Get regime-adjusted probabilities
  const adjusted = applyRegimeBiasAdjustment(fedWatch);
  if (!adjusted) return null;

  // Determine market type and get relevant probabilities
  let rawProb: number;
  let adjustedProb: number;

  if (title.includes('cut') || title.includes('lower')) {
    rawProb = adjusted.original.nextMeeting?.probCut ?? 0.5;
    adjustedProb = adjusted.adjustedProbCut;
  } else if (title.includes('hike') || title.includes('raise') || title.includes('increase')) {
    rawProb = adjusted.original.nextMeeting?.probHike ?? 0.5;
    adjustedProb = adjusted.adjustedProbHike;
  } else if (title.includes('hold') || title.includes('unchanged')) {
    rawProb = adjusted.original.nextMeeting?.probHold ?? 0.5;
    adjustedProb = adjusted.adjustedProbHold;
  } else {
    // Can't determine market type
    return null;
  }

  const rawEdge = rawProb - market.price;
  const adjustedEdge = adjustedProb - market.price;
  const absAdjustedEdge = Math.abs(adjustedEdge);

  // Only signal if adjusted edge is significant (lowered from 4% to 2%)
  if (absAdjustedEdge < 0.02) return null;

  const direction = adjustedEdge > 0 ? 'buy_yes' : 'buy_no';

  // Confidence based on regime confidence and edge magnitude
  const confidence = adjusted.regimeConfidence * Math.min(0.5 + absAdjustedEdge, 0.9);

  const reasoning = `${adjusted.reasoning}. ` +
    `Kalshi: ${(market.price * 100).toFixed(0)}%. ` +
    `Raw FedWatch: ${(rawProb * 100).toFixed(0)}% (edge: ${(rawEdge * 100).toFixed(1)}%). ` +
    `Adjusted: ${(adjustedProb * 100).toFixed(0)}% (edge: ${(adjustedEdge * 100).toFixed(1)}%).`;

  return {
    market,
    rawFedWatchProb: rawProb,
    adjustedProb,
    kalshiPrice: market.price,
    rawEdge,
    adjustedEdge,
    regime: adjusted.regime,
    biasAdjustment: adjusted.biasAdjustment,
    direction,
    confidence,
    reasoning,
    signalType: 'regime_adjusted_fed',
  };
}

/**
 * Convert FedRegimeEdge to MacroEdgeSignal for unified handling
 */
export function toMacroEdgeSignal(edge: FedRegimeEdge): MacroEdgeSignal {
  return {
    marketId: edge.market.id,
    marketTitle: edge.market.title ?? '',
    marketPlatform: edge.market.platform,
    marketPrice: edge.kalshiPrice,
    marketUrl: edge.market.url,
    indicatorType: 'fed',
    indicatorName: `Regime-Adjusted FedWatch (${edge.regime})`,
    indicatorValue: edge.adjustedProb,
    indicatorSource: 'CME FedWatch + Regime Bias Model',
    impliedProbability: edge.adjustedProb,
    edge: edge.adjustedEdge,
    edgePercent: edge.adjustedEdge * 100,
    confidence: edge.confidence,
    signalStrength: Math.abs(edge.adjustedEdge) > 0.12 ? 'strong' :
      Math.abs(edge.adjustedEdge) > 0.06 ? 'moderate' : 'weak',
    direction: edge.direction,
    reasoning: edge.reasoning,
    maxLoss: edge.direction === 'buy_yes' ? edge.kalshiPrice : (1 - edge.kalshiPrice),
    expectedValue: edge.adjustedEdge * edge.confidence,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Format regime analysis report
 */
export function formatRegimeAnalysisReport(adjusted: RegimeAdjustedFedWatch): string {
  const lines: string[] = [
    '**🏦 Fed Regime Analysis**',
    '═══════════════════════════════',
    '',
    `**Current Regime:** ${adjusted.regime.toUpperCase()}`,
    `**Confidence:** ${(adjusted.regimeConfidence * 100).toFixed(0)}%`,
    '',
    '**Probability Adjustments:**',
    `Raw FedWatch Cut: ${(adjusted.original.nextMeeting?.probCut ?? 0) * 100}% → Adjusted: ${(adjusted.adjustedProbCut * 100).toFixed(0)}%`,
    `Raw FedWatch Hold: ${(adjusted.original.nextMeeting?.probHold ?? 0) * 100}% → Adjusted: ${(adjusted.adjustedProbHold * 100).toFixed(0)}%`,
    `Raw FedWatch Hike: ${(adjusted.original.nextMeeting?.probHike ?? 0) * 100}% → Adjusted: ${(adjusted.adjustedProbHike * 100).toFixed(0)}%`,
    '',
    '**Reasoning:**',
    adjusted.reasoning,
    '',
    '**Edge Source:**',
    'Academic research shows FedWatch has regime-dependent biases.',
    adjusted.regime === 'rising'
      ? 'In rising rate environments, FedWatch overpredicts cuts - we reduce cut probability.'
      : adjusted.regime === 'falling'
        ? 'In falling rate environments, FedWatch underpredicts cuts - we increase cut probability.'
        : 'In stable environments, minimal adjustment applied.',
  ];

  return lines.join('\n');
}
