/**
 * Informed Capital Edge Detection
 *
 * Implementation of the "How Informed Capital Actually Operates" framework.
 *
 * Key principles:
 * 1. Edge lives in the window between information arrival and narrative formation
 * 2. Primary signals (filings, actions, procedures) lead secondary signals (headlines)
 * 3. Related markets almost never move in sync - the lag is the opportunity
 * 4. Resolution rules ≠ narrative expectations - tedious analysis works
 * 5. Attention kills edges - low-attention markets have longer-lived mispricings
 *
 * @see docs/POLYMARKET_EDGE_STRATEGIES.md
 */

import type { Market, Edge } from '../core/types.js';
import { createEdge } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Interpretation uncertainty occurs when information is public
 * but the market doesn't know what to DO with it.
 *
 * High uncertainty = potential edge window
 */
export interface InterpretationState {
  // Has new information arrived?
  hasNewInfo: boolean;

  // Is the narrative crystallized (consensus formed)?
  narrativeCrystallized: boolean;

  // Volume activity level
  volumeLevel: 'low' | 'normal' | 'high';

  // Price stability despite volume
  priceStable: boolean;

  // Uncertainty score (0-1): higher = more edge potential
  uncertaintyScore: number;
}

/**
 * Primary signals lead secondary signals.
 * We want to detect primary signals BEFORE narrative forms.
 */
export type SignalType = 'primary' | 'secondary';

export interface SignalClassification {
  type: SignalType;
  source: string;
  description: string;
  narrativeFormed: boolean;
  hoursAhead: number; // How far ahead of narrative
}

/**
 * Resolution rules often differ from narrative expectations.
 * This creates edge for those who read the fine print.
 */
export interface ResolutionAnalysis {
  market: Market;
  actualCriteria: string[];
  commonMisunderstandings: string[];
  ambiguousTerms: string[];
  edgeFromMisunderstanding: number; // 0-1
}

/**
 * Related markets have lag in price synchronization.
 * Primary market moves → Related markets eventually follow.
 */
export interface CorrelatedMarketLag {
  primaryMarket: Market;
  relatedMarkets: Market[];
  primaryMoved: boolean;
  relatedLagging: boolean;
  lagDuration: number; // minutes
  potentialEdge: number;
}

/**
 * Attention metrics for a market.
 * Low attention = longer-lived mispricings.
 */
export interface AttentionMetrics {
  market: Market;
  socialMentions: number;
  newsArticles: number;
  attentionScore: number; // 0-1, lower = less attention
  expectedEdgeDecay: number; // hours until edge likely gone
}

// =============================================================================
// PRIMARY SIGNAL SOURCES
// =============================================================================

/**
 * Primary signals appear before narrative catches up.
 * These are "boring" sources that most traders ignore.
 */
export const PRIMARY_SIGNAL_SOURCES = [
  // Legal/Regulatory
  'sec_edgar',           // SEC filings
  'court_docket',        // Court filings and rulings
  'federal_register',    // Federal regulations
  'congress_gov',        // Congressional actions

  // Economic/Fed
  'fed_statement',       // FOMC statements (exact text)
  'treasury_auction',    // Treasury results
  'bls_release',         // Jobs/CPI official data

  // Corporate
  '8k_filing',           // Material events
  'proxy_statement',     // Shareholder votes
  'earnings_transcript', // Actual words, not headlines

  // Government
  'executive_order',     // Official orders
  'agency_ruling',       // Regulatory decisions
] as const;

/**
 * Secondary signals are what most traders react to.
 * By the time you see these, the edge is often gone.
 */
export const SECONDARY_SIGNAL_SOURCES = [
  'news_headline',
  'twitter_viral',
  'reddit_post',
  'analyst_commentary',
  'tv_pundit',
] as const;

// =============================================================================
// INTERPRETATION UNCERTAINTY DETECTION
// =============================================================================

/**
 * Detect interpretation uncertainty.
 *
 * Key insight: "Mispricing exists not because information is missing,
 * but because the market doesn't know what to DO with the information."
 *
 * Signals of high interpretation uncertainty:
 * - High volume but stable price (people trading but no consensus)
 * - New information arrived but price hasn't moved much
 * - Conflicting signals from different sources
 */
export function detectInterpretationUncertainty(
  market: Market,
  recentVolume: number,
  avgVolume: number,
  priceChange24h: number,
  hasRecentNews: boolean
): InterpretationState {
  const volumeRatio = avgVolume > 0 ? recentVolume / avgVolume : 1;
  const volumeLevel = volumeRatio > 2 ? 'high' : volumeRatio > 0.5 ? 'normal' : 'low';
  const priceStable = Math.abs(priceChange24h) < 0.05; // <5% move

  // High volume + stable price = uncertainty
  // People are trading but can't agree on direction
  const volumePriceDisconnect = volumeLevel === 'high' && priceStable;

  // New info + stable price = market hasn't processed it
  const infoNotProcessed = hasRecentNews && priceStable;

  // Calculate uncertainty score
  let uncertaintyScore = 0;

  if (volumePriceDisconnect) {
    uncertaintyScore += 0.4;
  }

  if (infoNotProcessed) {
    uncertaintyScore += 0.3;
  }

  if (volumeLevel === 'high') {
    uncertaintyScore += 0.15;
  }

  if (priceStable && hasRecentNews) {
    uncertaintyScore += 0.15;
  }

  const narrativeCrystallized = !priceStable && volumeLevel === 'high';

  return {
    hasNewInfo: hasRecentNews,
    narrativeCrystallized,
    volumeLevel,
    priceStable,
    uncertaintyScore: Math.min(1, uncertaintyScore),
  };
}

/**
 * The edge window is between information arrival and narrative crystallization.
 *
 * "The window between those two states is where almost all edge lives.
 * It's usually brief, it's usually uncomfortable.
 * And it rarely feels obvious in the moment."
 */
export function isInEdgeWindow(state: InterpretationState): boolean {
  return (
    state.hasNewInfo &&
    !state.narrativeCrystallized &&
    state.uncertaintyScore > 0.4
  );
}

// =============================================================================
// CORRELATED MARKET LAG DETECTION
// =============================================================================

/**
 * Market correlation mappings.
 *
 * "Related markets almost never move in sync.
 * The lag is where opportunity appears."
 */
export const MARKET_CORRELATIONS: Record<string, string[]> = {
  // Presidential → downstream markets
  'presidential_winner': [
    'cabinet_*',
    'policy_*',
    'executive_order_*',
    'supreme_court_nomination_*',
  ],

  // Fed decision → downstream
  'fed_rate_decision': [
    'recession_*',
    'treasury_*',
    'inflation_*',
    'unemployment_*',
  ],

  // Sports championship → downstream
  'superbowl_winner': [
    'conference_champion_*',
    'mvp_*',
    'playoff_*',
  ],

  // Earnings → company-specific
  'earnings_beat_*': [
    'stock_price_*',
    'ceo_departure_*',
    'dividend_*',
  ],
};

/**
 * Detect when a primary market has moved but related markets lag.
 *
 * This is a high-conviction edge because:
 * 1. The primary event has resolved/moved
 * 2. Related markets WILL eventually adjust
 * 3. The only question is timing
 */
export function detectCorrelatedLag(
  primaryMarket: Market,
  relatedMarkets: Market[],
  primaryPriceChange: number,
  relatedPriceChanges: number[]
): CorrelatedMarketLag | null {
  // Primary must have moved significantly (>10%)
  if (Math.abs(primaryPriceChange) < 0.10) {
    return null;
  }

  // Check if related markets have lagged
  const avgRelatedChange = relatedPriceChanges.length > 0
    ? relatedPriceChanges.reduce((a, b) => a + Math.abs(b), 0) / relatedPriceChanges.length
    : 0;

  // Related markets should have moved less than half of primary
  const relatedLagging = avgRelatedChange < Math.abs(primaryPriceChange) * 0.5;

  if (!relatedLagging) {
    return null;
  }

  // Estimate potential edge as the gap between primary and related movement
  const potentialEdge = Math.abs(primaryPriceChange) - avgRelatedChange;

  return {
    primaryMarket,
    relatedMarkets,
    primaryMoved: true,
    relatedLagging: true,
    lagDuration: 0, // Would need timestamp tracking
    potentialEdge,
  };
}

// =============================================================================
// RESOLUTION RULES ANALYSIS
// =============================================================================

/**
 * Common resolution rule misunderstandings.
 *
 * "Markets routinely price outcomes based on how events FEEL,
 * rather than how they are actually resolved under the market's specific rules."
 */
export const RESOLUTION_GOTCHAS: Record<string, string> = {
  // Time-based
  'end_of_year': 'Usually means Dec 31 11:59 PM ET, not "sometime in December"',
  'by_date': 'Typically means BEFORE the date, not on the date',
  'before': 'Strictly before, not on or before',

  // Action-based
  'announce': 'Must be official announcement, not leak or rumor',
  'confirm': 'Requires official confirmation, not reporting',
  'resign': 'Must actually resign, not "expected to resign"',
  'step_down': 'May differ from "resign" - check specific rules',

  // Threshold-based
  'above': 'Usually means strictly above, not equal to',
  'at_least': 'Includes the threshold value',
  'exceed': 'Must be strictly greater than',

  // Source-based
  'official': 'Must come from official channel, not secondhand reporting',
  'according_to': 'Resolution depends on specific source named',
};

/**
 * Analyze resolution rules for potential edge.
 *
 * "People stop here because it's tedious.
 * That's why it works."
 */
export function analyzeResolutionRules(
  market: Market,
  marketDescription: string
): ResolutionAnalysis {
  const actualCriteria: string[] = [];
  const commonMisunderstandings: string[] = [];
  const ambiguousTerms: string[] = [];

  const descLower = marketDescription.toLowerCase();

  // Check for each gotcha
  for (const [term, explanation] of Object.entries(RESOLUTION_GOTCHAS)) {
    if (descLower.includes(term.replace('_', ' '))) {
      actualCriteria.push(`"${term}": ${explanation}`);
    }
  }

  // Look for ambiguous language
  const ambiguousPatterns = [
    /\b(may|might|could|possibly)\b/i,
    /\b(generally|typically|usually)\b/i,
    /\b(discretion|judgment|determined by)\b/i,
    /\b(reasonable|substantial|significant)\b/i,
  ];

  for (const pattern of ambiguousPatterns) {
    const match = descLower.match(pattern);
    if (match) {
      ambiguousTerms.push(match[0]);
    }
  }

  // Estimate edge from misunderstanding
  // More gotchas + more ambiguity = more potential edge
  const edgeFromMisunderstanding = Math.min(
    0.15,
    actualCriteria.length * 0.03 + ambiguousTerms.length * 0.02
  );

  return {
    market,
    actualCriteria,
    commonMisunderstandings,
    ambiguousTerms,
    edgeFromMisunderstanding,
  };
}

// =============================================================================
// ATTENTION-BASED EDGE DECAY
// =============================================================================

/**
 * Estimate how long an edge will persist based on attention.
 *
 * "Highly visible markets tend to reprice quickly but offer little room for size.
 * Low-attention markets move slowly, often for reasons unrelated to fundamentals,
 * and then suddenly catch up all at once."
 */
export function estimateEdgeDecay(
  market: Market,
  socialMentions24h: number,
  newsArticles24h: number,
  marketVolume24h: number
): AttentionMetrics {
  // Normalize attention signals
  const socialScore = Math.min(1, socialMentions24h / 100);
  const newsScore = Math.min(1, newsArticles24h / 10);
  const volumeScore = Math.min(1, marketVolume24h / 100000);

  // Combined attention score (0-1, higher = more attention)
  const attentionScore = (socialScore * 0.4 + newsScore * 0.4 + volumeScore * 0.2);

  // Expected edge decay based on attention
  // High attention = edge decays in hours
  // Low attention = edge may persist for days
  let expectedEdgeDecay: number;
  if (attentionScore > 0.7) {
    expectedEdgeDecay = 2; // Hours
  } else if (attentionScore > 0.4) {
    expectedEdgeDecay = 12; // Hours
  } else if (attentionScore > 0.2) {
    expectedEdgeDecay = 48; // Hours
  } else {
    expectedEdgeDecay = 168; // 7 days
  }

  return {
    market,
    socialMentions: socialMentions24h,
    newsArticles: newsArticles24h,
    attentionScore,
    expectedEdgeDecay,
  };
}

/**
 * Low-attention markets are where edges persist longest.
 *
 * "This is why markets often underprice early signals that feel 'boring'
 * or hard to summarize, even when those signals meaningfully constrain
 * future outcomes."
 */
export function isLowAttentionMarket(metrics: AttentionMetrics): boolean {
  return metrics.attentionScore < 0.3;
}

// =============================================================================
// SIGNAL CLASSIFICATION
// =============================================================================

/**
 * Classify whether a signal is primary (leads narrative) or secondary (follows).
 *
 * "Primary signals — legal filings, official actions, procedural milestones —
 * tend to appear before the narrative catches up. Secondary signals —
 * headlines, threads, summaries — are what most participants actually trade."
 */
export function classifySignal(
  source: string,
  description: string
): SignalClassification {
  const sourceLower = source.toLowerCase();

  // Check if primary source
  const isPrimary = PRIMARY_SIGNAL_SOURCES.some(ps =>
    sourceLower.includes(ps.replace('_', ' ')) ||
    sourceLower.includes(ps.replace('_', ''))
  );

  // Check for narrative formation indicators
  const narrativeIndicators = [
    'breaking',
    'just in',
    'everyone is talking',
    'viral',
    'trending',
  ];
  const narrativeFormed = narrativeIndicators.some(ind =>
    description.toLowerCase().includes(ind)
  );

  return {
    type: isPrimary ? 'primary' : 'secondary',
    source,
    description,
    narrativeFormed,
    hoursAhead: isPrimary && !narrativeFormed ? 6 : 0,
  };
}

// =============================================================================
// EDGE CREATION HELPERS
// =============================================================================

/**
 * Create an edge from interpretation uncertainty.
 */
export function createUncertaintyEdge(
  market: Market,
  state: InterpretationState,
  suggestedDirection: 'YES' | 'NO',
  baseEdge: number
): Edge | null {
  if (!isInEdgeWindow(state)) {
    return null;
  }

  // Scale edge by uncertainty
  const adjustedEdge = baseEdge * (0.5 + state.uncertaintyScore * 0.5);

  const reason = `🎯 INTERPRETATION WINDOW | ` +
    `New info arrived, narrative not yet formed | ` +
    `Volume: ${state.volumeLevel}, Price: ${state.priceStable ? 'stable' : 'moving'} | ` +
    `Uncertainty: ${(state.uncertaintyScore * 100).toFixed(0)}% | ` +
    `→ **${(adjustedEdge * 100).toFixed(1)}% edge**`;

  return createEdge(
    market,
    suggestedDirection,
    adjustedEdge,
    0.6 + state.uncertaintyScore * 0.2,
    reason,
    {
      type: 'interpretation_uncertainty',
      uncertaintyScore: state.uncertaintyScore,
      volumeLevel: state.volumeLevel,
      priceStable: state.priceStable,
    }
  );
}

/**
 * Create an edge from correlated market lag.
 */
export function createLagEdge(
  lag: CorrelatedMarketLag,
  relatedMarket: Market,
  direction: 'YES' | 'NO'
): Edge {
  const reason = `⏱️ CORRELATED LAG | ` +
    `Primary market "${lag.primaryMarket.title}" moved significantly | ` +
    `This related market hasn't caught up yet | ` +
    `→ **${(lag.potentialEdge * 100).toFixed(1)}% edge**`;

  return createEdge(
    relatedMarket,
    direction,
    lag.potentialEdge,
    0.75, // High confidence - primary already moved
    reason,
    {
      type: 'correlated_lag',
      primaryMarket: lag.primaryMarket.title,
      lagDuration: lag.lagDuration,
    }
  );
}

/**
 * Create an edge from resolution rule analysis.
 */
export function createResolutionEdge(
  analysis: ResolutionAnalysis,
  direction: 'YES' | 'NO',
  mispricing: number
): Edge | null {
  if (analysis.edgeFromMisunderstanding < 0.03) {
    return null;
  }

  const gotchas = analysis.actualCriteria.slice(0, 2).join('; ');

  const reason = `📋 RESOLUTION RULES | ` +
    `Market prices narrative, not actual resolution criteria | ` +
    `Key gotchas: ${gotchas} | ` +
    `→ **${(mispricing * 100).toFixed(1)}% edge**`;

  return createEdge(
    analysis.market,
    direction,
    mispricing,
    0.7,
    reason,
    {
      type: 'resolution_rules',
      actualCriteria: analysis.actualCriteria,
      ambiguousTerms: analysis.ambiguousTerms,
    }
  );
}

// =============================================================================
// LOGGING
// =============================================================================

/**
 * Log informed capital insights (for debugging/monitoring).
 */
export function logInformedCapitalInsight(
  type: string,
  market: Market,
  details: Record<string, unknown>
): void {
  logger.info(`[InformedCapital] ${type}: ${market.title}`, details);
}
