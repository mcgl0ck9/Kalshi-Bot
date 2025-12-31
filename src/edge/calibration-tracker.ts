/**
 * Calibration Tracker
 *
 * Tracks prediction accuracy over time to:
 * - Measure Brier score
 * - Identify systematic biases
 * - Adjust confidence based on historical performance
 * - Find categories where we have edge
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/index.js';
import type {
  CalibrationRecord,
  CalibrationBucket,
  CalibrationReport,
  PredictionRecord,
} from '../types/index.js';

// =============================================================================
// STORAGE
// =============================================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');
const CALIBRATION_FILE = path.join(DATA_DIR, 'calibration.json');

// In-memory cache
let predictions: CalibrationRecord[] = [];
let lastReport: CalibrationReport | null = null;

/**
 * Initialize data directory and load existing data
 */
export function initializeCalibrationTracker(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(PREDICTIONS_FILE)) {
      const data = fs.readFileSync(PREDICTIONS_FILE, 'utf-8');
      predictions = JSON.parse(data);
      logger.info(`Loaded ${predictions.length} prediction records`);
    }

    if (fs.existsSync(CALIBRATION_FILE)) {
      const data = fs.readFileSync(CALIBRATION_FILE, 'utf-8');
      lastReport = JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Calibration tracker init error: ${error}`);
    predictions = [];
  }
}

/**
 * Save predictions to disk
 */
function savePredictions(): void {
  try {
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(predictions, null, 2));
  } catch (error) {
    logger.error(`Failed to save predictions: ${error}`);
  }
}

/**
 * Save calibration report to disk
 */
function saveReport(report: CalibrationReport): void {
  try {
    fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(report, null, 2));
    lastReport = report;
  } catch (error) {
    logger.error(`Failed to save calibration report: ${error}`);
  }
}

// =============================================================================
// PREDICTION RECORDING
// =============================================================================

/**
 * Record a new prediction
 */
export function recordPrediction(params: {
  marketId: string;
  marketTitle: string;
  platform: 'kalshi' | 'polymarket';
  category: string;
  ourEstimate: number;
  marketPrice: number;
  confidence: number;
  signalSources: string[];
}): string {
  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const record: CalibrationRecord = {
    id,
    marketId: params.marketId,
    marketTitle: params.marketTitle,
    platform: params.platform,
    category: params.category,
    predictedAt: new Date().toISOString(),
    ourEstimate: params.ourEstimate,
    marketPriceAtPrediction: params.marketPrice,
    edge: params.ourEstimate - params.marketPrice,
    confidence: params.confidence,
    signalSources: params.signalSources,
  };

  predictions.push(record);
  savePredictions();

  logger.info(`Recorded prediction ${id} for ${params.marketTitle.slice(0, 40)}...`);
  return id;
}

/**
 * Resolve a prediction with actual outcome
 */
export function resolvePrediction(
  marketId: string,
  outcome: boolean,
  finalMarketPrice?: number
): CalibrationRecord | null {
  const record = predictions.find(p => p.marketId === marketId && !p.resolvedAt);

  if (!record) {
    logger.warn(`No pending prediction found for market ${marketId}`);
    return null;
  }

  record.resolvedAt = new Date().toISOString();
  record.actualOutcome = outcome;
  record.marketPriceAtResolution = finalMarketPrice;

  // Calculate performance metrics
  const outcomeValue = outcome ? 1 : 0;
  record.brierContribution = Math.pow(record.ourEstimate - outcomeValue, 2);
  record.wasCorrectDirection = (record.ourEstimate > 0.5) === outcome;

  // Simulated P&L (assuming $100 position)
  const position = 100;
  if (record.edge > 0) {
    // We predicted higher than market
    if (outcome) {
      record.profitLoss = position * (1 - record.marketPriceAtPrediction);
    } else {
      record.profitLoss = -position * record.marketPriceAtPrediction;
    }
  } else {
    // We predicted lower than market (short YES / long NO)
    if (!outcome) {
      record.profitLoss = position * record.marketPriceAtPrediction;
    } else {
      record.profitLoss = -position * (1 - record.marketPriceAtPrediction);
    }
  }

  savePredictions();
  logger.info(`Resolved prediction for ${record.marketTitle.slice(0, 40)}... - ${outcome ? 'YES' : 'NO'}`);

  return record;
}

/**
 * Bulk resolve predictions by checking market status
 */
export async function checkAndResolvePredictions(
  getMarketOutcome: (marketId: string, platform: string) => Promise<{ resolved: boolean; outcome?: boolean } | null>
): Promise<number> {
  const pending = predictions.filter(p => !p.resolvedAt);
  let resolved = 0;

  for (const record of pending) {
    try {
      const result = await getMarketOutcome(record.marketId, record.platform);
      if (result?.resolved && result.outcome !== undefined) {
        resolvePrediction(record.marketId, result.outcome);
        resolved++;
      }
    } catch (error) {
      logger.error(`Failed to check outcome for ${record.marketId}: ${error}`);
    }
  }

  if (resolved > 0) {
    logger.info(`Resolved ${resolved} predictions`);
  }

  return resolved;
}

// =============================================================================
// CALIBRATION ANALYSIS
// =============================================================================

/**
 * Calculate calibration metrics
 */
export function calculateCalibration(): CalibrationReport {
  const resolved = predictions.filter(p => p.resolvedAt && p.actualOutcome !== undefined);
  const pending = predictions.filter(p => !p.resolvedAt);

  if (resolved.length === 0) {
    return {
      totalPredictions: predictions.length,
      resolvedPredictions: 0,
      pendingPredictions: pending.length,
      brierScore: 0,
      accuracy: 0,
      buckets: [],
      overallCalibrationError: 0,
      isOverconfident: false,
      categoryMetrics: new Map(),
      signalMetrics: new Map(),
      recentPerformance: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Calculate Brier score
  const brierScore = resolved.reduce((sum, r) => sum + (r.brierContribution ?? 0), 0) / resolved.length;

  // Calculate accuracy (% correct direction)
  const correct = resolved.filter(r => r.wasCorrectDirection).length;
  const accuracy = correct / resolved.length;

  // Calculate calibration buckets
  const buckets = calculateCalibrationBuckets(resolved);
  const overallCalibrationError = buckets.reduce((sum, b) => sum + b.calibrationError * b.count, 0) /
    buckets.reduce((sum, b) => sum + b.count, 0);

  // Overconfidence check
  const avgConfidence = resolved.reduce((sum, r) => sum + r.confidence, 0) / resolved.length;
  const isOverconfident = avgConfidence > accuracy + 0.1;

  // Category metrics
  const categoryMetrics = new Map<string, { count: number; brierScore: number; accuracy: number }>();
  const categoryGroups = groupBy(resolved, r => r.category);
  for (const [category, records] of Object.entries(categoryGroups)) {
    const catBrier = records.reduce((sum, r) => sum + (r.brierContribution ?? 0), 0) / records.length;
    const catAccuracy = records.filter(r => r.wasCorrectDirection).length / records.length;
    categoryMetrics.set(category, { count: records.length, brierScore: catBrier, accuracy: catAccuracy });
  }

  // Signal source metrics
  const signalMetrics = new Map<string, { count: number; brierScore: number; accuracy: number }>();
  const allSignals = new Set(resolved.flatMap(r => r.signalSources));
  for (const signal of allSignals) {
    const signalRecords = resolved.filter(r => r.signalSources.includes(signal));
    if (signalRecords.length >= 5) {
      const sigBrier = signalRecords.reduce((sum, r) => sum + (r.brierContribution ?? 0), 0) / signalRecords.length;
      const sigAccuracy = signalRecords.filter(r => r.wasCorrectDirection).length / signalRecords.length;
      signalMetrics.set(signal, { count: signalRecords.length, brierScore: sigBrier, accuracy: sigAccuracy });
    }
  }

  // Recent performance (last 7 days, last 30 days)
  const now = Date.now();
  const day7ago = now - 7 * 24 * 60 * 60 * 1000;
  const day30ago = now - 30 * 24 * 60 * 60 * 1000;

  const recent7 = resolved.filter(r => new Date(r.resolvedAt!).getTime() > day7ago);
  const recent30 = resolved.filter(r => new Date(r.resolvedAt!).getTime() > day30ago);

  const recentPerformance = [];
  if (recent7.length >= 3) {
    recentPerformance.push({
      period: '7 days',
      brierScore: recent7.reduce((sum, r) => sum + (r.brierContribution ?? 0), 0) / recent7.length,
      accuracy: recent7.filter(r => r.wasCorrectDirection).length / recent7.length,
    });
  }
  if (recent30.length >= 10) {
    recentPerformance.push({
      period: '30 days',
      brierScore: recent30.reduce((sum, r) => sum + (r.brierContribution ?? 0), 0) / recent30.length,
      accuracy: recent30.filter(r => r.wasCorrectDirection).length / recent30.length,
    });
  }

  const report: CalibrationReport = {
    totalPredictions: predictions.length,
    resolvedPredictions: resolved.length,
    pendingPredictions: pending.length,
    brierScore,
    accuracy,
    buckets,
    overallCalibrationError,
    isOverconfident,
    categoryMetrics,
    signalMetrics,
    recentPerformance,
    generatedAt: new Date().toISOString(),
  };

  saveReport(report);
  return report;
}

/**
 * Calculate calibration buckets
 */
function calculateCalibrationBuckets(resolved: CalibrationRecord[]): CalibrationBucket[] {
  const bucketRanges = [
    { range: '0-10%', lower: 0, upper: 0.1 },
    { range: '10-20%', lower: 0.1, upper: 0.2 },
    { range: '20-30%', lower: 0.2, upper: 0.3 },
    { range: '30-40%', lower: 0.3, upper: 0.4 },
    { range: '40-50%', lower: 0.4, upper: 0.5 },
    { range: '50-60%', lower: 0.5, upper: 0.6 },
    { range: '60-70%', lower: 0.6, upper: 0.7 },
    { range: '70-80%', lower: 0.7, upper: 0.8 },
    { range: '80-90%', lower: 0.8, upper: 0.9 },
    { range: '90-100%', lower: 0.9, upper: 1.0 },
  ];

  return bucketRanges.map(({ range, lower, upper }) => {
    const inBucket = resolved.filter(r => r.ourEstimate >= lower && r.ourEstimate < upper);
    const count = inBucket.length;
    const outcomes = inBucket.filter(r => r.actualOutcome === true).length;
    const actualFrequency = count > 0 ? outcomes / count : 0;
    const midpoint = (lower + upper) / 2;
    const calibrationError = count > 0 ? Math.abs(midpoint - actualFrequency) : 0;

    return {
      range,
      lowerBound: lower,
      upperBound: upper,
      count,
      outcomes,
      actualFrequency,
      calibrationError,
    };
  });
}

// =============================================================================
// BIAS DETECTION
// =============================================================================

/**
 * Get historical bias for a market category
 */
export function getCategoryBias(category: string): number {
  const report = lastReport ?? calculateCalibration();
  const metrics = report.categoryMetrics.get(category);

  if (!metrics || metrics.count < 10) {
    return 0; // Not enough data
  }

  // Bias = how much we typically overestimate (positive) or underestimate (negative)
  const categoryRecords = predictions.filter(p => p.category === category && p.resolvedAt);
  if (categoryRecords.length === 0) return 0;

  const avgEstimate = categoryRecords.reduce((sum, r) => sum + r.ourEstimate, 0) / categoryRecords.length;
  const avgOutcome = categoryRecords.filter(r => r.actualOutcome === true).length / categoryRecords.length;

  return avgEstimate - avgOutcome;
}

/**
 * Adjust estimate based on historical calibration
 */
export function adjustForCalibration(
  rawEstimate: number,
  category: string,
  signalSources: string[]
): { adjustedEstimate: number; confidence: number; reasoning: string } {
  const bias = getCategoryBias(category);
  let adjustedEstimate = rawEstimate - bias;

  // Clamp to valid probability range
  adjustedEstimate = Math.max(0.01, Math.min(0.99, adjustedEstimate));

  // Adjust confidence based on signal track record
  const report = lastReport ?? calculateCalibration();
  let confidenceMultiplier = 1.0;
  const reasons: string[] = [];

  for (const signal of signalSources) {
    const metrics = report.signalMetrics.get(signal);
    if (metrics && metrics.count >= 10) {
      if (metrics.accuracy > 0.6) {
        confidenceMultiplier *= 1.1;
        reasons.push(`${signal} has ${(metrics.accuracy * 100).toFixed(0)}% historical accuracy`);
      } else if (metrics.accuracy < 0.4) {
        confidenceMultiplier *= 0.8;
        reasons.push(`${signal} has poor ${(metrics.accuracy * 100).toFixed(0)}% historical accuracy`);
      }
    }
  }

  if (Math.abs(bias) > 0.05) {
    reasons.push(`Adjusted ${(bias * 100).toFixed(1)}% for ${category} category bias`);
  }

  const confidence = Math.min(0.95, Math.max(0.3, 0.7 * confidenceMultiplier));

  return {
    adjustedEstimate,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'No historical adjustments applied',
  };
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Get current calibration report
 */
export function getCalibrationReport(): CalibrationReport {
  return lastReport ?? calculateCalibration();
}

/**
 * Format calibration report for display
 */
export function formatCalibrationReport(report: CalibrationReport): string {
  const lines: string[] = [
    '📊 **Calibration Report**',
    '═══════════════════════════════',
    '',
    `Total Predictions: ${report.totalPredictions}`,
    `Resolved: ${report.resolvedPredictions} | Pending: ${report.pendingPredictions}`,
    '',
    `**Overall Metrics**`,
    `Brier Score: ${report.brierScore.toFixed(4)} (lower is better)`,
    `Accuracy: ${(report.accuracy * 100).toFixed(1)}%`,
    `Calibration Error: ${(report.overallCalibrationError * 100).toFixed(1)}%`,
    report.isOverconfident ? '⚠️ Overconfident - reduce position sizes' : '✅ Well-calibrated',
    '',
  ];

  if (report.buckets.some(b => b.count > 0)) {
    lines.push('**Calibration by Confidence**');
    for (const bucket of report.buckets.filter(b => b.count >= 3)) {
      const bar = '█'.repeat(Math.round(bucket.actualFrequency * 10));
      lines.push(`${bucket.range}: ${bar} ${(bucket.actualFrequency * 100).toFixed(0)}% actual (n=${bucket.count})`);
    }
    lines.push('');
  }

  if (report.categoryMetrics.size > 0) {
    lines.push('**By Category**');
    for (const [category, metrics] of report.categoryMetrics) {
      if (metrics.count >= 5) {
        const emoji = metrics.accuracy > 0.6 ? '✅' : metrics.accuracy < 0.4 ? '❌' : '➖';
        lines.push(`${emoji} ${category}: ${(metrics.accuracy * 100).toFixed(0)}% (Brier: ${metrics.brierScore.toFixed(3)}, n=${metrics.count})`);
      }
    }
    lines.push('');
  }

  if (report.recentPerformance.length > 0) {
    lines.push('**Recent Performance**');
    for (const perf of report.recentPerformance) {
      lines.push(`${perf.period}: ${(perf.accuracy * 100).toFixed(0)}% accuracy, ${perf.brierScore.toFixed(3)} Brier`);
    }
  }

  return lines.join('\n');
}

/**
 * Get predictions needing resolution
 */
export function getPendingPredictions(): CalibrationRecord[] {
  return predictions.filter(p => !p.resolvedAt);
}

/**
 * Get all predictions
 */
export function getAllPredictions(): CalibrationRecord[] {
  return [...predictions];
}

// =============================================================================
// UTILITY
// =============================================================================

function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((result, item) => {
    const key = keyFn(item);
    (result[key] = result[key] || []).push(item);
    return result;
  }, {} as Record<string, T[]>);
}

// Initialize on module load
initializeCalibrationTracker();
