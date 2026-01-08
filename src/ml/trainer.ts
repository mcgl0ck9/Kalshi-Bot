/**
 * Model Trainer
 *
 * Handles training the edge prediction model from historical data.
 * Uses the calibration tracker's prediction records as training data.
 */

import { logger } from '../utils/index.js';
import { getAllPredictions } from '../utils/calibration.js';
import type { CalibrationRecord } from '../types/index.js';
import {
  extractFeatures,
  normalizeFeatures,
  updateStats,
  computeLabel,
  type FeatureVector,
  type FeatureStats,
  createEmptyStats,
} from './features.js';
import {
  type EdgeModel,
  type TrainingMetrics,
  createNewModel,
  loadModel,
  saveModel,
  trainBatch,
  computeMetrics,
  computeFeatureImportance,
  predict,
} from './model.js';
import type { EdgeOpportunity, Market } from '../types/index.js';

// =============================================================================
// TRAINING DATA CONVERSION
// =============================================================================

/**
 * Convert CalibrationRecord to EdgeOpportunity for feature extraction
 */
function recordToOpportunity(record: CalibrationRecord): EdgeOpportunity {
  // Reconstruct a minimal Market object
  const market: Market = {
    platform: record.platform,
    id: record.marketId,
    title: record.marketTitle,
    category: mapCategoryFromRecord(record.category),
    price: record.marketPriceAtPrediction,
    volume: 0,
    url: '',
  };

  // Determine direction from edge sign
  const direction: 'BUY YES' | 'BUY NO' = record.edge > 0 ? 'BUY YES' : 'BUY NO';

  // Map signal sources to signal flags
  const signals: EdgeOpportunity['signals'] = {};
  for (const source of record.signalSources) {
    if (source === 'cross_platform') signals.crossPlatform = {} as never;
    if (source === 'sentiment') signals.sentiment = {} as never;
    if (source === 'whale_activity') signals.whale = {} as never;
    if (source === 'sports_odds' || source === 'options_data') signals.sportsConsensus = 0.5;
    if (source === 'base_rate') signals.recencyBias = true;
  }

  return {
    market,
    source: determineSource(record.signalSources),
    edge: Math.abs(record.edge),
    confidence: record.confidence,
    urgency: record.confidence > 0.8 ? 'critical' : record.confidence > 0.6 ? 'standard' : 'fyi',
    direction,
    signals,
  };
}

/**
 * Map category string to MarketCategory type
 */
function mapCategoryFromRecord(category: string): Market['category'] {
  const mapping: Record<string, Market['category']> = {
    politics: 'politics',
    crypto: 'crypto',
    macro: 'macro',
    sports: 'sports',
    entertainment: 'entertainment',
    weather: 'weather',
    tech: 'tech',
    geopolitics: 'geopolitics',
  };
  return mapping[category.toLowerCase()] || 'other';
}

/**
 * Determine primary source from signal sources
 */
function determineSource(sources: string[]): EdgeOpportunity['source'] {
  if (sources.includes('cross_platform')) return 'cross-platform';
  if (sources.includes('sentiment')) return 'sentiment';
  if (sources.includes('whale_activity')) return 'whale';
  if (sources.length > 1) return 'combined';
  return 'combined';
}

// =============================================================================
// TRAINING PIPELINE
// =============================================================================

export interface TrainingConfig {
  epochs: number;
  validationSplit: number;
  minSamples: number;
  learningRate: number;
  regularization: number;
}

const DEFAULT_CONFIG: TrainingConfig = {
  epochs: 50,
  validationSplit: 0.2,
  minSamples: 20,
  learningRate: 0.01,
  regularization: 0.001,
};

/**
 * Train model from calibration data
 */
export async function trainFromCalibrationData(
  config: Partial<TrainingConfig> = {}
): Promise<EdgeModel | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Loading calibration data for training...');

  // Get resolved predictions
  const allRecords = getAllPredictions();
  const resolvedRecords = allRecords.filter(r =>
    r.resolvedAt !== undefined &&
    r.actualOutcome !== undefined &&
    r.profitLoss !== undefined
  );

  logger.info(`Found ${resolvedRecords.length} resolved predictions`);

  if (resolvedRecords.length < cfg.minSamples) {
    logger.warn(`Insufficient training data: ${resolvedRecords.length} < ${cfg.minSamples} required`);
    return null;
  }

  // Convert to feature vectors and labels
  const features: FeatureVector[] = [];
  const labels: number[] = [];
  const stats = createEmptyStats();

  for (const record of resolvedRecords) {
    try {
      const opportunity = recordToOpportunity(record);
      const featureVec = extractFeatures(opportunity);
      const label = computeLabel(record.wasCorrectDirection ?? false, record.profitLoss ?? 0);

      features.push(featureVec);
      labels.push(label);
      updateStats(stats, featureVec);
    } catch (error) {
      logger.warn(`Failed to process record ${record.id}: ${error}`);
    }
  }

  logger.info(`Extracted ${features.length} training samples`);

  // Normalize features
  const normalizedFeatures = features.map(f => normalizeFeatures(f, stats));

  // Train/validation split
  const splitIdx = Math.floor(features.length * (1 - cfg.validationSplit));
  const trainFeatures = normalizedFeatures.slice(0, splitIdx);
  const trainLabels = labels.slice(0, splitIdx);
  const valFeatures = normalizedFeatures.slice(splitIdx);
  const valLabels = labels.slice(splitIdx);

  logger.info(`Training: ${trainFeatures.length} samples, Validation: ${valFeatures.length} samples`);

  // Initialize or load model
  let model = loadModel();
  if (!model) {
    model = createNewModel();
    logger.info('Created new model');
  }

  // Update model config
  model.weights.learningRate = cfg.learningRate;
  model.weights.regularization = cfg.regularization;
  model.stats = stats;

  // Train
  logger.info(`Training for ${cfg.epochs} epochs...`);
  const trainMetrics = trainBatch(model, trainFeatures, trainLabels, cfg.epochs);

  // Evaluate on validation set
  if (valFeatures.length > 0) {
    const valPredictions = valFeatures.map(f => predict(f, model.weights));
    const valMetrics = computeMetrics(valPredictions, valLabels);

    logger.info(`Validation metrics:`);
    logger.info(`  Accuracy: ${(valMetrics.accuracy * 100).toFixed(1)}%`);
    logger.info(`  AUC: ${valMetrics.auc.toFixed(3)}`);
    logger.info(`  F1 Score: ${valMetrics.f1Score.toFixed(3)}`);
  }

  // Compute feature importance
  model.featureImportance = computeFeatureImportance(model);

  // Log top features
  logger.info('Top important features:');
  for (const { name, importance } of model.featureImportance.slice(0, 5)) {
    logger.info(`  ${name}: ${(importance * 100).toFixed(1)}%`);
  }

  // Save model
  saveModel(model);

  return model;
}

// =============================================================================
// INCREMENTAL LEARNING
// =============================================================================

/**
 * Update model with new resolved predictions
 */
export async function updateModelIncremental(
  newRecords: CalibrationRecord[]
): Promise<EdgeModel | null> {
  const resolvedRecords = newRecords.filter(r =>
    r.resolvedAt !== undefined &&
    r.actualOutcome !== undefined &&
    r.profitLoss !== undefined
  );

  if (resolvedRecords.length === 0) {
    logger.info('No new resolved records for model update');
    return null;
  }

  logger.info(`Updating model with ${resolvedRecords.length} new samples`);

  let model = loadModel();
  if (!model) {
    // If no model exists, need full training
    logger.info('No existing model, performing full training');
    return trainFromCalibrationData();
  }

  // Extract features
  const features: FeatureVector[] = [];
  const labels: number[] = [];

  for (const record of resolvedRecords) {
    try {
      const opportunity = recordToOpportunity(record);
      const featureVec = extractFeatures(opportunity);
      const normalizedVec = normalizeFeatures(featureVec, model.stats);
      const label = computeLabel(record.wasCorrectDirection ?? false, record.profitLoss ?? 0);

      features.push(normalizedVec);
      labels.push(label);

      // Update running stats
      updateStats(model.stats, featureVec);
    } catch (error) {
      logger.warn(`Failed to process record: ${error}`);
    }
  }

  // Incremental training with fewer epochs
  const metrics = trainBatch(model, features, labels, 10);

  // Update feature importance
  model.featureImportance = computeFeatureImportance(model);

  // Save updated model
  saveModel(model);

  logger.info(`Model updated. New accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`);

  return model;
}

// =============================================================================
// MODEL EVALUATION
// =============================================================================

/**
 * Evaluate model on held-out test set
 */
export function evaluateModel(
  model: EdgeModel,
  testRecords: CalibrationRecord[]
): TrainingMetrics {
  const features: number[][] = [];
  const labels: number[] = [];

  for (const record of testRecords) {
    if (record.resolvedAt && record.actualOutcome !== undefined && record.profitLoss !== undefined) {
      try {
        const opportunity = recordToOpportunity(record);
        const featureVec = extractFeatures(opportunity);
        const normalizedVec = normalizeFeatures(featureVec, model.stats);
        const label = computeLabel(record.wasCorrectDirection ?? false, record.profitLoss ?? 0);

        features.push(normalizedVec);
        labels.push(label);
      } catch {
        // Skip failed records
      }
    }
  }

  if (features.length === 0) {
    return {
      epoch: 0,
      loss: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      auc: 0.5,
    };
  }

  const predictions = features.map(f => predict(f, model.weights));
  return computeMetrics(predictions, labels);
}
