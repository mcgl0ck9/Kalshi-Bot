/**
 * Machine Learning Module for Edge Prediction
 *
 * This module provides two ML approaches:
 *
 * 1. SIMPLE (Logistic Regression - no external deps):
 *    - Feature extraction from edge opportunities
 *    - Model training on historical predictions
 *    - Edge scoring and ranking
 *    - Incremental model updates as new data arrives
 *
 * 2. ADVANCED (TensorFlow.js LSTM):
 *    - Time-series feature extraction
 *    - Deep LSTM model for market prediction
 *    - Multi-horizon prediction capabilities
 *    - GPU-accelerated training and inference
 *
 * Academic Foundation (from CLAUDE.md):
 * - LSTM, TCN, N-BEATS for market prediction
 * - Temporal Fusion Transformers (TFT) for multi-horizon prediction
 * - Deep learning trend prediction
 */

// Simple logistic regression (existing) - keep original names
export * from './features.js';
export * from './model.js';
export * from './trainer.js';
export * from './scorer.js';

// TensorFlow.js LSTM (new) - use namespace to avoid conflicts
export * as LSTMFeatures from './feature-extractor.js';
export * as LSTMModel from './lstm-model.js';
export * as LSTMTrainer from './lstm-trainer.js';
export * as LSTMPredictor from './lstm-predictor.js';
