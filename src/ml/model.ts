/**
 * Logistic Regression Model for Edge Prediction
 *
 * A simple but effective model for binary classification:
 * - Online learning via stochastic gradient descent
 * - L2 regularization to prevent overfitting
 * - Supports incremental updates as new data arrives
 * - No external dependencies required
 */

import * as fs from 'fs';
import * as path from 'path';
import { NUM_FEATURES, type FeatureVector, type FeatureStats, createEmptyStats } from './features.js';
import { logger } from '../utils/index.js';

// =============================================================================
// MODEL DEFINITION
// =============================================================================

export interface ModelWeights {
  weights: number[];
  bias: number;
  learningRate: number;
  regularization: number;
}

export interface TrainingMetrics {
  epoch: number;
  loss: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
}

export interface EdgeModel {
  version: string;
  weights: ModelWeights;
  stats: FeatureStats;
  metrics: TrainingMetrics;
  trainingSamples: number;
  lastUpdated: string;
  featureImportance: { name: string; importance: number }[];
}

// =============================================================================
// MODEL PERSISTENCE
// =============================================================================

const MODEL_DIR = path.join(process.cwd(), 'data');
const MODEL_FILE = path.join(MODEL_DIR, 'edge-model.json');

/**
 * Save model to disk
 */
export function saveModel(model: EdgeModel): void {
  try {
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }
    fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
    logger.info(`Model saved with ${model.trainingSamples} training samples`);
  } catch (error) {
    logger.error(`Failed to save model: ${error}`);
  }
}

/**
 * Load model from disk
 */
export function loadModel(): EdgeModel | null {
  try {
    if (fs.existsSync(MODEL_FILE)) {
      const data = fs.readFileSync(MODEL_FILE, 'utf-8');
      const model = JSON.parse(data) as EdgeModel;
      logger.info(`Loaded model v${model.version} with ${model.trainingSamples} samples`);
      return model;
    }
  } catch (error) {
    logger.warn(`Failed to load model: ${error}`);
  }
  return null;
}

/**
 * Create a new untrained model
 */
export function createNewModel(): EdgeModel {
  return {
    version: '1.0.0',
    weights: {
      weights: new Array(NUM_FEATURES).fill(0),
      bias: 0,
      learningRate: 0.01,
      regularization: 0.001,
    },
    stats: createEmptyStats(),
    metrics: {
      epoch: 0,
      loss: 0,
      accuracy: 0.5,
      precision: 0,
      recall: 0,
      f1Score: 0,
      auc: 0.5,
    },
    trainingSamples: 0,
    lastUpdated: new Date().toISOString(),
    featureImportance: [],
  };
}

// =============================================================================
// LOGISTIC REGRESSION
// =============================================================================

/**
 * Sigmoid activation function
 */
function sigmoid(x: number): number {
  // Clip to prevent overflow
  const clipped = Math.max(-500, Math.min(500, x));
  return 1 / (1 + Math.exp(-clipped));
}

/**
 * Compute prediction probability
 */
export function predict(features: FeatureVector, weights: ModelWeights): number {
  let z = weights.bias;
  for (let i = 0; i < features.length; i++) {
    // Handle NaN/Infinity in features
    const f = Number.isFinite(features[i]) ? features[i] : 0;
    const w = Number.isFinite(weights.weights[i]) ? weights.weights[i] : 0;
    z += f * w;
  }
  // Handle NaN in final result
  if (!Number.isFinite(z)) {
    return 0.5;  // Return neutral prediction for invalid inputs
  }
  return sigmoid(z);
}

/**
 * Binary cross-entropy loss
 */
export function computeLoss(predictions: number[], labels: number[]): number {
  const eps = 1e-7;
  let loss = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, predictions[i]));
    loss -= labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p);
  }
  return loss / predictions.length;
}

/**
 * Perform one step of stochastic gradient descent
 */
export function sgdStep(
  features: FeatureVector,
  label: number,
  weights: ModelWeights
): void {
  const pred = predict(features, weights);
  const error = pred - label;
  const lr = weights.learningRate;
  const reg = weights.regularization;

  // Update weights with L2 regularization
  for (let i = 0; i < features.length; i++) {
    const gradient = error * features[i] + reg * weights.weights[i];
    weights.weights[i] -= lr * gradient;
  }

  // Update bias (no regularization on bias)
  weights.bias -= lr * error;
}

/**
 * Train model on a batch of samples
 */
export function trainBatch(
  model: EdgeModel,
  features: FeatureVector[],
  labels: number[],
  epochs: number = 10
): TrainingMetrics {
  const n = features.length;
  if (n === 0) {
    return model.metrics;
  }

  // Shuffle indices for each epoch
  const indices = Array.from({ length: n }, (_, i) => i);

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Fisher-Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // SGD over shuffled samples
    for (const i of indices) {
      sgdStep(features[i], labels[i], model.weights);
    }

    // Decay learning rate
    model.weights.learningRate *= 0.99;
  }

  // Compute final metrics
  const predictions = features.map(f => predict(f, model.weights));
  const metrics = computeMetrics(predictions, labels);
  metrics.epoch = model.metrics.epoch + epochs;

  model.metrics = metrics;
  model.trainingSamples += n;
  model.lastUpdated = new Date().toISOString();

  return metrics;
}

// =============================================================================
// EVALUATION METRICS
// =============================================================================

/**
 * Compute classification metrics
 */
export function computeMetrics(predictions: number[], labels: number[]): TrainingMetrics {
  const n = predictions.length;
  if (n === 0) {
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

  const loss = computeLoss(predictions, labels);

  // Confusion matrix (threshold = 0.5)
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < n; i++) {
    const pred = predictions[i] >= 0.5 ? 1 : 0;
    if (pred === 1 && labels[i] === 1) tp++;
    else if (pred === 1 && labels[i] === 0) fp++;
    else if (pred === 0 && labels[i] === 0) tn++;
    else fn++;
  }

  const accuracy = (tp + tn) / n;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  // Compute AUC using trapezoidal rule
  const auc = computeAUC(predictions, labels);

  return {
    epoch: 0,
    loss,
    accuracy,
    precision,
    recall,
    f1Score,
    auc,
  };
}

/**
 * Compute Area Under ROC Curve
 */
function computeAUC(predictions: number[], labels: number[]): number {
  // Sort by prediction score descending
  const pairs = predictions.map((p, i) => ({ pred: p, label: labels[i] }));
  pairs.sort((a, b) => b.pred - a.pred);

  const nPos = labels.filter(l => l === 1).length;
  const nNeg = labels.filter(l => l === 0).length;

  if (nPos === 0 || nNeg === 0) return 0.5;

  // Count inversions (Wilcoxon-Mann-Whitney statistic)
  let tpSum = 0;
  let auc = 0;

  for (const pair of pairs) {
    if (pair.label === 1) {
      tpSum++;
    } else {
      auc += tpSum;
    }
  }

  return auc / (nPos * nNeg);
}

// =============================================================================
// FEATURE IMPORTANCE
// =============================================================================

import { FEATURE_NAMES } from './features.js';

/**
 * Compute feature importance from model weights
 */
export function computeFeatureImportance(model: EdgeModel): { name: string; importance: number }[] {
  const weights = model.weights.weights;
  const absWeights = weights.map(Math.abs);
  const totalWeight = absWeights.reduce((a, b) => a + b, 0) || 1;

  return FEATURE_NAMES.map((name, i) => ({
    name,
    importance: absWeights[i] / totalWeight,
  }))
    .sort((a, b) => b.importance - a.importance);
}

/**
 * Format feature importance for display
 */
export function formatFeatureImportance(importance: { name: string; importance: number }[]): string {
  const lines = ['**Top Feature Importance:**', ''];

  for (const { name, importance: imp } of importance.slice(0, 10)) {
    const bar = '█'.repeat(Math.round(imp * 50));
    lines.push(`  ${name.padEnd(25)} ${bar} ${(imp * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}
