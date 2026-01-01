/**
 * ML Model Unit Tests
 *
 * Tests the logistic regression model for edge prediction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNewModel,
  predict,
  trainBatch,
  computeMetrics,
  computeFeatureImportance,
  type EdgeModel,
} from '../model.js';
import {
  extractFeatures,
  normalizeFeatures,
  updateStats,
  createEmptyStats,
  NUM_FEATURES,
  type FeatureVector,
} from '../features.js';
import type { EdgeOpportunity, Market } from '../../types/index.js';

describe('ML Model', () => {
  describe('createNewModel', () => {
    it('should create a model with correct structure', () => {
      const model = createNewModel();

      expect(model.version).toBe('1.0.0');
      expect(model.weights.weights).toHaveLength(NUM_FEATURES);
      expect(model.weights.bias).toBe(0);
      expect(model.trainingSamples).toBe(0);
      expect(model.stats.count).toBe(0);
    });

    it('should initialize weights to zero', () => {
      const model = createNewModel();

      for (const weight of model.weights.weights) {
        expect(weight).toBe(0);
      }
    });
  });

  describe('predict', () => {
    it('should return 0.5 for zero weights (untrained model)', () => {
      const model = createNewModel();
      const features = new Array(NUM_FEATURES).fill(0);

      const prediction = predict(features, model.weights);

      expect(prediction).toBeCloseTo(0.5, 5);
    });

    it('should return value between 0 and 1', () => {
      const model = createNewModel();
      // Set some weights to create non-neutral prediction
      model.weights.weights[0] = 1.0;
      model.weights.bias = 0.5;

      const features = new Array(NUM_FEATURES).fill(0);
      features[0] = 2.0;

      const prediction = predict(features, model.weights);

      expect(prediction).toBeGreaterThan(0);
      expect(prediction).toBeLessThan(1);
    });

    it('should handle NaN in features gracefully', () => {
      const model = createNewModel();
      const features = new Array(NUM_FEATURES).fill(NaN);

      const prediction = predict(features, model.weights);

      expect(Number.isNaN(prediction)).toBe(false);
      expect(prediction).toBeCloseTo(0.5, 5);
    });

    it('should handle Infinity in features gracefully', () => {
      const model = createNewModel();
      const features = new Array(NUM_FEATURES).fill(Infinity);

      const prediction = predict(features, model.weights);

      expect(Number.isFinite(prediction)).toBe(true);
    });
  });

  describe('trainBatch', () => {
    it('should update training sample count', () => {
      const model = createNewModel();
      const features = [new Array(NUM_FEATURES).fill(0.1)];
      const labels = [1];

      trainBatch(model, features, labels, 1);

      expect(model.trainingSamples).toBe(1);
    });

    it('should update model weights after training', () => {
      const model = createNewModel();
      const initialWeights = [...model.weights.weights];

      // Create training data with clear pattern
      const features: FeatureVector[] = [];
      const labels: number[] = [];

      for (let i = 0; i < 20; i++) {
        const f = new Array(NUM_FEATURES).fill(0);
        f[0] = i % 2 === 0 ? 1 : -1;  // Feature correlates with label
        features.push(f);
        labels.push(i % 2);
      }

      trainBatch(model, features, labels, 10);

      // At least some weights should have changed
      const weightsChanged = model.weights.weights.some(
        (w, i) => w !== initialWeights[i]
      );
      expect(weightsChanged).toBe(true);
    });

    it('should return metrics after training', () => {
      const model = createNewModel();
      const features = [
        new Array(NUM_FEATURES).fill(0.5),
        new Array(NUM_FEATURES).fill(-0.5),
      ];
      const labels = [1, 0];

      const metrics = trainBatch(model, features, labels, 5);

      expect(metrics).toHaveProperty('accuracy');
      expect(metrics).toHaveProperty('loss');
      expect(metrics).toHaveProperty('auc');
      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
    });
  });

  describe('computeMetrics', () => {
    it('should compute perfect accuracy for correct predictions', () => {
      const predictions = [0.9, 0.1, 0.8, 0.2];
      const labels = [1, 0, 1, 0];

      const metrics = computeMetrics(predictions, labels);

      expect(metrics.accuracy).toBe(1);
    });

    it('should compute zero accuracy for all wrong predictions', () => {
      const predictions = [0.1, 0.9, 0.2, 0.8];
      const labels = [1, 0, 1, 0];

      const metrics = computeMetrics(predictions, labels);

      expect(metrics.accuracy).toBe(0);
    });

    it('should compute AUC of 1 for perfect ranking', () => {
      const predictions = [0.9, 0.8, 0.2, 0.1];
      const labels = [1, 1, 0, 0];

      const metrics = computeMetrics(predictions, labels);

      expect(metrics.auc).toBe(1);
    });

    it('should handle empty arrays', () => {
      const metrics = computeMetrics([], []);

      expect(metrics.accuracy).toBe(0);
      expect(metrics.auc).toBe(0.5);
    });
  });

  describe('computeFeatureImportance', () => {
    it('should return importance for all features', () => {
      const model = createNewModel();
      model.weights.weights[0] = 2.0;
      model.weights.weights[1] = -1.0;

      const importance = computeFeatureImportance(model);

      expect(importance).toHaveLength(NUM_FEATURES);
    });

    it('should rank higher weight features first', () => {
      const model = createNewModel();
      model.weights.weights[0] = 0.1;
      model.weights.weights[5] = 2.0;  // Highest weight

      const importance = computeFeatureImportance(model);

      // First item should be the feature with highest absolute weight
      expect(importance[0].importance).toBeGreaterThan(importance[1].importance);
    });

    it('should have importance values sum to approximately 1', () => {
      const model = createNewModel();
      model.weights.weights[0] = 1.0;
      model.weights.weights[1] = 2.0;
      model.weights.weights[2] = 0.5;

      const importance = computeFeatureImportance(model);
      const total = importance.reduce((sum, i) => sum + i.importance, 0);

      expect(total).toBeCloseTo(1, 5);
    });
  });
});

describe('Feature Extraction', () => {
  const createMockOpportunity = (overrides: Partial<EdgeOpportunity> = {}): EdgeOpportunity => {
    const market: Market = {
      platform: 'kalshi',
      id: 'test-market',
      title: 'Test Market',
      category: 'sports',
      price: 0.65,
      volume: 10000,
      url: 'https://kalshi.com/test',
    };

    return {
      market,
      source: 'combined',
      edge: 0.10,
      confidence: 0.75,
      urgency: 'standard',
      direction: 'BUY YES',
      signals: {},
      ...overrides,
    };
  };

  describe('extractFeatures', () => {
    it('should return correct number of features', () => {
      const opportunity = createMockOpportunity();
      const features = extractFeatures(opportunity);

      expect(features).toHaveLength(NUM_FEATURES);
    });

    it('should extract edge magnitude correctly', () => {
      const opportunity = createMockOpportunity({ edge: 0.15 });
      const features = extractFeatures(opportunity);

      expect(features[0]).toBe(0.15);  // edge_magnitude
    });

    it('should extract direction as 1 for BUY YES', () => {
      const opportunity = createMockOpportunity({ direction: 'BUY YES' });
      const features = extractFeatures(opportunity);

      expect(features[1]).toBe(1);  // edge_direction
    });

    it('should extract direction as -1 for BUY NO', () => {
      const opportunity = createMockOpportunity({ direction: 'BUY NO' });
      const features = extractFeatures(opportunity);

      expect(features[1]).toBe(-1);  // edge_direction
    });

    it('should extract confidence correctly', () => {
      const opportunity = createMockOpportunity({ confidence: 0.80 });
      const features = extractFeatures(opportunity);

      expect(features[2]).toBe(0.80);  // confidence
    });

    it('should encode urgency levels correctly', () => {
      const critical = createMockOpportunity({ urgency: 'critical' });
      const standard = createMockOpportunity({ urgency: 'standard' });
      const fyi = createMockOpportunity({ urgency: 'fyi' });

      expect(extractFeatures(critical)[3]).toBe(1);     // urgency_score
      expect(extractFeatures(standard)[3]).toBe(0.5);
      expect(extractFeatures(fyi)[3]).toBe(0.2);
    });

    it('should encode signal sources as one-hot', () => {
      const withCrossPlatform = createMockOpportunity({
        signals: { crossPlatform: {} as never },
      });
      const features = extractFeatures(withCrossPlatform);

      expect(features[7]).toBe(1);  // src_cross_platform
    });

    it('should count multiple signals', () => {
      const withMultipleSignals = createMockOpportunity({
        signals: {
          crossPlatform: {} as never,
          sentiment: {} as never,
          sportsConsensus: 0.65,
        },
      });
      const features = extractFeatures(withMultipleSignals);

      expect(features[16]).toBeGreaterThanOrEqual(2);  // signal_count
      expect(features[17]).toBe(1);  // signal_agreement (multiple signals)
    });
  });

  describe('normalizeFeatures', () => {
    it('should normalize features using stats', () => {
      const stats = createEmptyStats();
      stats.means[0] = 0.1;
      stats.stds[0] = 0.05;
      stats.count = 10;

      const features = new Array(NUM_FEATURES).fill(0);
      features[0] = 0.2;  // 2 standard deviations above mean

      const normalized = normalizeFeatures(features, stats);

      expect(normalized[0]).toBeCloseTo(2, 1);  // (0.2 - 0.1) / 0.05 = 2
    });

    it('should handle NaN in features', () => {
      const stats = createEmptyStats();
      const features = new Array(NUM_FEATURES).fill(NaN);

      const normalized = normalizeFeatures(features, stats);

      for (const val of normalized) {
        expect(Number.isNaN(val)).toBe(false);
      }
    });

    it('should clip extreme values', () => {
      const stats = createEmptyStats();
      stats.means[0] = 0;
      stats.stds[0] = 0.001;  // Very small std
      stats.count = 10;

      const features = new Array(NUM_FEATURES).fill(0);
      features[0] = 100;  // Would be 100000 std devs without clipping

      const normalized = normalizeFeatures(features, stats);

      expect(normalized[0]).toBeLessThanOrEqual(10);
      expect(normalized[0]).toBeGreaterThanOrEqual(-10);
    });
  });

  describe('updateStats', () => {
    it('should update count', () => {
      const stats = createEmptyStats();
      const features = new Array(NUM_FEATURES).fill(0.5);

      updateStats(stats, features);

      expect(stats.count).toBe(1);
    });

    it('should update min and max', () => {
      const stats = createEmptyStats();

      updateStats(stats, new Array(NUM_FEATURES).fill(0.5));
      updateStats(stats, new Array(NUM_FEATURES).fill(0.2));
      updateStats(stats, new Array(NUM_FEATURES).fill(0.8));

      expect(stats.mins[0]).toBe(0.2);
      expect(stats.maxs[0]).toBe(0.8);
    });

    it('should compute running mean', () => {
      const stats = createEmptyStats();

      updateStats(stats, new Array(NUM_FEATURES).fill(1));
      updateStats(stats, new Array(NUM_FEATURES).fill(3));

      expect(stats.means[0]).toBe(2);  // (1 + 3) / 2
    });
  });
});
