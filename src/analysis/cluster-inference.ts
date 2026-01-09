/**
 * Cross-Company Topic Inference
 *
 * When analysts grill one company about a topic, infer that other companies
 * in the same cluster will likely face similar questions.
 *
 * Example: If Kroger gets asked about "delivery" 5 times in Q4 earnings,
 * boost P(delivery mention) for Albertsons, Walmart, Costco upcoming earnings.
 */

import type { EarningsTranscript } from '../sources/earnings-transcripts.js';
import { extractHotTopics } from '../sources/earnings-transcripts.js';
import {
  COMPANY_CLUSTERS,
  getCompanyClusters,
  isTopicRelevantToCluster,
  normalizeClusterTopic,
  calculateInferenceConfidence,
  type CompanyCluster,
  type ClusterHotTopic,
} from '../data/company-clusters.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface CrossCompanyInference {
  /** Target company ticker */
  targetTicker: string;

  /** Target company name */
  targetCompany: string;

  /** Topic being inferred */
  topic: string;

  /** Normalized topic for matching */
  normalizedTopic: string;

  /** Source company that was asked about this topic */
  sourceTicker: string;

  /** How many times analysts asked about this topic */
  analystMentions: number;

  /** Intensity (mentions / total questions) */
  intensity: number;

  /** Days since source company's earnings */
  daysSinceSource: number;

  /** Cluster this inference is based on */
  cluster: string;

  /** Confidence in the inference (0-1) */
  confidence: number;

  /** Probability boost to apply */
  probabilityBoost: number;

  /** Reasoning for the inference */
  reasoning: string;
}

export interface InferenceConfig {
  /** Minimum analyst mentions to trigger inference */
  minMentions: number;

  /** Minimum intensity to trigger inference */
  minIntensity: number;

  /** Maximum days since source earnings for inference */
  maxDaysSinceSource: number;

  /** Maximum probability boost from any single inference */
  maxProbabilityBoost: number;

  /** Maximum total probability boost from all inferences */
  maxTotalBoost: number;
}

export const DEFAULT_INFERENCE_CONFIG: InferenceConfig = {
  minMentions: 2,
  minIntensity: 0.05,  // 5% of analyst questions
  maxDaysSinceSource: 90,  // 3 months (one earnings cycle)
  maxProbabilityBoost: 0.15,  // +15% max from single inference
  maxTotalBoost: 0.25,  // +25% max from all inferences
};

// =============================================================================
// HOT TOPIC TRACKING
// =============================================================================

// Cache of hot topics by cluster
const clusterHotTopics = new Map<string, ClusterHotTopic[]>();

/**
 * Process an earnings transcript and extract hot topics for cluster inference.
 *
 * Call this after each company reports earnings to update the cluster
 * hot topics that can inform other companies' mention probabilities.
 */
export function processTranscriptForClustering(
  transcript: EarningsTranscript
): ClusterHotTopic[] {
  const ticker = transcript.ticker;
  const clusters = getCompanyClusters(ticker);

  if (clusters.length === 0) {
    logger.debug(`No cluster found for ${ticker} - skipping inference`);
    return [];
  }

  const hotTopics = extractHotTopics(transcript, 2);
  const clusterTopics: ClusterHotTopic[] = [];

  for (const cluster of clusters) {
    for (const hot of hotTopics) {
      // Check if this topic is relevant to the cluster
      if (!isTopicRelevantToCluster(hot.topic, cluster)) {
        continue;
      }

      const normalized = normalizeClusterTopic(hot.topic, cluster);
      const daysSinceSource = (Date.now() - new Date(transcript.date).getTime()) / (1000 * 60 * 60 * 24);

      const clusterTopic: ClusterHotTopic = {
        topic: hot.topic,
        sourceTicker: ticker,
        sourceQuarter: transcript.quarter,
        sourceDate: transcript.date,
        analystMentions: hot.mentions,
        intensity: hot.intensity,
        pendingTickers: cluster.tickers.filter(t => t !== ticker),
        daysSinceSource: Math.round(daysSinceSource),
        inferenceConfidence: calculateInferenceConfidence(daysSinceSource, cluster, hot.intensity),
      };

      clusterTopics.push(clusterTopic);

      // Update cache
      const existing = clusterHotTopics.get(cluster.id) || [];
      existing.push(clusterTopic);
      clusterHotTopics.set(cluster.id, existing);
    }
  }

  logger.debug(`Processed ${clusterTopics.length} cluster hot topics from ${ticker}`);
  return clusterTopics;
}

/**
 * Get cross-company inferences for a target company.
 *
 * Returns topics that were hot for cluster peers and may be asked
 * of the target company in their upcoming earnings.
 */
export function getInferencesForCompany(
  targetTicker: string,
  config: InferenceConfig = DEFAULT_INFERENCE_CONFIG
): CrossCompanyInference[] {
  const inferences: CrossCompanyInference[] = [];
  const clusters = getCompanyClusters(targetTicker);

  if (clusters.length === 0) {
    return inferences;
  }

  for (const cluster of clusters) {
    const hotTopics = clusterHotTopics.get(cluster.id) || [];

    for (const hot of hotTopics) {
      // Skip if this is the same company
      if (hot.sourceTicker === targetTicker) continue;

      // Skip if too old
      if (hot.daysSinceSource > config.maxDaysSinceSource) continue;

      // Skip if not intense enough
      if (hot.analystMentions < config.minMentions) continue;
      if (hot.intensity < config.minIntensity) continue;

      // Skip if target is not in pending list
      if (!hot.pendingTickers.includes(targetTicker)) continue;

      // Calculate probability boost
      const probabilityBoost = Math.min(
        config.maxProbabilityBoost,
        hot.inferenceConfidence * hot.intensity * 0.5
      );

      const inference: CrossCompanyInference = {
        targetTicker,
        targetCompany: targetTicker,  // Would need company name lookup
        topic: hot.topic,
        normalizedTopic: normalizeClusterTopic(hot.topic, cluster),
        sourceTicker: hot.sourceTicker,
        analystMentions: hot.analystMentions,
        intensity: hot.intensity,
        daysSinceSource: hot.daysSinceSource,
        cluster: cluster.id,
        confidence: hot.inferenceConfidence,
        probabilityBoost,
        reasoning: buildInferenceReasoning(hot, cluster, targetTicker),
      };

      inferences.push(inference);
    }
  }

  // Sort by confidence (highest first)
  return inferences.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get combined probability boost for a keyword from cluster inferences.
 */
export function getInferredProbabilityBoost(
  targetTicker: string,
  keyword: string,
  config: InferenceConfig = DEFAULT_INFERENCE_CONFIG
): { boost: number; inferences: CrossCompanyInference[] } {
  const inferences = getInferencesForCompany(targetTicker, config);
  const keywordLower = keyword.toLowerCase();

  // Filter to inferences that match this keyword
  const matchingInferences = inferences.filter(inf =>
    inf.topic.toLowerCase().includes(keywordLower) ||
    inf.normalizedTopic.toLowerCase().includes(keywordLower) ||
    keywordLower.includes(inf.topic.toLowerCase())
  );

  if (matchingInferences.length === 0) {
    return { boost: 0, inferences: [] };
  }

  // Combine boosts (diminishing returns)
  let totalBoost = 0;
  for (const inf of matchingInferences) {
    // Each additional inference adds less (diminishing returns)
    const marginalBoost = inf.probabilityBoost * Math.pow(0.7, totalBoost / config.maxProbabilityBoost);
    totalBoost += marginalBoost;
  }

  totalBoost = Math.min(config.maxTotalBoost, totalBoost);

  return { boost: totalBoost, inferences: matchingInferences };
}

/**
 * Build inference reasoning explanation.
 */
function buildInferenceReasoning(
  hot: ClusterHotTopic,
  cluster: CompanyCluster,
  targetTicker: string
): string {
  return `Analysts asked ${hot.sourceTicker} about "${hot.topic}" ${hot.analystMentions}x ` +
    `(${(hot.intensity * 100).toFixed(0)}% of Q&A) ${hot.daysSinceSource}d ago. ` +
    `${cluster.name} peers like ${targetTicker} may face similar questions.`;
}

// =============================================================================
// INITIALIZATION FROM TRANSCRIPTS
// =============================================================================

/**
 * Initialize cluster hot topics from a batch of transcripts.
 *
 * Call this at startup with recent transcripts to populate the cache.
 */
export function initializeClusterTopics(
  transcripts: EarningsTranscript[],
  maxAgeDays: number = 90
): void {
  // Clear existing cache
  clusterHotTopics.clear();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  // Filter to recent transcripts
  const recentTranscripts = transcripts.filter(t =>
    new Date(t.date) >= cutoff
  );

  // Process each transcript
  for (const transcript of recentTranscripts) {
    processTranscriptForClustering(transcript);
  }

  // Log summary
  let totalTopics = 0;
  for (const topics of clusterHotTopics.values()) {
    totalTopics += topics.length;
  }

  logger.info(`Initialized ${totalTopics} cluster hot topics from ${recentTranscripts.length} transcripts`);
}

/**
 * Get a summary of current cluster hot topics for debugging.
 */
export function getClusterTopicsSummary(): Record<string, { topics: string[]; companies: string[] }> {
  const summary: Record<string, { topics: string[]; companies: string[] }> = {};

  for (const [clusterId, hotTopics] of clusterHotTopics.entries()) {
    const cluster = COMPANY_CLUSTERS.find(c => c.id === clusterId);
    if (!cluster) continue;

    const topics = [...new Set(hotTopics.map(h => h.topic))];
    const companies = [...new Set(hotTopics.map(h => h.sourceTicker))];

    summary[cluster.name] = { topics, companies };
  }

  return summary;
}

// =============================================================================
// INTEGRATION WITH MENTIONS DETECTOR
// =============================================================================

/**
 * Enhance keyword probability with cluster inference.
 *
 * Call this in the mentions detector to adjust base probability
 * based on cross-company signals.
 */
export function enhanceKeywordProbability(
  targetTicker: string,
  keyword: string,
  baseProbability: number,
  config: InferenceConfig = DEFAULT_INFERENCE_CONFIG
): {
  enhancedProbability: number;
  boost: number;
  reasoning?: string;
  inferences: CrossCompanyInference[];
} {
  const { boost, inferences } = getInferredProbabilityBoost(targetTicker, keyword, config);

  if (boost === 0) {
    return {
      enhancedProbability: baseProbability,
      boost: 0,
      inferences: [],
    };
  }

  // Apply boost (additive, capped at 95%)
  const enhancedProbability = Math.min(0.95, baseProbability + boost);

  // Build combined reasoning
  let reasoning: string | undefined;
  if (inferences.length > 0) {
    const topInference = inferences[0];
    reasoning = `Cross-company signal: ${topInference.sourceTicker} grilled on "${topInference.topic}" ` +
      `(${topInference.analystMentions}x, ${topInference.daysSinceSource}d ago). ` +
      `Boosting probability by ${(boost * 100).toFixed(1)}%.`;
  }

  return {
    enhancedProbability,
    boost,
    reasoning,
    inferences,
  };
}
