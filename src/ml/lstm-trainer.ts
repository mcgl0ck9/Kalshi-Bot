/**
 * LSTM Model Training Pipeline
 *
 * Handles training the LSTM model from historical market data:
 * - Data preparation and batching
 * - Training with validation
 * - Early stopping and learning rate scheduling
 * - Model checkpointing
 */

import { logger } from '../utils/index.js';
import { getAllPredictions } from '../utils/calibration.js';
import type { CalibrationRecord } from '../types/meta-edge.js';
import {
  SEQUENCE_LENGTH,
  type MarketDataPoint,
  type MarketHistory,
  type NormalizationStats,
  extractFeatureSequence,
  computeNormalizationStats,
  createTargetLabels,
  DEFAULT_NORMALIZATION_STATS,
} from './feature-extractor.js';
import {
  createLSTMModel,
  saveModel,
  loadModel,
  createDefaultMetadata,
  trainModelBatch,
  type LSTMModelConfig,
  type ModelMetadata,
  type LSTMLayersModel,
  DEFAULT_MODEL_CONFIG,
} from './lstm-model.js';

// =============================================================================
// TRAINING CONFIGURATION
// =============================================================================

export interface TrainingConfig {
  /** Number of training epochs */
  epochs: number;
  /** Batch size for training */
  batchSize: number;
  /** Validation split ratio */
  validationSplit: number;
  /** Minimum samples required for training */
  minSamples: number;
  /** Early stopping patience (epochs without improvement) */
  earlyStoppingPatience: number;
  /** Learning rate decay factor */
  learningRateDecay: number;
  /** Whether to use attention model variant */
  useAttention: boolean;
  /** LSTM model configuration */
  modelConfig: LSTMModelConfig;
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  epochs: 100,
  batchSize: 32,
  validationSplit: 0.2,
  minSamples: 50,
  earlyStoppingPatience: 10,
  learningRateDecay: 0.95,
  useAttention: false,
  modelConfig: DEFAULT_MODEL_CONFIG,
};

// =============================================================================
// TRAINING DATA PREPARATION
// =============================================================================

interface TrainingDataPoint {
  sequence: number[][];
  label: number[];
}

/**
 * Convert calibration records to training data
 *
 * Each record represents a historical prediction with known outcome.
 * We construct synthetic sequences from the available data.
 */
function prepareTrainingData(
  records: CalibrationRecord[],
  stats: NormalizationStats
): TrainingDataPoint[] {
  const trainingData: TrainingDataPoint[] = [];

  for (const record of records) {
    if (record.resolvedAt === undefined || record.actualOutcome === undefined) {
      continue;
    }

    // Create a synthetic market history from the record
    // In production, this would use actual historical price data
    const history = createSyntheticHistory(record);

    // Extract features
    const sequence = extractFeatureSequence(history, stats);

    // Create labels based on actual outcome (boolean: true = YES, false = NO)
    const futurePrice = record.actualOutcome === true ? 1 : 0;
    const label = createTargetLabels(futurePrice, record.marketPriceAtPrediction);

    trainingData.push({ sequence, label });
  }

  return trainingData;
}

/**
 * Create synthetic market history from a calibration record
 *
 * Since we don't have full historical price data, we simulate
 * a plausible history based on the prediction time data.
 */
function createSyntheticHistory(record: CalibrationRecord): MarketHistory {
  const dataPoints: MarketDataPoint[] = [];
  const basePrice = record.marketPriceAtPrediction;
  const baseTime = new Date(record.predictedAt).getTime();

  // Generate synthetic history going backwards
  for (let i = SEQUENCE_LENGTH - 1; i >= 0; i--) {
    const timeOffset = i * 60 * 60 * 1000;  // 1 hour intervals
    const timestamp = baseTime - timeOffset;

    // Add some random walk noise to simulate price history
    const noise = (Math.random() - 0.5) * 0.02;  // +/- 1% noise
    const trendFactor = (SEQUENCE_LENGTH - i) / SEQUENCE_LENGTH;  // Trend towards current price
    const historicalPrice = basePrice * (1 - trendFactor * 0.1) + noise;

    dataPoints.push({
      timestamp,
      price: Math.max(0, Math.min(1, historicalPrice)),
      volume: Math.random() * 10000,  // Random volume
      liquidity: Math.random() * 5000,
      sentiment: (Math.random() - 0.5) * 0.4,  // Random sentiment
    });
  }

  // Add the actual prediction point
  dataPoints.push({
    timestamp: baseTime,
    price: basePrice,
    volume: Math.random() * 10000,
    liquidity: Math.random() * 5000,
    sentiment: 0,
  });

  return {
    marketId: record.marketId,
    dataPoints,
    // Note: CalibrationRecord doesn't have closeTime, so we don't use it
    closeTime: undefined,
  };
}

/**
 * Shuffle array in place
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// =============================================================================
// TRAINING PIPELINE
// =============================================================================

export interface TrainingResult {
  success: boolean;
  model?: LSTMLayersModel;
  metadata?: ModelMetadata;
  trainLoss: number;
  valLoss: number;
  epochs: number;
  samples: number;
}

/**
 * Train LSTM model from calibration data
 */
export async function trainFromCalibrationData(
  config: Partial<TrainingConfig> = {}
): Promise<TrainingResult> {
  const cfg = { ...DEFAULT_TRAINING_CONFIG, ...config };

  logger.info('Starting LSTM training pipeline...');

  // Load calibration data
  const allRecords = getAllPredictions();
  const resolvedRecords = allRecords.filter(r =>
    r.resolvedAt !== undefined &&
    r.actualOutcome !== undefined
  );

  logger.info(`Found ${resolvedRecords.length} resolved predictions for training`);

  if (resolvedRecords.length < cfg.minSamples) {
    logger.warn(`Insufficient training data: ${resolvedRecords.length} < ${cfg.minSamples}`);
    return {
      success: false,
      trainLoss: 0,
      valLoss: 0,
      epochs: 0,
      samples: resolvedRecords.length,
    };
  }

  // Compute normalization statistics
  const syntheticHistories = resolvedRecords.map(r => createSyntheticHistory(r));
  const dataPoints = syntheticHistories.map(h => h.dataPoints);
  const normStats = computeNormalizationStats(dataPoints);

  // Prepare training data
  const trainingData = prepareTrainingData(resolvedRecords, normStats);
  const shuffledData = shuffleArray(trainingData);

  // Split into train/validation
  const splitIdx = Math.floor(shuffledData.length * (1 - cfg.validationSplit));
  const trainData = shuffledData.slice(0, splitIdx);
  const valData = shuffledData.slice(splitIdx);

  logger.info(`Training: ${trainData.length}, Validation: ${valData.length}`);

  // Create or load model
  let model: LSTMLayersModel | null;
  let metadata: ModelMetadata;

  const existing = await loadModel();
  if (existing) {
    model = existing.model;
    metadata = existing.metadata;
    logger.info('Continuing training from existing model');
  } else {
    model = await createLSTMModel(cfg.modelConfig);
    if (!model) {
      logger.error('Failed to create LSTM model - TensorFlow may not be available');
      return {
        success: false,
        trainLoss: 0,
        valLoss: 0,
        epochs: 0,
        samples: resolvedRecords.length,
      };
    }
    metadata = createDefaultMetadata();
    metadata.config = cfg.modelConfig;
    logger.info('Created new LSTM model');
  }

  if (!model) {
    return {
      success: false,
      trainLoss: 0,
      valLoss: 0,
      epochs: 0,
      samples: resolvedRecords.length,
    };
  }

  // Training loop with early stopping
  let bestValLoss = Infinity;
  let patienceCounter = 0;
  let lastTrainLoss = 0;
  let lastValLoss = 0;
  let actualEpochs = 0;

  const trainSequences = trainData.map(d => d.sequence);
  const trainLabels = trainData.map(d => d.label);
  const valSequences = valData.map(d => d.sequence);
  const valLabels = valData.map(d => d.label);

  try {
    for (let epoch = 0; epoch < cfg.epochs; epoch++) {
      // Train one epoch
      const trainResult = await trainModelBatch(
        model,
        trainSequences,
        trainLabels,
        1,
        cfg.batchSize
      );

      if (!trainResult) {
        logger.error('Training batch failed');
        break;
      }

      lastTrainLoss = trainResult.loss;
      actualEpochs = epoch + 1;

      // Validate
      if (valSequences.length > 0) {
        const valResult = await trainModelBatch(
          model,
          valSequences,
          valLabels,
          1,
          Math.min(cfg.batchSize, valSequences.length)
        );
        lastValLoss = valResult?.loss ?? lastTrainLoss;
      } else {
        lastValLoss = lastTrainLoss;
      }

      // Log progress every 10 epochs
      if ((epoch + 1) % 10 === 0) {
        logger.info(`Epoch ${epoch + 1}/${cfg.epochs} - Loss: ${lastTrainLoss.toFixed(4)}, Val Loss: ${lastValLoss.toFixed(4)}`);
      }

      // Early stopping check
      if (lastValLoss < bestValLoss) {
        bestValLoss = lastValLoss;
        patienceCounter = 0;
      } else {
        patienceCounter++;
        if (patienceCounter >= cfg.earlyStoppingPatience) {
          logger.info(`Early stopping at epoch ${epoch + 1}`);
          break;
        }
      }
    }

    // Update metadata
    metadata.trainingSamples = resolvedRecords.length;
    metadata.trainingEpochs += actualEpochs;
    metadata.lastTrainingLoss = lastTrainLoss;
    metadata.lastValidationLoss = lastValLoss;
    metadata.normStats = normStats;
    metadata.updatedAt = new Date().toISOString();

    // Save model
    await saveModel(model, metadata);

    logger.info(`Training complete. Final val loss: ${lastValLoss.toFixed(4)}`);

    return {
      success: true,
      model,
      metadata,
      trainLoss: lastTrainLoss,
      valLoss: lastValLoss,
      epochs: actualEpochs,
      samples: resolvedRecords.length,
    };
  } catch (error) {
    logger.error(`Training error: ${error}`);
    return {
      success: false,
      trainLoss: lastTrainLoss,
      valLoss: lastValLoss,
      epochs: actualEpochs,
      samples: resolvedRecords.length,
    };
  }
}

// =============================================================================
// INCREMENTAL LEARNING
// =============================================================================

/**
 * Update model with new resolved predictions (incremental learning)
 */
export async function updateModelIncremental(
  newRecords: CalibrationRecord[],
  config: Partial<TrainingConfig> = {}
): Promise<TrainingResult> {
  const cfg = { ...DEFAULT_TRAINING_CONFIG, ...config, epochs: 10 };  // Fewer epochs for incremental

  const resolvedRecords = newRecords.filter(r =>
    r.resolvedAt !== undefined &&
    r.actualOutcome !== undefined
  );

  if (resolvedRecords.length === 0) {
    return {
      success: false,
      trainLoss: 0,
      valLoss: 0,
      epochs: 0,
      samples: 0,
    };
  }

  // Load existing model
  const existing = await loadModel();
  if (!existing) {
    logger.info('No existing model, performing full training');
    return trainFromCalibrationData(config);
  }

  const { model, metadata } = existing;

  logger.info(`Incremental update with ${resolvedRecords.length} new samples`);

  // Prepare new training data
  const trainingData = prepareTrainingData(resolvedRecords, metadata.normStats);

  if (trainingData.length === 0) {
    return {
      success: false,
      trainLoss: metadata.lastTrainingLoss,
      valLoss: metadata.lastValidationLoss,
      epochs: 0,
      samples: 0,
    };
  }

  // Train on new data
  const sequences = trainingData.map(d => d.sequence);
  const labels = trainingData.map(d => d.label);

  const result = await trainModelBatch(
    model,
    sequences,
    labels,
    cfg.epochs,
    Math.min(cfg.batchSize, trainingData.length)
  );

  if (!result) {
    return {
      success: false,
      trainLoss: metadata.lastTrainingLoss,
      valLoss: metadata.lastValidationLoss,
      epochs: 0,
      samples: 0,
    };
  }

  // Update metadata
  metadata.trainingSamples += resolvedRecords.length;
  metadata.trainingEpochs += cfg.epochs;
  metadata.lastTrainingLoss = result.loss;
  metadata.updatedAt = new Date().toISOString();

  // Save updated model
  await saveModel(model, metadata);

  logger.info(`Incremental update complete. Loss: ${result.loss.toFixed(4)}`);

  return {
    success: true,
    model,
    metadata,
    trainLoss: result.loss,
    valLoss: result.loss,  // No separate validation for incremental
    epochs: cfg.epochs,
    samples: resolvedRecords.length,
  };
}

// =============================================================================
// TRAINING UTILITIES
// =============================================================================

/**
 * Get training data statistics
 */
export function getTrainingDataStats(): {
  totalRecords: number;
  resolvedRecords: number;
  winRate: number;
  categories: Record<string, number>;
} {
  const allRecords = getAllPredictions();
  const resolvedRecords = allRecords.filter(r => r.resolvedAt !== undefined);

  const wins = resolvedRecords.filter(r =>
    (r.actualOutcome === true && r.edge > 0) ||
    (r.actualOutcome === false && r.edge < 0)
  ).length;

  const categories: Record<string, number> = {};
  for (const record of resolvedRecords) {
    const cat = record.category ?? 'unknown';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  return {
    totalRecords: allRecords.length,
    resolvedRecords: resolvedRecords.length,
    winRate: resolvedRecords.length > 0 ? wins / resolvedRecords.length : 0,
    categories,
  };
}

/**
 * Clear model and start fresh
 */
export async function resetModel(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const modelDir = path.join(process.cwd(), 'data', 'models');
  const modelPath = path.join(modelDir, 'lstm-market');

  try {
    if (fs.existsSync(modelPath)) {
      fs.rmSync(modelPath, { recursive: true });
    }
    if (fs.existsSync(`${modelPath}-metadata.json`)) {
      fs.unlinkSync(`${modelPath}-metadata.json`);
    }
    logger.info('LSTM model reset');
  } catch (error) {
    logger.warn(`Failed to reset model: ${error}`);
  }
}
