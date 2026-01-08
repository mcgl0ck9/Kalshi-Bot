/**
 * LSTM Model Predictor for Edge Detection
 *
 * Provides inference capabilities for the LSTM model:
 * - Single market prediction
 * - Batch prediction
 * - Edge calculation from predictions
 * - Model caching for performance
 */

import { logger } from '../utils/index.js';
import type { Market } from '../core/types.js';
import {
  SEQUENCE_LENGTH,
  NUM_FEATURES,
  type FeatureSequence,
  type MarketHistory,
  type NormalizationStats,
  extractFeatureSequence,
  extractCurrentFeatures,
  DEFAULT_NORMALIZATION_STATS,
} from './feature-extractor.js';
import {
  loadModel,
  parsePrediction,
  warmUpModel,
  predictWithModel,
  type LSTMPrediction,
  type ModelMetadata,
  type LSTMLayersModel,
} from './lstm-model.js';

// =============================================================================
// PREDICTOR STATE
// =============================================================================

interface PredictorState {
  model: LSTMLayersModel | null;
  metadata: ModelMetadata | null;
  isLoaded: boolean;
  isWarmedUp: boolean;
  lastLoadAttempt: number;
}

const state: PredictorState = {
  model: null,
  metadata: null,
  isLoaded: false,
  isWarmedUp: false,
  lastLoadAttempt: 0,
};

// Reload interval (5 minutes)
const RELOAD_INTERVAL = 5 * 60 * 1000;

// =============================================================================
// MODEL LOADING
// =============================================================================

/**
 * Initialize the predictor by loading the model
 */
export async function initializePredictor(): Promise<boolean> {
  try {
    const result = await loadModel();
    if (result) {
      state.model = result.model;
      state.metadata = result.metadata;
      state.isLoaded = true;
      state.lastLoadAttempt = Date.now();

      // Warm up the model
      await warmUpModel(state.model);
      state.isWarmedUp = true;

      logger.info('LSTM predictor initialized');
      return true;
    }
  } catch (error) {
    logger.warn(`Failed to initialize predictor: ${error}`);
  }

  state.lastLoadAttempt = Date.now();
  return false;
}

/**
 * Ensure predictor is loaded, attempting to reload if necessary
 */
async function ensureLoaded(): Promise<boolean> {
  // Already loaded
  if (state.isLoaded && state.model) {
    return true;
  }

  // Check if we should retry loading
  const now = Date.now();
  if (now - state.lastLoadAttempt < RELOAD_INTERVAL) {
    return false;
  }

  return initializePredictor();
}

/**
 * Get current predictor status
 */
export function getPredictorStatus(): {
  loaded: boolean;
  warmedUp: boolean;
  trainingSamples: number;
  version: string;
  lastUpdated: string;
} {
  return {
    loaded: state.isLoaded,
    warmedUp: state.isWarmedUp,
    trainingSamples: state.metadata?.trainingSamples ?? 0,
    version: state.metadata?.version ?? 'N/A',
    lastUpdated: state.metadata?.updatedAt ?? 'Never',
  };
}

/**
 * Clear predictor cache (call after training)
 */
export function clearPredictorCache(): void {
  state.model = null;
  state.metadata = null;
  state.isLoaded = false;
  state.isWarmedUp = false;
  logger.debug('Predictor cache cleared');
}

// =============================================================================
// SINGLE PREDICTION
// =============================================================================

/**
 * Predict price movement for a single market
 */
export async function predictMarket(
  market: Market,
  sentiment: number = 0
): Promise<LSTMPrediction | null> {
  if (!await ensureLoaded() || !state.model) {
    return null;
  }

  try {
    const stats = state.metadata?.normStats ?? DEFAULT_NORMALIZATION_STATS;
    const sequence = extractCurrentFeatures(market, sentiment, stats);

    // Make prediction
    const output = await predictWithModel(state.model, sequence);
    if (!output) return null;

    return parsePrediction(output);
  } catch (error) {
    logger.warn(`Prediction failed for ${market.id}: ${error}`);
    return null;
  }
}

/**
 * Predict with full market history
 */
export async function predictWithHistory(
  history: MarketHistory
): Promise<LSTMPrediction | null> {
  if (!await ensureLoaded() || !state.model) {
    return null;
  }

  try {
    const stats = state.metadata?.normStats ?? DEFAULT_NORMALIZATION_STATS;
    const sequence = extractFeatureSequence(history, stats);

    const output = await predictWithModel(state.model, sequence);
    if (!output) return null;

    return parsePrediction(output);
  } catch (error) {
    logger.warn(`Prediction with history failed: ${error}`);
    return null;
  }
}

// =============================================================================
// BATCH PREDICTION
// =============================================================================

/**
 * Predict for multiple markets in batch
 */
export async function predictBatch(
  markets: Market[],
  sentiments: number[] = []
): Promise<Map<string, LSTMPrediction>> {
  const results = new Map<string, LSTMPrediction>();

  if (!await ensureLoaded() || !state.model || markets.length === 0) {
    return results;
  }

  try {
    const stats = state.metadata?.normStats ?? DEFAULT_NORMALIZATION_STATS;

    // Predict each market individually (batch prediction would require TF tensors)
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      const sentiment = sentiments[i] ?? 0;
      const sequence = extractCurrentFeatures(market, sentiment, stats);

      const output = await predictWithModel(state.model, sequence);
      if (output) {
        results.set(market.id, parsePrediction(output));
      }
    }
  } catch (error) {
    logger.warn(`Batch prediction failed: ${error}`);
  }

  return results;
}

// =============================================================================
// EDGE CALCULATION
// =============================================================================

/**
 * Edge result from ML prediction
 */
export interface MLEdgeResult {
  marketId: string;
  prediction: LSTMPrediction;
  edge: number;
  direction: 'BUY YES' | 'BUY NO';
  confidence: number;
  isSignificant: boolean;
}

/**
 * Calculate edge from ML prediction vs market price
 */
export function calculateEdge(
  market: Market,
  prediction: LSTMPrediction
): MLEdgeResult {
  const marketPrice = market.price;
  const mlFairValue = prediction.probUp;

  // Edge is difference between ML fair value and market price
  const edge = Math.abs(mlFairValue - marketPrice);

  // Direction: buy YES if ML thinks price should be higher
  const direction: 'BUY YES' | 'BUY NO' = mlFairValue > marketPrice ? 'BUY YES' : 'BUY NO';

  // Confidence is combination of model confidence and edge size
  const confidence = prediction.confidence * Math.min(1, edge * 5);  // Scale edge contribution

  // Significant if edge > 5% and confidence > 50%
  const isSignificant = edge > 0.05 && prediction.confidence > 0.5;

  return {
    marketId: market.id,
    prediction,
    edge,
    direction,
    confidence,
    isSignificant,
  };
}

/**
 * Get edges for multiple markets
 */
export async function calculateBatchEdges(
  markets: Market[],
  sentiments: number[] = []
): Promise<MLEdgeResult[]> {
  const predictions = await predictBatch(markets, sentiments);
  const results: MLEdgeResult[] = [];

  for (const market of markets) {
    const prediction = predictions.get(market.id);
    if (prediction) {
      results.push(calculateEdge(market, prediction));
    }
  }

  return results;
}

// =============================================================================
// FILTERING UTILITIES
// =============================================================================

/**
 * Filter edges by significance threshold
 */
export function filterSignificantEdges(
  edges: MLEdgeResult[],
  minEdge: number = 0.05,
  minConfidence: number = 0.5
): MLEdgeResult[] {
  return edges.filter(e =>
    e.edge >= minEdge &&
    e.prediction.confidence >= minConfidence
  );
}

/**
 * Rank edges by expected value
 */
export function rankEdges(edges: MLEdgeResult[]): MLEdgeResult[] {
  return [...edges].sort((a, b) => {
    const evA = a.edge * a.confidence;
    const evB = b.edge * b.confidence;
    return evB - evA;
  });
}

/**
 * Get top N edges
 */
export function getTopEdges(
  edges: MLEdgeResult[],
  n: number = 10
): MLEdgeResult[] {
  return rankEdges(edges).slice(0, n);
}

// =============================================================================
// DISPLAY UTILITIES
// =============================================================================

/**
 * Format ML edge result for display
 */
export function formatMLEdge(result: MLEdgeResult, market: Market): string {
  const lines = [
    `**${market.title}**`,
    '',
    `ML Prediction: ${result.prediction.direction}`,
    `Fair Value: ${(result.prediction.probUp * 100).toFixed(0)}%`,
    `Market Price: ${(market.price * 100).toFixed(0)}%`,
    `Edge: ${(result.edge * 100).toFixed(1)}%`,
    `Direction: ${result.direction}`,
    `Model Confidence: ${(result.prediction.confidence * 100).toFixed(0)}%`,
    `Significant: ${result.isSignificant ? 'Yes' : 'No'}`,
  ];

  return lines.join('\n');
}

/**
 * Get feature importance from model metadata
 */
export function getFeatureImportance(): { name: string; importance: number }[] {
  // For LSTM models, we don't have direct feature importance
  // Return feature names with uniform importance as placeholder
  const features = [
    'price', 'volume', 'price_change', 'volatility',
    'sentiment', 'momentum', 'time_to_expiry', 'liquidity'
  ];

  return features.map((name) => ({
    name,
    importance: 1 / features.length,
  }));
}

// =============================================================================
// DEBUGGING
// =============================================================================

/**
 * Run prediction diagnostics
 */
export async function runDiagnostics(market: Market): Promise<{
  prediction: LSTMPrediction | null;
  inputShape: number[];
  modelLoaded: boolean;
  normStats: NormalizationStats | null;
}> {
  const loaded = await ensureLoaded();

  return {
    prediction: loaded ? await predictMarket(market, 0) : null,
    inputShape: [1, SEQUENCE_LENGTH, NUM_FEATURES],
    modelLoaded: loaded,
    normStats: state.metadata?.normStats ?? null,
  };
}
