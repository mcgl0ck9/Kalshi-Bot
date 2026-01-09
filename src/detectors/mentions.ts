/**
 * Mentions Edge Detector v4.0
 *
 * Detects edges in "mentions" markets by combining multiple signals:
 * 1. Executive media appearances - upcoming interviews/podcasts signal likely mentions
 * 2. Earnings transcript patterns - historical keyword frequency predicts future mentions
 * 3. Historical mention frequency - base rates vs market prices
 *
 * VALIDATED SIGNALS:
 * - Executives discussing topics in recent media often repeat in earnings calls
 * - Historical mention rates are strong predictors (companies have patterns)
 * - Analyst interest in topics correlates with executive mention likelihood
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Traders without access to transcript history
 * - Why do they lose? They don't analyze historical keyword patterns
 * - Our edge: Information processing advantage from transcript analysis
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import type {
  MentionsMarketsData,
  MentionsMarket,
  KeywordOption,
} from '../sources/kalshi-mentions.js';
import type {
  TranscriptsData,
  EarningsTranscript,
} from '../sources/earnings-transcripts.js';
import {
  calculateMentionRate,
  analyzeKeywordTrend,
  getAnalystInterest,
  // Smart decay (time-weighted) functions
  calculateTimeWeightedMentionRate,
  getTimeWeightedAnalystInterest,
  checkKeywordStaleness,
  extractHotTopics,
} from '../sources/earnings-transcripts.js';
import type {
  ExecutiveMediaData,
  MediaAppearance,
} from '../sources/executive-media.js';
import {
  getCompanyAppearances,
  analyzeKeywordFrequency,
  getRecentExecutiveAppearances,
  // Pre-earnings signal functions
  detectPreEarningsSignals,
  isKeywordWarmedUp,
} from '../sources/executive-media.js';
// Corporate events (news-aware)
import type { CorporateEventsData } from '../sources/corporate-events.js';
import {
  shouldSkipEarningsMarkets,
  isKeywordStale as isCorporateKeywordStale,
  getStaleKeywords,
} from '../sources/corporate-events.js';
// Cluster inference (cross-company)
import {
  enhanceKeywordProbability,
  initializeClusterTopics,
} from '../analysis/cluster-inference.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.03;           // 3% minimum edge
const MIN_CONFIDENCE = 0.50;     // 50% minimum confidence
const MEDIA_EDGE_MIN = 0.04;     // 4% minimum for media-based edges
const FREQUENCY_EDGE_MIN = 0.05; // 5% minimum for frequency-based edges

// Historical mention rate priors (Bayesian baseline)
const DEFAULT_MENTION_PRIOR = 0.35;  // Assume 35% if no history
const PRIOR_STRENGTH = 2;            // Weight of prior (equivalent to 2 observations)

// =============================================================================
// TYPES
// =============================================================================

/**
 * MentionsSignal interface with [key: string]: unknown for EdgeSignal compatibility
 */
export interface MentionsSignal {
  type: string;
  subtype: 'mentions-media' | 'mentions-earnings' | 'mentions-frequency';
  company: string;
  companyTicker: string;
  keyword: string;
  [key: string]: unknown;
}

interface MediaEdgeSignal extends MentionsSignal {
  subtype: 'mentions-media';
  recentAppearances: number;
  keywordMentionsInMedia: number;
  daysToEvent: number;
  mediaKeywordRate: number;
  impliedProb: number;
  marketPrice: number;
}

interface EarningsEdgeSignal extends MentionsSignal {
  subtype: 'mentions-earnings';
  historicalRate: number;
  transcriptsAnalyzed: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  analystInterest: number;
  impliedProb: number;
  marketPrice: number;
}

interface FrequencyEdgeSignal extends MentionsSignal {
  subtype: 'mentions-frequency';
  baseRate: number;
  bayesianProb: number;
  sampleSize: number;
  confidence: number;
  impliedProb: number;
  marketPrice: number;
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'mentions',
  description: 'Detects edges in company/executive mentions markets using media, transcripts, frequency analysis, corporate events, and cluster inference',
  sources: ['kalshi-mentions', 'earnings-transcripts', 'executive-media', 'corporate-events'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Get source data with proper typing
    const mentionsData = data['kalshi-mentions'] as MentionsMarketsData | undefined;
    const transcriptsData = data['earnings-transcripts'] as TranscriptsData | undefined;
    const mediaData = data['executive-media'] as ExecutiveMediaData | undefined;
    const corporateEventsData = data['corporate-events'] as CorporateEventsData | undefined;

    if (!mentionsData || mentionsData.markets.length === 0) {
      logger.debug('Mentions detector: No mentions markets data available');
      return edges;
    }

    // Initialize cluster topics from recent transcripts for cross-company inference
    if (transcriptsData?.transcripts && transcriptsData.transcripts.length > 0) {
      initializeClusterTopics(transcriptsData.transcripts, 90);
    }

    logger.info(`Mentions detector: Analyzing ${mentionsData.markets.length} mentions markets`);

    // Process each mentions market
    for (const mentionsMarket of mentionsData.markets) {
      const companyTicker = mentionsMarket.companyTicker;

      // NEWS-AWARE: Check if corporate events invalidate this company's earnings markets
      if (corporateEventsData) {
        const skipCheck = shouldSkipEarningsMarkets(corporateEventsData, companyTicker);
        if (skipCheck.skip) {
          logger.info(`Mentions detector: Skipping ${companyTicker} - ${skipCheck.reason}`);
          continue;
        }
      }

      // Get stale keywords from corporate events (e.g., "kroger" for ACI after merger failed)
      const corporateStaleKeywords = corporateEventsData
        ? getStaleKeywords(corporateEventsData, companyTicker)
        : [];

      // Get company transcripts if available
      const companyTranscripts = transcriptsData?.byTicker[companyTicker] ?? [];

      // Get company media appearances if available
      const companyMedia = mediaData ? getCompanyAppearances(mediaData, companyTicker) : [];

      // Analyze each keyword in this market
      for (const keyword of mentionsMarket.keywords) {
        // NEWS-AWARE: Skip keywords invalidated by corporate events
        if (corporateStaleKeywords.some(s => keyword.keyword.toLowerCase().includes(s))) {
          logger.debug(`Skipping stale keyword "${keyword.keyword}" for ${companyTicker}`);
          continue;
        }

        // NEWS-AWARE: Check corporate events staleness
        if (corporateEventsData) {
          const staleCheck = isCorporateKeywordStale(corporateEventsData, companyTicker, keyword.keyword);
          if (staleCheck.stale) {
            logger.debug(`Skipping "${keyword.keyword}" for ${companyTicker}: ${staleCheck.reason}`);
            continue;
          }
        }

        // SMART DECAY: Check transcript-based staleness (time-weighted)
        if (companyTranscripts.length > 0) {
          const transcriptStale = checkKeywordStaleness(companyTranscripts, keyword.keyword);
          if (transcriptStale.isStale) {
            logger.debug(`Keyword "${keyword.keyword}" is stale for ${companyTicker}: ${transcriptStale.reason}`);
            // Don't skip entirely, but reduce confidence
          }
        }

        // 1. Media-based edge (executive has upcoming appearance)
        if (mediaData && companyMedia.length > 0) {
          const mediaEdge = analyzeMediaEdge(
            mentionsMarket,
            keyword,
            companyMedia,
            mediaData
          );
          if (mediaEdge) {
            edges.push(mediaEdge);
          }
        }

        // 2. Earnings transcript pattern edge (now with SMART DECAY)
        if (companyTranscripts.length >= 2) {
          const earningsEdge = analyzeEarningsPatternEdgeEnhanced(
            mentionsMarket,
            keyword,
            companyTranscripts,
            mediaData,  // For pre-earnings signals
            corporateEventsData
          );
          if (earningsEdge) {
            edges.push(earningsEdge);
          }
        }

        // 3. Historical frequency edge with CLUSTER INFERENCE
        const frequencyEdge = analyzeFrequencyEdgeEnhanced(
          mentionsMarket,
          keyword,
          companyTranscripts,
          companyMedia,
          corporateEventsData
        );
        if (frequencyEdge) {
          edges.push(frequencyEdge);
        }
      }
    }

    // Deduplicate: keep best edge per keyword per company
    const dedupedEdges = deduplicateEdges(edges);

    if (dedupedEdges.length > 0) {
      logger.info(`Mentions detector: Found ${dedupedEdges.length} edges (deduplicated from ${edges.length})`);
    }

    return dedupedEdges;
  },
});

// =============================================================================
// MEDIA EDGE ANALYSIS
// =============================================================================

/**
 * Detect edge when executive has recent/upcoming media appearance
 * and market doesn't reflect increased likelihood of mention.
 */
function analyzeMediaEdge(
  market: MentionsMarket,
  keyword: KeywordOption,
  companyMedia: MediaAppearance[],
  allMediaData: ExecutiveMediaData
): Edge | null {
  // Get recent appearances (last 14 days)
  const recentAppearances = getRecentExecutiveAppearances(
    allMediaData,
    market.companyTicker,
    14
  );

  if (recentAppearances.length === 0) {
    return null;
  }

  // Check if keyword was mentioned in recent media
  const { count: keywordMentions, rate: mediaKeywordRate } = analyzeKeywordFrequency(
    recentAppearances,
    keyword.keyword
  );

  // Calculate days to event
  const daysToEvent = market.eventDate
    ? Math.max(0, Math.ceil((new Date(market.eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 30;

  // If executive discussed this keyword in recent media, higher chance of mention
  // Media recency boost: more recent = stronger signal
  let impliedProb = DEFAULT_MENTION_PRIOR;

  if (keywordMentions > 0) {
    // Keyword appeared in recent media - significant boost
    impliedProb = 0.45 + (mediaKeywordRate * 0.35);  // 45-80% range

    // Boost for very recent appearances (within 7 days)
    const veryRecent = recentAppearances.filter(a => {
      const daysSince = (Date.now() - new Date(a.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7;
    });
    if (veryRecent.length > 0) {
      impliedProb = Math.min(0.85, impliedProb + 0.10);
    }
  } else if (recentAppearances.length >= 2) {
    // Executive active in media but didn't mention keyword - slight negative signal
    impliedProb = Math.max(0.20, DEFAULT_MENTION_PRIOR - 0.05);
  }

  // Time decay adjustment: closer to event = less time for things to change
  if (daysToEvent <= 3) {
    // Very close to event - high theta, stick with current estimate
    impliedProb = impliedProb;  // No change
  } else if (daysToEvent <= 7) {
    // Close to event - small uncertainty
    impliedProb = impliedProb * 0.95 + DEFAULT_MENTION_PRIOR * 0.05;
  }

  // Normalize probability
  impliedProb = Math.max(0.10, Math.min(0.90, impliedProb));

  const marketPrice = keyword.yesPrice;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MEDIA_EDGE_MIN) {
    return null;
  }

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';
  const confidence = Math.min(0.85, 0.50 + (recentAppearances.length * 0.05) + (keywordMentions * 0.10));

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build market object for createEdge
  const edgeMarket: Market = {
    platform: 'kalshi',
    id: keyword.ticker,
    ticker: keyword.ticker,
    title: `Will ${market.company} mention "${keyword.keyword}"?`,
    category: 'other',
    price: marketPrice,
    volume: keyword.volume,
    url: keyword.url,
    closeTime: market.closeTime,
  };

  const reason = buildMediaEdgeReason(
    market.company,
    keyword.keyword,
    recentAppearances.length,
    keywordMentions,
    impliedProb,
    marketPrice,
    direction,
    daysToEvent
  );

  const signal: MediaEdgeSignal = {
    type: 'mentions',
    subtype: 'mentions-media',
    company: market.company,
    companyTicker: market.companyTicker,
    keyword: keyword.keyword,
    recentAppearances: recentAppearances.length,
    keywordMentionsInMedia: keywordMentions,
    daysToEvent,
    mediaKeywordRate,
    impliedProb,
    marketPrice,
  };

  return createEdge(edgeMarket, direction, edge, confidence, reason, signal);
}

function buildMediaEdgeReason(
  company: string,
  keyword: string,
  appearances: number,
  keywordMentions: number,
  impliedProb: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  daysToEvent: number
): string {
  const impliedPct = (impliedProb * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);

  if (keywordMentions > 0) {
    return `${company} executives discussed "${keyword}" in ${keywordMentions} of ${appearances} recent media appearances. ` +
      `Implied prob: ${impliedPct}% vs market: ${marketPct}%. ` +
      `${daysToEvent} days to event. ${direction} edge.`;
  }

  return `${company} has ${appearances} recent media appearances but "${keyword}" not mentioned. ` +
    `Implied prob: ${impliedPct}% vs market: ${marketPct}%. ` +
    `${daysToEvent} days to event. ${direction} edge.`;
}

// =============================================================================
// EARNINGS PATTERN EDGE ANALYSIS
// =============================================================================

/**
 * Detect edge based on historical earnings call mention patterns.
 */
function analyzeEarningsPatternEdge(
  market: MentionsMarket,
  keyword: KeywordOption,
  transcripts: EarningsTranscript[]
): Edge | null {
  if (transcripts.length < 2) {
    return null;
  }

  // Calculate historical mention rate
  const mentionStats = calculateMentionRate(transcripts, keyword.keyword);

  if (mentionStats.total === 0) {
    return null;
  }

  // Analyze trend (increasing/stable/decreasing)
  const trend = analyzeKeywordTrend(transcripts, keyword.keyword);

  // Get analyst interest (how often analysts ask about this topic)
  const analystInterest = getAnalystInterest(transcripts, keyword.keyword);

  // Calculate implied probability with adjustments
  let impliedProb = mentionStats.rate;

  // Trend adjustment
  if (trend === 'increasing') {
    impliedProb = Math.min(0.95, impliedProb * 1.15);  // +15% for upward trend
  } else if (trend === 'decreasing') {
    impliedProb = Math.max(0.05, impliedProb * 0.85);  // -15% for downward trend
  }

  // Analyst interest boost (if analysts care, execs often address it)
  if (analystInterest > 0.10) {  // >10% of analyst questions mention this
    impliedProb = Math.min(0.95, impliedProb + (analystInterest * 0.20));
  }

  // Normalize probability
  impliedProb = Math.max(0.05, Math.min(0.95, impliedProb));

  const marketPrice = keyword.yesPrice;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MIN_EDGE) {
    return null;
  }

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';

  // Confidence scales with sample size
  const sampleConfidence = Math.min(0.40, mentionStats.total * 0.05);  // Max +40% from sample size
  const confidence = Math.min(0.90, 0.40 + sampleConfidence + (analystInterest * 0.15));

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build market object
  const edgeMarket: Market = {
    platform: 'kalshi',
    id: keyword.ticker,
    ticker: keyword.ticker,
    title: `Will ${market.company} mention "${keyword.keyword}"?`,
    category: 'other',
    price: marketPrice,
    volume: keyword.volume,
    url: keyword.url,
    closeTime: market.closeTime,
  };

  const reason = buildEarningsEdgeReason(
    market.company,
    keyword.keyword,
    mentionStats.rate,
    mentionStats.total,
    trend,
    analystInterest,
    impliedProb,
    marketPrice,
    direction
  );

  const signal: EarningsEdgeSignal = {
    type: 'mentions',
    subtype: 'mentions-earnings',
    company: market.company,
    companyTicker: market.companyTicker,
    keyword: keyword.keyword,
    historicalRate: mentionStats.rate,
    transcriptsAnalyzed: mentionStats.total,
    trend,
    analystInterest,
    impliedProb,
    marketPrice,
  };

  return createEdge(edgeMarket, direction, edge, confidence, reason, signal);
}

function buildEarningsEdgeReason(
  company: string,
  keyword: string,
  historicalRate: number,
  transcripts: number,
  trend: 'increasing' | 'stable' | 'decreasing',
  analystInterest: number,
  impliedProb: number,
  marketPrice: number,
  direction: 'YES' | 'NO'
): string {
  const ratePct = (historicalRate * 100).toFixed(0);
  const impliedPct = (impliedProb * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);
  const interestPct = (analystInterest * 100).toFixed(0);

  let trendText = '';
  if (trend === 'increasing') {
    trendText = ' (trend: increasing)';
  } else if (trend === 'decreasing') {
    trendText = ' (trend: decreasing)';
  }

  return `${company} mentioned "${keyword}" in ${ratePct}% of last ${transcripts} earnings calls${trendText}. ` +
    `Analyst interest: ${interestPct}%. ` +
    `Adjusted implied prob: ${impliedPct}% vs market: ${marketPct}%. ${direction} edge.`;
}

// =============================================================================
// FREQUENCY EDGE ANALYSIS (BAYESIAN)
// =============================================================================

/**
 * Bayesian frequency-based edge detection.
 * Combines historical data with prior beliefs for robust estimates.
 */
function analyzeFrequencyEdge(
  market: MentionsMarket,
  keyword: KeywordOption,
  transcripts: EarningsTranscript[],
  mediaAppearances: MediaAppearance[]
): Edge | null {
  // Calculate base rate from available data
  let successCount = 0;
  let totalObservations = 0;

  // Count mentions in transcripts
  if (transcripts.length > 0) {
    const mentionStats = calculateMentionRate(transcripts, keyword.keyword);
    successCount += mentionStats.count;
    totalObservations += mentionStats.total;
  }

  // Count mentions in media appearances
  if (mediaAppearances.length > 0) {
    for (const appearance of mediaAppearances) {
      if (appearance.mentionedKeywords.some(k =>
        k.toLowerCase().includes(keyword.keyword.toLowerCase())
      )) {
        successCount++;
      }
      totalObservations++;
    }
  }

  // Apply Bayesian update with Beta prior
  // Prior: Beta(alpha, beta) where alpha = prior_success, beta = prior_failure
  const priorAlpha = DEFAULT_MENTION_PRIOR * PRIOR_STRENGTH;
  const priorBeta = (1 - DEFAULT_MENTION_PRIOR) * PRIOR_STRENGTH;

  // Posterior mean = (alpha + successes) / (alpha + beta + total)
  const posteriorAlpha = priorAlpha + successCount;
  const posteriorBeta = priorBeta + (totalObservations - successCount);
  const bayesianProb = posteriorAlpha / (posteriorAlpha + posteriorBeta);

  // If no data, use prior only
  if (totalObservations === 0) {
    // Check if market is significantly mispriced vs prior
    const marketPrice = keyword.yesPrice;
    const edge = Math.abs(DEFAULT_MENTION_PRIOR - marketPrice);

    if (edge < FREQUENCY_EDGE_MIN) {
      return null;
    }

    // Low confidence with no data
    return null;
  }

  const marketPrice = keyword.yesPrice;
  const edge = Math.abs(bayesianProb - marketPrice);

  if (edge < FREQUENCY_EDGE_MIN) {
    return null;
  }

  const direction = bayesianProb > marketPrice ? 'YES' : 'NO';

  // Confidence based on sample size (more data = higher confidence)
  const sampleConfidence = Math.min(0.90, 0.45 + (totalObservations * 0.03));
  const confidence = sampleConfidence;

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build market object
  const edgeMarket: Market = {
    platform: 'kalshi',
    id: keyword.ticker,
    ticker: keyword.ticker,
    title: `Will ${market.company} mention "${keyword.keyword}"?`,
    category: 'other',
    price: marketPrice,
    volume: keyword.volume,
    url: keyword.url,
    closeTime: market.closeTime,
  };

  const baseRate = totalObservations > 0 ? successCount / totalObservations : DEFAULT_MENTION_PRIOR;

  const reason = buildFrequencyEdgeReason(
    market.company,
    keyword.keyword,
    baseRate,
    bayesianProb,
    totalObservations,
    marketPrice,
    direction
  );

  const signal: FrequencyEdgeSignal = {
    type: 'mentions',
    subtype: 'mentions-frequency',
    company: market.company,
    companyTicker: market.companyTicker,
    keyword: keyword.keyword,
    baseRate,
    bayesianProb,
    sampleSize: totalObservations,
    confidence,
    impliedProb: bayesianProb,
    marketPrice,
  };

  return createEdge(edgeMarket, direction, edge, confidence, reason, signal);
}

function buildFrequencyEdgeReason(
  company: string,
  keyword: string,
  baseRate: number,
  bayesianProb: number,
  sampleSize: number,
  marketPrice: number,
  direction: 'YES' | 'NO'
): string {
  const basePct = (baseRate * 100).toFixed(0);
  const bayesPct = (bayesianProb * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);

  return `${company} "${keyword}" base rate: ${basePct}% from ${sampleSize} observations. ` +
    `Bayesian adjusted: ${bayesPct}% vs market: ${marketPct}%. ${direction} edge.`;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Deduplicate edges - keep best edge per keyword per company.
 */
function deduplicateEdges(edges: Edge[]): Edge[] {
  const bestPerKey = new Map<string, Edge>();

  for (const edge of edges) {
    const signal = edge.signal as MentionsSignal;
    const key = `${signal.companyTicker}-${signal.keyword}`;
    const existing = bestPerKey.get(key);

    // Keep the edge with the highest confidence * edge combination
    if (!existing || (edge.edge * edge.confidence) > (existing.edge * existing.confidence)) {
      bestPerKey.set(key, edge);
    }
  }

  return Array.from(bestPerKey.values());
}

// =============================================================================
// ENHANCED ANALYSIS FUNCTIONS (Smart Decay + Pre-Earnings + Cluster Inference)
// =============================================================================

/**
 * Enhanced earnings pattern analysis with:
 * - Time-weighted mention rates (smart decay)
 * - Pre-earnings signal detection
 * - Staleness checking
 */
function analyzeEarningsPatternEdgeEnhanced(
  market: MentionsMarket,
  keyword: KeywordOption,
  transcripts: EarningsTranscript[],
  mediaData: ExecutiveMediaData | undefined,
  corporateEventsData: CorporateEventsData | undefined
): Edge | null {
  if (transcripts.length < 2) {
    return null;
  }

  // SMART DECAY: Use time-weighted mention rate instead of simple average
  const timeWeightedStats = calculateTimeWeightedMentionRate(transcripts, keyword.keyword);

  if (timeWeightedStats.totalWeight === 0) {
    return null;
  }

  // SMART DECAY: Use time-weighted analyst interest with trend
  const analystData = getTimeWeightedAnalystInterest(transcripts, keyword.keyword);

  // Check staleness
  const stalenessCheck = checkKeywordStaleness(transcripts, keyword.keyword);

  // Calculate implied probability with adjustments
  let impliedProb = timeWeightedStats.rate;

  // Trend adjustment (from time-weighted analysis)
  if (analystData.trend === 'increasing') {
    impliedProb = Math.min(0.95, impliedProb * 1.15);  // +15% for upward trend
  } else if (analystData.trend === 'decreasing') {
    impliedProb = Math.max(0.05, impliedProb * 0.85);  // -15% for downward trend
  }

  // Staleness penalty
  if (stalenessCheck.isStale) {
    impliedProb = Math.max(0.10, impliedProb * 0.70);  // -30% for stale keywords
  }

  // PRE-EARNINGS SIGNALS: Check if keyword is "warmed up" by recent media
  if (mediaData && market.eventDate) {
    const warmupCheck = isKeywordWarmedUp(mediaData, market.companyTicker, keyword.keyword, market.eventDate);
    if (warmupCheck.warmedUp) {
      impliedProb = Math.min(0.95, impliedProb + warmupCheck.confidenceBoost);
      logger.debug(`Pre-earnings warmup for "${keyword.keyword}": +${(warmupCheck.confidenceBoost * 100).toFixed(1)}%`);
    }
  }

  // CLUSTER INFERENCE: Check for cross-company signals
  const clusterEnhancement = enhanceKeywordProbability(
    market.companyTicker,
    keyword.keyword,
    impliedProb
  );

  if (clusterEnhancement.boost > 0) {
    impliedProb = clusterEnhancement.enhancedProbability;
    logger.debug(`Cluster inference for "${keyword.keyword}": +${(clusterEnhancement.boost * 100).toFixed(1)}%`);
  }

  // Analyst interest boost (if analysts care, execs often address it)
  if (analystData.score > 0.10) {
    impliedProb = Math.min(0.95, impliedProb + (analystData.score * 0.20));
  }

  // Normalize probability
  impliedProb = Math.max(0.05, Math.min(0.95, impliedProb));

  const marketPrice = keyword.yesPrice;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MIN_EDGE) {
    return null;
  }

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';

  // Confidence scales with effective sample size and signal quality
  let confidence = Math.min(0.90, 0.35 + (timeWeightedStats.effectiveN * 0.08));

  // Boost confidence for cluster signals
  if (clusterEnhancement.inferences.length > 0) {
    confidence = Math.min(0.95, confidence + 0.10);
  }

  // Reduce confidence for stale keywords
  if (stalenessCheck.isStale) {
    confidence *= 0.70;
  }

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build market object
  const edgeMarket: Market = {
    platform: 'kalshi',
    id: keyword.ticker,
    ticker: keyword.ticker,
    title: `Will ${market.company} mention "${keyword.keyword}"?`,
    category: 'other',
    price: marketPrice,
    volume: keyword.volume,
    url: keyword.url,
    closeTime: market.closeTime,
  };

  const reason = buildEnhancedEarningsReason(
    market.company,
    keyword.keyword,
    timeWeightedStats.rate,
    transcripts.length,
    analystData.trend,
    analystData.score,
    impliedProb,
    marketPrice,
    direction,
    clusterEnhancement.reasoning,
    stalenessCheck.isStale
  );

  const signal: EarningsEdgeSignal = {
    type: 'mentions',
    subtype: 'mentions-earnings',
    company: market.company,
    companyTicker: market.companyTicker,
    keyword: keyword.keyword,
    historicalRate: timeWeightedStats.rate,
    transcriptsAnalyzed: transcripts.length,
    trend: analystData.trend,
    analystInterest: analystData.score,
    impliedProb,
    marketPrice,
    // Enhanced signal fields
    timeWeighted: true,
    effectiveN: timeWeightedStats.effectiveN,
    clusterBoost: clusterEnhancement.boost,
    isStale: stalenessCheck.isStale,
  };

  return createEdge(edgeMarket, direction, edge, confidence, reason, signal);
}

/**
 * Enhanced frequency analysis with cluster inference.
 */
function analyzeFrequencyEdgeEnhanced(
  market: MentionsMarket,
  keyword: KeywordOption,
  transcripts: EarningsTranscript[],
  mediaAppearances: MediaAppearance[],
  corporateEventsData: CorporateEventsData | undefined
): Edge | null {
  // Calculate base rate from available data
  let successCount = 0;
  let totalObservations = 0;

  // Use TIME-WEIGHTED counting from transcripts
  if (transcripts.length > 0) {
    const timeWeightedStats = calculateTimeWeightedMentionRate(transcripts, keyword.keyword);
    successCount = timeWeightedStats.weightedMentions;
    totalObservations = timeWeightedStats.totalWeight;
  }

  // Count mentions in media appearances
  if (mediaAppearances.length > 0) {
    for (const appearance of mediaAppearances) {
      if (appearance.mentionedKeywords.some(k =>
        k.toLowerCase().includes(keyword.keyword.toLowerCase())
      )) {
        successCount++;
      }
      totalObservations++;
    }
  }

  // Apply Bayesian update with Beta prior
  const priorAlpha = DEFAULT_MENTION_PRIOR * PRIOR_STRENGTH;
  const priorBeta = (1 - DEFAULT_MENTION_PRIOR) * PRIOR_STRENGTH;

  const posteriorAlpha = priorAlpha + successCount;
  const posteriorBeta = priorBeta + (totalObservations - successCount);
  let bayesianProb = posteriorAlpha / (posteriorAlpha + posteriorBeta);

  // If no data, use prior only
  if (totalObservations === 0) {
    const marketPrice = keyword.yesPrice;
    const edge = Math.abs(DEFAULT_MENTION_PRIOR - marketPrice);

    if (edge < FREQUENCY_EDGE_MIN) {
      return null;
    }
    return null;  // Low confidence with no data
  }

  // CLUSTER INFERENCE: Apply cross-company signals
  const clusterEnhancement = enhanceKeywordProbability(
    market.companyTicker,
    keyword.keyword,
    bayesianProb
  );

  if (clusterEnhancement.boost > 0) {
    bayesianProb = clusterEnhancement.enhancedProbability;
  }

  const marketPrice = keyword.yesPrice;
  const edge = Math.abs(bayesianProb - marketPrice);

  if (edge < FREQUENCY_EDGE_MIN) {
    return null;
  }

  const direction = bayesianProb > marketPrice ? 'YES' : 'NO';

  // Confidence based on sample size (more data = higher confidence)
  let sampleConfidence = Math.min(0.90, 0.45 + (totalObservations * 0.03));

  // Boost for cluster signals
  if (clusterEnhancement.inferences.length > 0) {
    sampleConfidence = Math.min(0.92, sampleConfidence + 0.08);
  }

  if (sampleConfidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build market object
  const edgeMarket: Market = {
    platform: 'kalshi',
    id: keyword.ticker,
    ticker: keyword.ticker,
    title: `Will ${market.company} mention "${keyword.keyword}"?`,
    category: 'other',
    price: marketPrice,
    volume: keyword.volume,
    url: keyword.url,
    closeTime: market.closeTime,
  };

  const baseRate = totalObservations > 0 ? successCount / totalObservations : DEFAULT_MENTION_PRIOR;

  let reason = buildFrequencyEdgeReason(
    market.company,
    keyword.keyword,
    baseRate,
    bayesianProb,
    Math.round(totalObservations),
    marketPrice,
    direction
  );

  // Add cluster reasoning if applicable
  if (clusterEnhancement.reasoning) {
    reason += ` ${clusterEnhancement.reasoning}`;
  }

  const signal: FrequencyEdgeSignal = {
    type: 'mentions',
    subtype: 'mentions-frequency',
    company: market.company,
    companyTicker: market.companyTicker,
    keyword: keyword.keyword,
    baseRate,
    bayesianProb,
    sampleSize: Math.round(totalObservations),
    confidence: sampleConfidence,
    impliedProb: bayesianProb,
    marketPrice,
    // Enhanced fields
    clusterBoost: clusterEnhancement.boost,
    clusterInferences: clusterEnhancement.inferences.length,
  };

  return createEdge(edgeMarket, direction, edge, sampleConfidence, reason, signal);
}

/**
 * Build enhanced reasoning for earnings edge.
 */
function buildEnhancedEarningsReason(
  company: string,
  keyword: string,
  historicalRate: number,
  transcripts: number,
  trend: 'increasing' | 'stable' | 'decreasing',
  analystInterest: number,
  impliedProb: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  clusterReasoning?: string,
  isStale?: boolean
): string {
  const ratePct = (historicalRate * 100).toFixed(0);
  const impliedPct = (impliedProb * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);
  const interestPct = (analystInterest * 100).toFixed(0);

  let reason = `${company} time-weighted rate: ${ratePct}% from ${transcripts} calls`;

  if (trend !== 'stable') {
    reason += ` (trend: ${trend})`;
  }

  reason += `. Analyst interest: ${interestPct}%.`;

  if (isStale) {
    reason += ' [STALE - reduced confidence]';
  }

  reason += ` Adjusted: ${impliedPct}% vs market: ${marketPct}%. ${direction}.`;

  if (clusterReasoning) {
    reason += ` ${clusterReasoning}`;
  }

  return reason;
}
