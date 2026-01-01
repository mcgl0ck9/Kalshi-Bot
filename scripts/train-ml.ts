/**
 * ML Model Training Script
 *
 * Usage:
 *   npx tsx scripts/train-ml.ts [options]
 *
 * Options:
 *   --epochs N       Number of training epochs (default: 50)
 *   --lr N           Learning rate (default: 0.01)
 *   --reg N          Regularization strength (default: 0.001)
 *   --synthetic      Generate synthetic training data for testing
 *   --status         Show model status and exit
 */

import { trainFromCalibrationData } from '../src/ml/trainer.js';
import { getModelStatus, clearModelCache } from '../src/ml/scorer.js';
import { loadModel, saveModel, createNewModel, formatFeatureImportance } from '../src/ml/model.js';
import { getAllPredictions, initializeCalibrationTracker, recordPrediction, resolvePrediction } from '../src/edge/calibration-tracker.js';

// Parse command line args
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

async function main() {
  console.log('='.repeat(60));
  console.log('ML Model Training for Edge Prediction');
  console.log('='.repeat(60));
  console.log();

  // Initialize calibration tracker
  initializeCalibrationTracker();

  // Check for status flag
  if (hasFlag('status')) {
    showStatus();
    return;
  }

  // Check for synthetic data generation
  if (hasFlag('synthetic')) {
    await generateSyntheticData();
  }

  // Get training config from args
  const epochs = parseInt(getArg('epochs') ?? '50', 10);
  const learningRate = parseFloat(getArg('lr') ?? '0.01');
  const regularization = parseFloat(getArg('reg') ?? '0.001');

  console.log('Training configuration:');
  console.log(`  Epochs: ${epochs}`);
  console.log(`  Learning Rate: ${learningRate}`);
  console.log(`  Regularization: ${regularization}`);
  console.log();

  // Check available training data
  const predictions = getAllPredictions();
  const resolved = predictions.filter(p => p.resolvedAt !== undefined);

  console.log(`Available training data:`);
  console.log(`  Total predictions: ${predictions.length}`);
  console.log(`  Resolved: ${resolved.length}`);
  console.log(`  Pending: ${predictions.length - resolved.length}`);
  console.log();

  if (resolved.length < 20) {
    console.log('WARNING: Not enough training data for reliable model.');
    console.log('Need at least 20 resolved predictions.');
    console.log();
    console.log('Options:');
    console.log('  1. Run more scans and wait for markets to resolve');
    console.log('  2. Use --synthetic flag to generate test data');
    console.log();

    if (!hasFlag('synthetic')) {
      return;
    }
  }

  // Train model
  console.log('Training model...');
  console.log();

  const model = await trainFromCalibrationData({
    epochs,
    learningRate,
    regularization,
  });

  if (!model) {
    console.log('Training failed or insufficient data.');
    return;
  }

  // Clear cache to pick up new model
  clearModelCache();

  // Show results
  console.log();
  console.log('Training complete!');
  console.log('='.repeat(60));
  showStatus();

  // Show feature importance
  console.log();
  console.log(formatFeatureImportance(model.featureImportance));
}

function showStatus() {
  const status = getModelStatus();

  console.log('Model Status:');
  console.log(`  Available: ${status.available ? 'Yes' : 'No'}`);

  if (status.available) {
    console.log(`  Version: ${status.version}`);
    console.log(`  Training Samples: ${status.trainingSamples}`);
    console.log(`  Last Updated: ${status.lastUpdated}`);
    console.log(`  Accuracy: ${(status.accuracy * 100).toFixed(1)}%`);
  }

  const predictions = getAllPredictions();
  const resolved = predictions.filter(p => p.resolvedAt !== undefined);
  const profitable = resolved.filter(p => (p.profitLoss ?? 0) > 0);

  console.log();
  console.log('Prediction Stats:');
  console.log(`  Total: ${predictions.length}`);
  console.log(`  Resolved: ${resolved.length}`);
  console.log(`  Profitable: ${profitable.length} (${resolved.length > 0 ? ((profitable.length / resolved.length) * 100).toFixed(1) : 0}%)`);

  if (resolved.length > 0) {
    const totalPnL = resolved.reduce((sum, p) => sum + (p.profitLoss ?? 0), 0);
    console.log(`  Total P&L: $${totalPnL.toFixed(2)}`);
    const avgBrier = resolved.reduce((sum, p) => sum + (p.brierContribution ?? 0), 0) / resolved.length;
    console.log(`  Avg Brier: ${avgBrier.toFixed(4)}`);
  }
}

async function generateSyntheticData() {
  console.log('Generating synthetic training data for testing...');
  console.log();

  // Categories with realistic win rates
  const categories = [
    { name: 'sports', winRate: 0.52 },
    { name: 'politics', winRate: 0.48 },
    { name: 'weather', winRate: 0.55 },
    { name: 'macro', winRate: 0.45 },
    { name: 'entertainment', winRate: 0.50 },
  ];

  const signalSources = [
    'cross_platform',
    'sentiment',
    'whale_activity',
    'options_data',
    'base_rate',
  ];

  let created = 0;
  const now = Date.now();

  for (let i = 0; i < 50; i++) {
    const cat = categories[Math.floor(Math.random() * categories.length)];
    const edge = 0.05 + Math.random() * 0.15;  // 5-20% edge
    const confidence = 0.5 + Math.random() * 0.4;  // 50-90% confidence
    const marketPrice = 0.3 + Math.random() * 0.4;  // 30-70c

    // Select 1-3 signal sources
    const numSources = 1 + Math.floor(Math.random() * 3);
    const sources = signalSources
      .sort(() => Math.random() - 0.5)
      .slice(0, numSources);

    const id = recordPrediction({
      marketId: `synthetic_${i}_${now}`,
      marketTitle: `Synthetic ${cat.name} market #${i}`,
      platform: 'kalshi',
      category: cat.name,
      ourEstimate: marketPrice + edge,
      marketPrice,
      confidence,
      signalSources: sources,
    });

    // Immediately resolve with probabilistic outcome
    // Higher edge + higher confidence = higher win rate
    const baseWinRate = cat.winRate;
    const edgeBonus = edge * 0.5;
    const confBonus = (confidence - 0.5) * 0.2;
    const winProb = baseWinRate + edgeBonus + confBonus;

    const won = Math.random() < winProb;
    resolvePrediction(`synthetic_${i}_${now}`, won);

    created++;
  }

  console.log(`Created ${created} synthetic predictions.`);
  console.log();
}

main().catch(console.error);
