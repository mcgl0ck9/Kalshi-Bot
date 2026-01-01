/**
 * Feature Extraction for ML Model
 *
 * Extracts numerical features from edge opportunities for ML prediction.
 * Features are designed to capture:
 * - Edge characteristics (magnitude, direction, price level)
 * - Signal convergence (number and type of signals)
 * - Market characteristics (category, volume, time to close)
 * - Historical performance indicators
 */

import type { EdgeOpportunity, Market, MarketCategory } from '../types/index.js';

// =============================================================================
// FEATURE NAMES (for interpretability)
// =============================================================================

export const FEATURE_NAMES = [
  // Edge characteristics
  'edge_magnitude',           // 0: Absolute edge size
  'edge_direction',           // 1: 1 for BUY YES, -1 for BUY NO
  'confidence',               // 2: Reported confidence
  'urgency_score',            // 3: 1=critical, 0.5=standard, 0.2=fyi

  // Price characteristics
  'market_price',             // 4: Current YES price
  'price_extremity',          // 5: Distance from 50% (captures tail behavior)
  'implied_fair_value',       // 6: What our signals suggest the price should be

  // Signal sources (one-hot encoded)
  'src_cross_platform',       // 7: Cross-platform divergence
  'src_sentiment',            // 8: Sentiment analysis
  'src_whale',                // 9: Whale activity
  'src_combined',             // 10: Multiple sources combined
  'src_sports_odds',          // 11: Sports odds comparison
  'src_weather',              // 12: Weather/climatology
  'src_fed_speech',           // 13: Fed speech keywords
  'src_measles',              // 14: CDC data
  'src_earnings',             // 15: Earnings call keywords

  // Signal convergence
  'signal_count',             // 16: Number of active signals
  'signal_agreement',         // 17: Do signals point same direction?

  // Category encoding
  'cat_politics',             // 18
  'cat_crypto',               // 19
  'cat_macro',                // 20
  'cat_sports',               // 21
  'cat_entertainment',        // 22
  'cat_weather',              // 23
  'cat_other',                // 24

  // Market characteristics
  'log_volume',               // 25: Log of volume (normalized)
  'has_close_time',           // 26: Whether close time is known
  'time_to_close_days',       // 27: Days until close (0 if unknown)

  // Derived features
  'kelly_fraction',           // 28: Suggested Kelly bet size
  'expected_value',           // 29: edge * confidence
  'risk_adjusted_edge',       // 30: edge / (1 + price_extremity)
] as const;

export const NUM_FEATURES = FEATURE_NAMES.length;

export type FeatureVector = number[];

// =============================================================================
// FEATURE EXTRACTION
// =============================================================================

/**
 * Extract feature vector from an edge opportunity
 */
export function extractFeatures(opportunity: EdgeOpportunity): FeatureVector {
  const { market, edge, confidence, urgency, direction, signals, sizing } = opportunity;

  const features: FeatureVector = new Array(NUM_FEATURES).fill(0);

  // Edge characteristics
  features[0] = edge;
  features[1] = direction === 'BUY YES' ? 1 : -1;
  features[2] = confidence;
  features[3] = urgency === 'critical' ? 1 : urgency === 'standard' ? 0.5 : 0.2;

  // Price characteristics
  features[4] = market.price;
  features[5] = Math.abs(market.price - 0.5);  // Distance from 50%
  features[6] = direction === 'BUY YES' ? market.price + edge : market.price - edge;

  // Signal sources
  features[7] = signals.crossPlatform ? 1 : 0;
  features[8] = signals.sentiment ? 1 : 0;
  features[9] = signals.whale || signals.whaleConviction ? 1 : 0;
  features[10] = opportunity.source === 'combined' ? 1 : 0;
  features[11] = signals.sportsConsensus !== undefined ? 1 : 0;
  features[12] = signals.weatherBias !== undefined ? 1 : 0;
  features[13] = signals.fedSpeech ? 1 : 0;
  features[14] = signals.measles ? 1 : 0;
  features[15] = signals.earnings ? 1 : 0;

  // Signal convergence
  const signalFlags = [
    signals.crossPlatform,
    signals.sentiment,
    signals.whale || signals.whaleConviction,
    signals.sportsConsensus !== undefined,
    signals.weatherBias !== undefined,
    signals.fedSpeech,
    signals.measles,
    signals.earnings,
    signals.recencyBias,
    signals.fedRegime,
    signals.injuryOverreaction !== undefined,
  ];
  features[16] = signalFlags.filter(Boolean).length;
  features[17] = features[16] > 1 ? 1 : 0;  // Multiple signals agree

  // Category encoding
  const categoryIndex = getCategoryIndex(market.category);
  if (categoryIndex >= 0 && categoryIndex < 7) {
    features[18 + categoryIndex] = 1;
  }

  // Market characteristics
  features[25] = Math.log(Math.max(1, market.volume || 1));
  features[26] = market.closeTime ? 1 : 0;
  features[27] = market.closeTime ? getDaysUntilClose(market.closeTime) : 0;

  // Derived features
  features[28] = sizing?.kellyFraction ?? 0;
  features[29] = edge * confidence;
  features[30] = edge / (1 + features[5]);  // Risk-adjusted edge

  return features;
}

/**
 * Get category index for one-hot encoding
 */
function getCategoryIndex(category: MarketCategory): number {
  const categories: MarketCategory[] = [
    'politics', 'crypto', 'macro', 'sports', 'entertainment', 'weather', 'other'
  ];
  const idx = categories.indexOf(category);
  return idx >= 0 ? idx : 6; // Default to 'other'
}

/**
 * Calculate days until market closes
 */
function getDaysUntilClose(closeTime: string): number {
  try {
    const closeDate = new Date(closeTime);
    const now = new Date();
    const diffMs = closeDate.getTime() - now.getTime();
    return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

// =============================================================================
// FEATURE NORMALIZATION
// =============================================================================

export interface FeatureStats {
  means: number[];
  stds: number[];
  mins: number[];
  maxs: number[];
  count: number;
}

/**
 * Create initial empty feature stats
 */
export function createEmptyStats(): FeatureStats {
  return {
    means: new Array(NUM_FEATURES).fill(0),
    stds: new Array(NUM_FEATURES).fill(1),
    mins: new Array(NUM_FEATURES).fill(Infinity),
    maxs: new Array(NUM_FEATURES).fill(-Infinity),
    count: 0,
  };
}

/**
 * Update running statistics with new sample (Welford's online algorithm)
 */
export function updateStats(stats: FeatureStats, features: FeatureVector): void {
  const n = stats.count + 1;

  for (let i = 0; i < NUM_FEATURES; i++) {
    const x = features[i];

    // Update min/max
    stats.mins[i] = Math.min(stats.mins[i], x);
    stats.maxs[i] = Math.max(stats.maxs[i], x);

    // Welford's algorithm for online mean/variance
    const delta = x - stats.means[i];
    stats.means[i] += delta / n;

    // For variance, we'd need to track M2, but for simplicity use running std estimate
    // This is approximate but works for our use case
    const newDelta = x - stats.means[i];
    const newVar = ((n - 1) * (stats.stds[i] ** 2) + delta * newDelta) / n;
    stats.stds[i] = Math.sqrt(Math.max(0.001, newVar));
  }

  stats.count = n;
}

/**
 * Normalize feature vector using computed statistics
 */
export function normalizeFeatures(features: FeatureVector, stats: FeatureStats): FeatureVector {
  return features.map((x, i) => {
    // Handle NaN or Infinity in input
    if (!Number.isFinite(x)) {
      return 0;
    }
    const std = stats.stds[i] || 1;
    const mean = stats.means[i] || 0;
    const normalized = (x - mean) / std;
    // Clip extreme values to prevent NaN in predictions
    return Math.max(-10, Math.min(10, Number.isFinite(normalized) ? normalized : 0));
  });
}

/**
 * Convert binary classification target to label
 * For our use case: 1 = prediction was profitable, 0 = prediction lost money
 */
export function computeLabel(wasCorrect: boolean, profitLoss: number): number {
  // Profitable trades = 1, unprofitable = 0
  return profitLoss > 0 ? 1 : 0;
}
