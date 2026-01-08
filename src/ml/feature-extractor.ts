/**
 * Feature Extractor for TensorFlow.js LSTM Model
 *
 * Extracts time-series features from market data for LSTM prediction:
 * - Historical price sequences
 * - Volume patterns
 * - Sentiment scores over time
 * - Derived technical indicators
 *
 * Outputs normalized feature tensors ready for model input.
 */

import type { Market } from '../core/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Number of time steps in the sequence (lookback window) */
export const SEQUENCE_LENGTH = 20;

/** Number of features per time step */
export const NUM_FEATURES = 8;

/** Feature names for interpretability */
export const LSTM_FEATURE_NAMES = [
  'price',              // 0: Current YES price (0-1)
  'volume_norm',        // 1: Normalized volume
  'price_change',       // 2: Price change from previous step
  'volatility',         // 3: Rolling volatility (std of price changes)
  'sentiment',          // 4: Sentiment score (-1 to 1)
  'momentum',           // 5: Price momentum (rate of change)
  'time_to_expiry',     // 6: Normalized time to expiry (0-1)
  'liquidity_norm',     // 7: Normalized liquidity
] as const;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Raw market data point for time series
 */
export interface MarketDataPoint {
  timestamp: number;
  price: number;
  volume?: number;
  liquidity?: number;
  sentiment?: number;
}

/**
 * Extracted feature sequence ready for LSTM
 * Shape: [SEQUENCE_LENGTH, NUM_FEATURES]
 */
export type FeatureSequence = number[][];

/**
 * Market history with all data points
 */
export interface MarketHistory {
  marketId: string;
  dataPoints: MarketDataPoint[];
  closeTime?: number;  // Unix timestamp
}

/**
 * Normalization statistics for features
 */
export interface NormalizationStats {
  means: number[];
  stds: number[];
  mins: number[];
  maxs: number[];
}

// =============================================================================
// DEFAULT NORMALIZATION STATS
// =============================================================================

/**
 * Default stats for normalizing features when no training data is available.
 * These are reasonable defaults for prediction market data.
 */
export const DEFAULT_NORMALIZATION_STATS: NormalizationStats = {
  means: [0.5, 0.5, 0, 0.02, 0, 0, 0.5, 0.5],
  stds: [0.25, 0.3, 0.05, 0.03, 0.3, 0.1, 0.25, 0.3],
  mins: [0, 0, -0.5, 0, -1, -1, 0, 0],
  maxs: [1, 1, 0.5, 0.2, 1, 1, 1, 1],
};

// =============================================================================
// FEATURE EXTRACTION
// =============================================================================

/**
 * Extract features from a single market data point
 */
export function extractPointFeatures(
  dataPoint: MarketDataPoint,
  prevDataPoint: MarketDataPoint | null,
  volatilityWindow: number[],
  closeTime?: number,
  stats: NormalizationStats = DEFAULT_NORMALIZATION_STATS
): number[] {
  const features: number[] = new Array(NUM_FEATURES).fill(0);

  // Price (0-1, already normalized)
  features[0] = dataPoint.price;

  // Volume (normalize using min-max)
  const volume = dataPoint.volume ?? 0;
  features[1] = Math.min(1, volume / 100000);  // Assume max volume ~100k

  // Price change
  const priceChange = prevDataPoint ? dataPoint.price - prevDataPoint.price : 0;
  features[2] = Math.max(-0.5, Math.min(0.5, priceChange));

  // Volatility (rolling standard deviation of price changes)
  if (volatilityWindow.length > 1) {
    const mean = volatilityWindow.reduce((a, b) => a + b, 0) / volatilityWindow.length;
    const variance = volatilityWindow.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / volatilityWindow.length;
    features[3] = Math.sqrt(variance);
  }

  // Sentiment (-1 to 1, normalize to 0-1)
  features[4] = dataPoint.sentiment ?? 0;

  // Momentum (5-period rate of change)
  features[5] = priceChange * 5;  // Simple momentum proxy

  // Time to expiry (normalized 0-1)
  if (closeTime && dataPoint.timestamp) {
    const timeRemaining = closeTime - dataPoint.timestamp;
    const maxTime = 30 * 24 * 60 * 60 * 1000;  // 30 days in ms
    features[6] = Math.max(0, Math.min(1, timeRemaining / maxTime));
  } else {
    features[6] = 0.5;  // Default to middle if unknown
  }

  // Liquidity (normalized)
  const liquidity = dataPoint.liquidity ?? 0;
  features[7] = Math.min(1, liquidity / 50000);  // Assume max liquidity ~50k

  return normalizeFeatures(features, stats);
}

/**
 * Normalize features using z-score normalization
 */
function normalizeFeatures(
  features: number[],
  stats: NormalizationStats
): number[] {
  return features.map((f, i) => {
    const std = stats.stds[i] || 1;
    const mean = stats.means[i] || 0;
    const normalized = (f - mean) / std;
    // Clip to prevent extreme values
    return Math.max(-3, Math.min(3, normalized));
  });
}

/**
 * Extract feature sequence from market history
 *
 * @param history - Market history with data points
 * @param stats - Normalization statistics
 * @returns Feature sequence of shape [SEQUENCE_LENGTH, NUM_FEATURES]
 */
export function extractFeatureSequence(
  history: MarketHistory,
  stats: NormalizationStats = DEFAULT_NORMALIZATION_STATS
): FeatureSequence {
  const sequence: number[][] = [];
  const { dataPoints, closeTime } = history;

  // Sort by timestamp
  const sortedPoints = [...dataPoints].sort((a, b) => a.timestamp - b.timestamp);

  // Take the last SEQUENCE_LENGTH points, or pad with zeros if not enough
  const startIdx = Math.max(0, sortedPoints.length - SEQUENCE_LENGTH);
  const relevantPoints = sortedPoints.slice(startIdx);

  // Track volatility window
  const volatilityWindow: number[] = [];
  const volatilitySize = 5;

  for (let i = 0; i < SEQUENCE_LENGTH; i++) {
    if (i < SEQUENCE_LENGTH - relevantPoints.length) {
      // Pad with zeros for missing history
      sequence.push(new Array(NUM_FEATURES).fill(0));
    } else {
      const pointIdx = i - (SEQUENCE_LENGTH - relevantPoints.length);
      const point = relevantPoints[pointIdx];
      const prevPoint = pointIdx > 0 ? relevantPoints[pointIdx - 1] : null;

      // Update volatility window
      if (prevPoint) {
        const change = point.price - prevPoint.price;
        volatilityWindow.push(change);
        if (volatilityWindow.length > volatilitySize) {
          volatilityWindow.shift();
        }
      }

      const features = extractPointFeatures(
        point,
        prevPoint,
        volatilityWindow,
        closeTime,
        stats
      );
      sequence.push(features);
    }
  }

  return sequence;
}

/**
 * Extract features from current market state (single point prediction)
 * Creates a minimal sequence when no history is available.
 */
export function extractCurrentFeatures(
  market: Market,
  sentiment: number = 0,
  stats: NormalizationStats = DEFAULT_NORMALIZATION_STATS
): FeatureSequence {
  const dataPoint: MarketDataPoint = {
    timestamp: Date.now(),
    price: market.price,
    volume: market.volume,
    liquidity: market.liquidity,
    sentiment,
  };

  const closeTime = market.closeTime
    ? new Date(market.closeTime).getTime()
    : undefined;

  // Create a minimal history with just the current point
  // Pad the rest with the same values (assumes stable market)
  const sequence: number[][] = [];

  for (let i = 0; i < SEQUENCE_LENGTH; i++) {
    const features = extractPointFeatures(
      dataPoint,
      null,  // No previous point
      [],    // No volatility history
      closeTime,
      stats
    );
    sequence.push(features);
  }

  return sequence;
}

/**
 * Create target labels for training
 *
 * @param futurePrice - The actual future price
 * @param currentPrice - The current price
 * @param threshold - Movement threshold to consider significant
 * @returns [probUp, probDown, confidence]
 */
export function createTargetLabels(
  futurePrice: number,
  currentPrice: number,
  threshold: number = 0.02
): [number, number, number] {
  const change = futurePrice - currentPrice;

  if (Math.abs(change) < threshold) {
    // No significant movement
    return [0.5, 0.5, 0.3];
  }

  if (change > 0) {
    // Price went up
    const magnitude = Math.min(1, Math.abs(change) / 0.2);  // Normalize by 20% max move
    return [0.5 + magnitude * 0.5, 0.5 - magnitude * 0.5, magnitude];
  } else {
    // Price went down
    const magnitude = Math.min(1, Math.abs(change) / 0.2);
    return [0.5 - magnitude * 0.5, 0.5 + magnitude * 0.5, magnitude];
  }
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Prepare batch of feature sequences for training
 */
export function prepareBatch(
  histories: MarketHistory[],
  stats: NormalizationStats = DEFAULT_NORMALIZATION_STATS
): FeatureSequence[] {
  return histories.map(h => extractFeatureSequence(h, stats));
}

/**
 * Compute normalization statistics from training data
 */
export function computeNormalizationStats(
  dataPoints: MarketDataPoint[][]
): NormalizationStats {
  const allFeatures: number[][] = [];

  // Extract all raw features
  for (const points of dataPoints) {
    const sortedPoints = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const volatilityWindow: number[] = [];

    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const prevPoint = i > 0 ? sortedPoints[i - 1] : null;

      if (prevPoint) {
        volatilityWindow.push(point.price - prevPoint.price);
        if (volatilityWindow.length > 5) volatilityWindow.shift();
      }

      // Extract raw (unnormalized) features
      const features = [
        point.price,
        Math.min(1, (point.volume ?? 0) / 100000),
        prevPoint ? point.price - prevPoint.price : 0,
        volatilityWindow.length > 1
          ? Math.sqrt(volatilityWindow.reduce((s, x) => s + x * x, 0) / volatilityWindow.length)
          : 0,
        point.sentiment ?? 0,
        prevPoint ? (point.price - prevPoint.price) * 5 : 0,
        0.5,  // Time to expiry - use default
        Math.min(1, (point.liquidity ?? 0) / 50000),
      ];

      allFeatures.push(features);
    }
  }

  if (allFeatures.length === 0) {
    return DEFAULT_NORMALIZATION_STATS;
  }

  // Compute stats
  const means: number[] = new Array(NUM_FEATURES).fill(0);
  const stds: number[] = new Array(NUM_FEATURES).fill(0);
  const mins: number[] = new Array(NUM_FEATURES).fill(Infinity);
  const maxs: number[] = new Array(NUM_FEATURES).fill(-Infinity);

  // Compute means
  for (const features of allFeatures) {
    for (let i = 0; i < NUM_FEATURES; i++) {
      means[i] += features[i];
      mins[i] = Math.min(mins[i], features[i]);
      maxs[i] = Math.max(maxs[i], features[i]);
    }
  }
  for (let i = 0; i < NUM_FEATURES; i++) {
    means[i] /= allFeatures.length;
  }

  // Compute standard deviations
  for (const features of allFeatures) {
    for (let i = 0; i < NUM_FEATURES; i++) {
      stds[i] += Math.pow(features[i] - means[i], 2);
    }
  }
  for (let i = 0; i < NUM_FEATURES; i++) {
    stds[i] = Math.sqrt(stds[i] / allFeatures.length) || 1;
  }

  return { means, stds, mins, maxs };
}

/**
 * Flatten feature sequence to 1D array for simple models
 */
export function flattenSequence(sequence: FeatureSequence): number[] {
  return sequence.flat();
}

/**
 * Reshape flat array to sequence format
 */
export function reshapeToSequence(flat: number[]): FeatureSequence {
  const sequence: FeatureSequence = [];
  for (let i = 0; i < SEQUENCE_LENGTH; i++) {
    sequence.push(flat.slice(i * NUM_FEATURES, (i + 1) * NUM_FEATURES));
  }
  return sequence;
}
