/**
 * Machine Learning Module for Edge Prediction
 *
 * This module provides:
 * 1. Feature extraction from edge opportunities
 * 2. Model training on historical predictions
 * 3. Edge scoring and ranking
 * 4. Model persistence and loading
 *
 * Uses a gradient-free approach (no external ML libraries required):
 * - Logistic regression with online learning
 * - Feature importance via correlation analysis
 * - Incremental model updates as new data arrives
 */

export * from './features.js';
export * from './model.js';
export * from './trainer.js';
export * from './scorer.js';
