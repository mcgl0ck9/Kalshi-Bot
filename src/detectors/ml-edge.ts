/**
 * ML Edge Detector v4.0
 *
 * Detects edges in prediction markets using TensorFlow.js LSTM model:
 * - Predicts market movements based on historical patterns
 * - Identifies complex non-linear relationships between signals
 * - Creates edges when ML prediction diverges from market price
 *
 * ACADEMIC FOUNDATION (from CLAUDE.md):
 * - LSTM for sequence modeling and temporal dependencies
 * - Deep learning trend prediction (arXiv 2408.12408)
 * - Temporal Fusion Transformers for multi-horizon prediction
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Traders using simple heuristics or no ML
 * - Why do they lose? They can't capture complex temporal patterns
 * - Our edge: Deep learning identifies non-linear market dynamics
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
  initializePredictor,
  predictMarket,
  calculateEdge,
  getPredictorStatus,
  type MLEdgeResult,
} from '../ml/lstm-predictor.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum edge to report */
const MIN_EDGE = 0.05;

/** Minimum model confidence to trust prediction */
const MIN_MODEL_CONFIDENCE = 0.4;

/** Minimum training samples before using model */
const MIN_TRAINING_SAMPLES = 20;

/** Categories where ML has shown good performance */
const ML_EFFECTIVE_CATEGORIES = [
  'sports',
  'crypto',
  'macro',
  'politics',
  'entertainment',
];

// =============================================================================
// DETECTOR INITIALIZATION
// =============================================================================

let isInitialized = false;

/**
 * Initialize ML predictor on first use
 */
async function ensureInitialized(): Promise<boolean> {
  if (!isInitialized) {
    const success = await initializePredictor();
    isInitialized = success;

    if (!success) {
      logger.warn('ML detector: Model not available, will skip ML predictions');
    }
  }

  return isInitialized;
}

// =============================================================================
// EDGE ANALYSIS
// =============================================================================

/**
 * Analyze a market for ML-based edge
 */
async function analyzeMarketEdge(
  market: Market,
  sentiment: number = 0
): Promise<Edge | null> {
  // Get ML prediction
  const prediction = await predictMarket(market, sentiment);

  if (!prediction) {
    return null;
  }

  // Check model confidence threshold
  if (prediction.confidence < MIN_MODEL_CONFIDENCE) {
    logger.debug(`ML: Low confidence (${(prediction.confidence * 100).toFixed(0)}%) for ${market.id}`);
    return null;
  }

  // Calculate edge
  const edgeResult = calculateEdge(market, prediction);

  // Check minimum edge threshold
  if (edgeResult.edge < MIN_EDGE) {
    return null;
  }

  // Determine direction for v4 format
  const direction = edgeResult.direction === 'BUY YES' ? 'YES' : 'NO';

  // Build detailed reason
  const reason = buildReason(market, prediction, edgeResult);

  // Calculate confidence combining model confidence and edge size
  const confidence = calculateConfidence(prediction, edgeResult);

  return createEdge(
    market,
    direction,
    edgeResult.edge,
    confidence,
    reason,
    {
      type: 'ml-lstm',
      probUp: prediction.probUp,
      probDown: prediction.probDown,
      modelConfidence: prediction.confidence,
      modelDirection: prediction.direction,
      rawOutput: prediction.rawOutput,
    }
  );
}

/**
 * Build human-readable reason for the edge
 */
function buildReason(
  market: Market,
  prediction: ReturnType<typeof calculateEdge>['prediction'],
  edgeResult: MLEdgeResult
): string {
  const marketPct = (market.price * 100).toFixed(0);
  const mlPct = (prediction.probUp * 100).toFixed(0);
  const edgePct = (edgeResult.edge * 100).toFixed(1);
  const confPct = (prediction.confidence * 100).toFixed(0);

  const directionText = prediction.direction === 'UP'
    ? 'higher'
    : prediction.direction === 'DOWN'
      ? 'lower'
      : 'unchanged';

  return `LSTM model predicts fair value ${mlPct}% vs market ${marketPct}% (+${edgePct}% edge). ` +
    `Model expects price to go ${directionText} with ${confPct}% confidence. ` +
    `Pattern-based signal from historical price/volume/sentiment sequences.`;
}

/**
 * Calculate combined confidence score
 */
function calculateConfidence(
  prediction: ReturnType<typeof calculateEdge>['prediction'],
  edgeResult: MLEdgeResult
): number {
  // Start with model confidence
  let confidence = prediction.confidence;

  // Boost confidence for larger edges
  if (edgeResult.edge > 0.10) {
    confidence *= 1.1;
  } else if (edgeResult.edge > 0.15) {
    confidence *= 1.2;
  }

  // Penalize if model is uncertain (direction = HOLD)
  if (prediction.direction === 'HOLD') {
    confidence *= 0.7;
  }

  // Cap at reasonable bounds
  return Math.max(0.3, Math.min(0.9, confidence));
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'ml-edge',
  description: 'Detects edges using TensorFlow.js LSTM model predictions',
  sources: ['kalshi', 'news'],  // Uses news for sentiment
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Initialize predictor if needed
    const initialized = await ensureInitialized();
    if (!initialized) {
      logger.debug('ML detector: Skipping (model not available)');
      return edges;
    }

    // Check model status
    const status = getPredictorStatus();
    if (status.trainingSamples < MIN_TRAINING_SAMPLES) {
      logger.debug(`ML detector: Insufficient training data (${status.trainingSamples} < ${MIN_TRAINING_SAMPLES})`);
      return edges;
    }

    // Filter to effective categories
    const relevantMarkets = markets.filter(m =>
      ML_EFFECTIVE_CATEGORIES.includes(m.category)
    );

    if (relevantMarkets.length === 0) {
      logger.debug('ML detector: No markets in effective categories');
      return edges;
    }

    logger.info(`ML detector: Analyzing ${relevantMarkets.length} markets`);

    // Extract sentiment scores from news data if available
    const newsData = data['news'] as { sentiment?: Record<string, number> } | undefined;
    const sentimentScores = newsData?.sentiment ?? {};

    // Analyze each market
    for (const market of relevantMarkets) {
      try {
        // Get sentiment for this market (default to 0 if not available)
        const sentiment = sentimentScores[market.id] ?? 0;

        const edge = await analyzeMarketEdge(market, sentiment);
        if (edge) {
          edges.push(edge);
        }
      } catch (error) {
        logger.warn(`ML detector error for ${market.id}: ${error}`);
      }
    }

    if (edges.length > 0) {
      logger.info(`ML detector: Found ${edges.length} edges`);
    }

    return edges;
  },
});

// =============================================================================
// ADDITIONAL EXPORTS FOR TESTING/INTEGRATION
// =============================================================================

/**
 * Get ML detector status for monitoring
 */
export function getMLDetectorStatus(): {
  initialized: boolean;
  modelStatus: ReturnType<typeof getPredictorStatus>;
  effectiveCategories: string[];
  minEdge: number;
  minConfidence: number;
} {
  return {
    initialized: isInitialized,
    modelStatus: getPredictorStatus(),
    effectiveCategories: ML_EFFECTIVE_CATEGORIES,
    minEdge: MIN_EDGE,
    minConfidence: MIN_MODEL_CONFIDENCE,
  };
}

/**
 * Reset detector state (for testing)
 */
export function resetMLDetector(): void {
  isInitialized = false;
}

/**
 * Force initialize detector
 */
export async function forceInitialize(): Promise<boolean> {
  isInitialized = false;
  return ensureInitialized();
}
