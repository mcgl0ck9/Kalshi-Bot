/**
 * Edge Scorer
 *
 * Scores edge opportunities using the trained ML model.
 * Integrates with the pipeline to:
 * - Predict probability of profitable trade
 * - Adjust confidence based on model output
 * - Rank opportunities by expected value
 */

import { logger } from '../utils/index.js';
import {
  extractFeatures,
  normalizeFeatures,
} from './features.js';
import {
  type EdgeModel,
  loadModel,
  predict,
} from './model.js';
import type { EdgeOpportunity } from '../types/index.js';

// =============================================================================
// SCORING
// =============================================================================

export interface ScoredOpportunity extends EdgeOpportunity {
  mlScore: number;           // 0-1 probability of profitable trade
  adjustedConfidence: number; // Confidence adjusted by ML model
  expectedValue: number;      // edge * adjustedConfidence
  rankScore: number;          // Combined ranking score
}

let cachedModel: EdgeModel | null = null;

/**
 * Load or get cached model
 */
function getModel(): EdgeModel | null {
  if (!cachedModel) {
    cachedModel = loadModel();
    if (!cachedModel) {
      logger.debug('No ML model available, using raw confidence');
    }
  }
  return cachedModel;
}

/**
 * Clear cached model (call after training)
 */
export function clearModelCache(): void {
  cachedModel = null;
}

/**
 * Score a single opportunity using the ML model
 */
export function scoreOpportunity(opportunity: EdgeOpportunity): ScoredOpportunity {
  const model = getModel();

  let mlScore = 0.5;  // Default to neutral if no model
  let adjustedConfidence = opportunity.confidence;

  if (model && model.trainingSamples >= 20) {
    try {
      const features = extractFeatures(opportunity);
      const normalizedFeatures = normalizeFeatures(features, model.stats);
      mlScore = predict(normalizedFeatures, model.weights);

      // Blend ML score with original confidence
      // Higher weight to ML as it gets more training data
      const mlWeight = Math.min(0.6, model.trainingSamples / 200);
      const origWeight = 1 - mlWeight;
      adjustedConfidence = origWeight * opportunity.confidence + mlWeight * mlScore;
    } catch (error) {
      logger.debug(`ML scoring failed: ${error}`);
    }
  }

  const expectedValue = opportunity.edge * adjustedConfidence;

  // Rank score combines multiple factors
  const urgencyMultiplier = opportunity.urgency === 'critical' ? 1.5 : opportunity.urgency === 'standard' ? 1.0 : 0.5;
  const rankScore = expectedValue * urgencyMultiplier * (0.5 + mlScore * 0.5);

  return {
    ...opportunity,
    mlScore,
    adjustedConfidence,
    expectedValue,
    rankScore,
  };
}

/**
 * Score and rank multiple opportunities
 */
export function scoreAndRankOpportunities(
  opportunities: EdgeOpportunity[]
): ScoredOpportunity[] {
  const scored = opportunities.map(scoreOpportunity);

  // Sort by rank score descending
  scored.sort((a, b) => b.rankScore - a.rankScore);

  return scored;
}

/**
 * Filter opportunities by ML confidence threshold
 */
export function filterByMLConfidence(
  opportunities: ScoredOpportunity[],
  minMLScore: number = 0.55
): ScoredOpportunity[] {
  return opportunities.filter(o => o.mlScore >= minMLScore);
}

// =============================================================================
// INTEGRATION HELPERS
// =============================================================================

/**
 * Get model status for reporting
 */
export function getModelStatus(): {
  available: boolean;
  version: string;
  trainingSamples: number;
  lastUpdated: string;
  accuracy: number;
} {
  const model = getModel();

  if (!model) {
    return {
      available: false,
      version: 'N/A',
      trainingSamples: 0,
      lastUpdated: 'Never',
      accuracy: 0,
    };
  }

  return {
    available: true,
    version: model.version,
    trainingSamples: model.trainingSamples,
    lastUpdated: model.lastUpdated,
    accuracy: model.metrics.accuracy,
  };
}

/**
 * Format scored opportunity for display
 */
export function formatScoredOpportunity(scored: ScoredOpportunity): string {
  const lines = [
    `**${scored.market.title}**`,
    '',
    `Direction: ${scored.direction}`,
    `Edge: ${(scored.edge * 100).toFixed(1)}%`,
    `Original Confidence: ${(scored.confidence * 100).toFixed(0)}%`,
    `ML Score: ${(scored.mlScore * 100).toFixed(0)}%`,
    `Adjusted Confidence: ${(scored.adjustedConfidence * 100).toFixed(0)}%`,
    `Expected Value: ${(scored.expectedValue * 100).toFixed(2)}%`,
    `Rank Score: ${scored.rankScore.toFixed(3)}`,
  ];

  return lines.join('\n');
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Score and filter opportunities for the pipeline
 */
export function enhanceOpportunities(
  opportunities: EdgeOpportunity[],
  topN: number = 10
): ScoredOpportunity[] {
  const model = getModel();

  if (!model || model.trainingSamples < 20) {
    // No model available, return opportunities with default scores
    return opportunities.slice(0, topN).map(opp => ({
      ...opp,
      mlScore: 0.5,
      adjustedConfidence: opp.confidence,
      expectedValue: opp.edge * opp.confidence,
      rankScore: opp.edge * opp.confidence,
    }));
  }

  // Score all opportunities
  const scored = scoreAndRankOpportunities(opportunities);

  // Log ML model impact
  const avgOrigConf = opportunities.reduce((sum, o) => sum + o.confidence, 0) / opportunities.length;
  const avgAdjConf = scored.reduce((sum, o) => sum + o.adjustedConfidence, 0) / scored.length;
  const avgMLScore = scored.reduce((sum, o) => sum + o.mlScore, 0) / scored.length;

  logger.info(`ML scoring: avg ML=${(avgMLScore * 100).toFixed(0)}%, orig conf=${(avgOrigConf * 100).toFixed(0)}%, adj conf=${(avgAdjConf * 100).toFixed(0)}%`);

  return scored.slice(0, topN);
}

/**
 * Adjust position sizing based on ML confidence
 */
export function adjustPositionForML(
  scored: ScoredOpportunity,
  baseKelly: number
): number {
  // Reduce position if ML is skeptical
  if (scored.mlScore < 0.45) {
    return baseKelly * 0.5;  // Cut position in half
  }

  // Increase position if ML is confident
  if (scored.mlScore > 0.65) {
    return Math.min(baseKelly * 1.25, 0.25);  // Cap at 25% of bankroll
  }

  return baseKelly;
}
