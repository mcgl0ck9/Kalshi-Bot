/**
 * TensorFlow.js LSTM Model for Market Prediction
 *
 * Implements a deep LSTM network for predicting market movements:
 * - Takes historical price, volume, sentiment as inputs
 * - Predicts probability of price movement
 * - Outputs confidence score
 *
 * Architecture inspired by:
 * - MDPI 2024: LSTM, TCN, N-BEATS for market prediction
 * - arXiv 2408.12408: Deep learning trend prediction evaluation
 *
 * NOTE: This module requires @tensorflow/tfjs-node to be installed.
 * If not available, functions will return null/throw appropriate errors.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SEQUENCE_LENGTH, NUM_FEATURES, type NormalizationStats, DEFAULT_NORMALIZATION_STATS } from './feature-extractor.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TENSORFLOW DYNAMIC IMPORT
// =============================================================================

// We use dynamic import to handle cases where TensorFlow isn't installed
let tfModule: typeof import('@tensorflow/tfjs-node') | null = null;
let tfAvailable = false;

/**
 * Get TensorFlow module, loading it if necessary
 */
async function getTF(): Promise<typeof import('@tensorflow/tfjs-node') | null> {
  if (tfModule) return tfModule;

  try {
    tfModule = await import('@tensorflow/tfjs-node');
    tfAvailable = true;
    return tfModule;
  } catch (error) {
    logger.warn('TensorFlow.js not available. Install with: npm install @tensorflow/tfjs-node');
    tfAvailable = false;
    return null;
  }
}

/**
 * Check if TensorFlow is available
 */
export function isTensorFlowAvailable(): boolean {
  return tfAvailable;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Model architecture configuration */
export interface LSTMModelConfig {
  /** Number of LSTM units in first layer */
  lstmUnits1: number;
  /** Number of LSTM units in second layer */
  lstmUnits2: number;
  /** Dropout rate for regularization */
  dropoutRate: number;
  /** Dense layer units before output */
  denseUnits: number;
  /** Learning rate for optimizer */
  learningRate: number;
  /** L2 regularization strength */
  l2Regularization: number;
}

/** Default model configuration */
export const DEFAULT_MODEL_CONFIG: LSTMModelConfig = {
  lstmUnits1: 64,
  lstmUnits2: 32,
  dropoutRate: 0.2,
  denseUnits: 16,
  learningRate: 0.001,
  l2Regularization: 0.001,
};

/** Model metadata */
export interface ModelMetadata {
  version: string;
  config: LSTMModelConfig;
  normStats: NormalizationStats;
  trainingSamples: number;
  trainingEpochs: number;
  lastTrainingLoss: number;
  lastValidationLoss: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// MODEL PATHS
// =============================================================================

const MODEL_DIR = path.join(process.cwd(), 'data', 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'lstm-market');
const METADATA_PATH = path.join(MODEL_DIR, 'lstm-market-metadata.json');

// =============================================================================
// MODEL CREATION
// =============================================================================

// Generic type for model to avoid import dependency
export type LSTMLayersModel = unknown;

/**
 * Create the LSTM model architecture
 *
 * Input shape: [SEQUENCE_LENGTH, NUM_FEATURES]
 * Output shape: [3] - [probUp, probDown, confidence]
 */
export async function createLSTMModel(
  config: LSTMModelConfig = DEFAULT_MODEL_CONFIG
): Promise<LSTMLayersModel | null> {
  const tf = await getTF();
  if (!tf) return null;

  const model = tf.sequential();

  // First LSTM layer with return sequences for stacking
  model.add(tf.layers.lstm({
    units: config.lstmUnits1,
    inputShape: [SEQUENCE_LENGTH, NUM_FEATURES],
    returnSequences: true,
    kernelRegularizer: tf.regularizers.l2({ l2: config.l2Regularization }),
    recurrentRegularizer: tf.regularizers.l2({ l2: config.l2Regularization }),
  }));

  // Dropout for regularization
  model.add(tf.layers.dropout({ rate: config.dropoutRate }));

  // Second LSTM layer
  model.add(tf.layers.lstm({
    units: config.lstmUnits2,
    returnSequences: false,
    kernelRegularizer: tf.regularizers.l2({ l2: config.l2Regularization }),
    recurrentRegularizer: tf.regularizers.l2({ l2: config.l2Regularization }),
  }));

  model.add(tf.layers.dropout({ rate: config.dropoutRate }));

  // Dense layer for feature extraction
  model.add(tf.layers.dense({
    units: config.denseUnits,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: config.l2Regularization }),
  }));

  // Output layer: [probUp, probDown, confidence]
  model.add(tf.layers.dense({
    units: 3,
    activation: 'sigmoid',
  }));

  // Compile with custom loss
  model.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  return model;
}

// =============================================================================
// MODEL PERSISTENCE
// =============================================================================

/**
 * Save model and metadata to disk
 */
export async function saveModel(
  model: LSTMLayersModel,
  metadata: ModelMetadata
): Promise<void> {
  const tf = await getTF();
  if (!tf || !model) {
    throw new Error('TensorFlow not available or model is null');
  }

  try {
    // Ensure directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    // Save TensorFlow model
    const tfModel = model as import('@tensorflow/tfjs-node').LayersModel;
    await tfModel.save(`file://${MODEL_PATH}`);

    // Save metadata
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));

    logger.info(`LSTM model saved with ${metadata.trainingSamples} training samples`);
  } catch (error) {
    logger.error(`Failed to save LSTM model: ${error}`);
    throw error;
  }
}

/**
 * Load model and metadata from disk
 */
export async function loadModel(): Promise<{
  model: LSTMLayersModel;
  metadata: ModelMetadata;
} | null> {
  const tf = await getTF();
  if (!tf) return null;

  try {
    // Check if model exists
    if (!fs.existsSync(`${MODEL_PATH}/model.json`)) {
      logger.debug('No saved LSTM model found');
      return null;
    }

    // Load TensorFlow model
    const model = await tf.loadLayersModel(`file://${MODEL_PATH}/model.json`);

    // Load metadata
    if (!fs.existsSync(METADATA_PATH)) {
      logger.warn('Model exists but metadata missing, creating default');
      return {
        model,
        metadata: createDefaultMetadata(),
      };
    }

    const metadataJson = fs.readFileSync(METADATA_PATH, 'utf-8');
    const metadata = JSON.parse(metadataJson) as ModelMetadata;

    logger.info(`Loaded LSTM model v${metadata.version} with ${metadata.trainingSamples} samples`);

    return { model, metadata };
  } catch (error) {
    logger.warn(`Failed to load LSTM model: ${error}`);
    return null;
  }
}

/**
 * Create default metadata for new models
 */
export function createDefaultMetadata(): ModelMetadata {
  return {
    version: '1.0.0',
    config: DEFAULT_MODEL_CONFIG,
    normStats: DEFAULT_NORMALIZATION_STATS,
    trainingSamples: 0,
    trainingEpochs: 0,
    lastTrainingLoss: 0,
    lastValidationLoss: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Check if model file exists
 */
export function modelExists(): boolean {
  return fs.existsSync(`${MODEL_PATH}/model.json`);
}

// =============================================================================
// MODEL UTILITIES
// =============================================================================

/**
 * Warm up model by running a dummy prediction
 */
export async function warmUpModel(model: LSTMLayersModel): Promise<void> {
  const tf = await getTF();
  if (!tf || !model) return;

  const tfModel = model as import('@tensorflow/tfjs-node').LayersModel;
  const dummyInput = tf.zeros([1, SEQUENCE_LENGTH, NUM_FEATURES]);
  tfModel.predict(dummyInput);
  dummyInput.dispose();
  logger.debug('LSTM model warmed up');
}

/**
 * Make prediction with model
 */
export async function predictWithModel(
  model: LSTMLayersModel,
  sequence: number[][]
): Promise<number[] | null> {
  const tf = await getTF();
  if (!tf || !model) return null;

  const tfModel = model as import('@tensorflow/tfjs-node').LayersModel;
  const inputTensor = tf.tensor3d([sequence]);
  const outputTensor = tfModel.predict(inputTensor) as import('@tensorflow/tfjs-node').Tensor;
  const output = await outputTensor.array() as number[][];

  inputTensor.dispose();
  outputTensor.dispose();

  return output[0];
}

/**
 * Train model on batch of data
 */
export async function trainModelBatch(
  model: LSTMLayersModel,
  sequences: number[][][],
  labels: number[][],
  epochs: number = 1,
  batchSize: number = 32
): Promise<{ loss: number; valLoss?: number } | null> {
  const tf = await getTF();
  if (!tf || !model) return null;

  const tfModel = model as import('@tensorflow/tfjs-node').LayersModel;
  const trainX = tf.tensor3d(sequences);
  const trainY = tf.tensor2d(labels);

  try {
    const history = await tfModel.fit(trainX, trainY, {
      epochs,
      batchSize,
      verbose: 0,
    });

    const loss = history.history['loss']?.[history.history['loss'].length - 1] as number ?? 0;
    const valLoss = history.history['val_loss']?.[history.history['val_loss'].length - 1] as number | undefined;

    return { loss, valLoss };
  } finally {
    trainX.dispose();
    trainY.dispose();
  }
}

// =============================================================================
// PREDICTION OUTPUT TYPES
// =============================================================================

/**
 * Model prediction output
 */
export interface LSTMPrediction {
  /** Probability of price increasing */
  probUp: number;
  /** Probability of price decreasing */
  probDown: number;
  /** Model confidence in prediction */
  confidence: number;
  /** Direction recommendation */
  direction: 'UP' | 'DOWN' | 'HOLD';
  /** Raw model output */
  rawOutput: number[];
}

/**
 * Parse raw model output to structured prediction
 */
export function parsePrediction(rawOutput: number[]): LSTMPrediction {
  const [probUp, probDown, confidence] = rawOutput;

  // Normalize probabilities to sum to 1
  const total = probUp + probDown;
  const normalizedUp = total > 0 ? probUp / total : 0.5;
  const normalizedDown = total > 0 ? probDown / total : 0.5;

  // Determine direction based on probability difference
  let direction: 'UP' | 'DOWN' | 'HOLD';
  const diff = normalizedUp - normalizedDown;

  if (Math.abs(diff) < 0.1) {
    direction = 'HOLD';
  } else if (diff > 0) {
    direction = 'UP';
  } else {
    direction = 'DOWN';
  }

  return {
    probUp: normalizedUp,
    probDown: normalizedDown,
    confidence: Math.max(0, Math.min(1, confidence)),
    direction,
    rawOutput,
  };
}

/**
 * Dispose tensors safely
 */
export async function disposeTensors(...items: unknown[]): Promise<void> {
  const tf = await getTF();
  if (!tf) return;

  for (const item of items) {
    if (item && typeof item === 'object' && 'dispose' in item) {
      (item as { dispose: () => void }).dispose();
    }
  }
}
