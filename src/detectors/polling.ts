/**
 * Polling Edge Detector v4.0
 *
 * Detects edges in political markets by comparing prediction market prices
 * to polling aggregates from 538, RCP, and other sources.
 *
 * Edge thesis: Polling aggregators provide relatively unbiased probability
 * estimates. When markets diverge significantly from these estimates,
 * there may be an edge.
 *
 * Caveats:
 * - Polls have error margins (typically +-3-4%)
 * - Markets may have information not yet in polls
 * - "Herding" can make polls too similar
 * - Likely voter screens may miss turnout shifts
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import {
  POLITICS_CONFIG,
  analyzeTimeHorizon,
  meetsTimeHorizonThreshold,
  preFilterMarkets,
} from '../utils/time-horizon.js';
import {
  comparePollingToMarket,
  type PollingData,
  type PollingEdgeSignal,
} from '../sources/polling.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum edge to surface (as decimal, e.g., 0.05 = 5%) */
const MIN_EDGE = 0.05;

/** Minimum confidence to include */
const MIN_CONFIDENCE = 0.50;

/** Keywords that identify political/election markets */
const POLITICAL_KEYWORDS = [
  'president',
  'election',
  'electoral',
  'trump',
  'harris',
  'biden',
  'republican',
  'democrat',
  'gop',
  'dnc',
  'rnc',
  'senate',
  'congress',
  'governor',
  'primary',
  'caucus',
  'nomination',
  'nominee',
  'popular vote',
  'swing state',
  'battleground',
  'approval',
  'approve',
  'disapprove',
];

/** Patterns to extract candidates from market titles */
const CANDIDATE_PATTERNS: Array<{ pattern: RegExp; candidate: string }> = [
  { pattern: /trump/i, candidate: 'Donald Trump' },
  { pattern: /harris/i, candidate: 'Kamala Harris' },
  { pattern: /biden/i, candidate: 'Joe Biden' },
  { pattern: /republican|gop/i, candidate: 'Republican' },
  { pattern: /democrat|democratic/i, candidate: 'Democrat' },
];

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'polling',
  description: 'Detects edges in political markets using 538/RCP polling data',
  sources: ['kalshi', 'polling'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Get polling data from source
    const pollingData = data['polling'] as PollingData | undefined;
    if (!pollingData) {
      // Polling sources may be unavailable between election cycles
      logger.debug('Polling detector: No polling data available (between election cycles)');
      return edges;
    }

    if (pollingData.sources.length === 0) {
      logger.debug('Polling detector: No polling sources returned data');
      return edges;
    }

    logger.debug(`Polling detector: Data from ${pollingData.sources.join(', ')}`);

    // Find political markets
    const allPoliticalMarkets = markets.filter(isPoliticalMarket);

    // Apply time horizon pre-filter (30d priority, 60+ higher edge, year+ filter)
    const politicalMarkets = preFilterMarkets(allPoliticalMarkets, POLITICS_CONFIG, 365);
    const filteredCount = allPoliticalMarkets.length - politicalMarkets.length;
    if (filteredCount > 0) {
      logger.info(`Polling detector: Filtered ${filteredCount} far-dated political markets`);
    }

    if (politicalMarkets.length === 0) {
      logger.debug('Polling detector: No political markets found');
      return edges;
    }

    logger.info(`Polling detector: Analyzing ${politicalMarkets.length} political markets`);

    // Build market price map for comparison
    const marketPrices = buildMarketPriceMap(politicalMarkets);

    // Compare polling to market prices
    const pollingEdges = comparePollingToMarket(pollingData, marketPrices);

    // Convert polling signals to v4 Edge format
    for (const signal of pollingEdges) {
      if (signal.edge / 100 < MIN_EDGE) continue;
      if (signal.confidence < MIN_CONFIDENCE) continue;

      // Find the corresponding market
      const market = findMarketForCandidate(politicalMarkets, signal.candidate);
      if (!market) {
        logger.debug(`Polling detector: No market found for candidate ${signal.candidate}`);
        continue;
      }

      const edgeDecimal = signal.edge / 100;

      // Apply time horizon threshold check
      if (!meetsTimeHorizonThreshold(market, edgeDecimal, POLITICS_CONFIG, 'Politics')) {
        continue;
      }

      const edge = createPollingEdge(market, signal, pollingData);
      edges.push(edge);
    }

    // Also check for approval rating markets directly
    const approvalEdges = detectApprovalEdges(politicalMarkets, pollingData);
    for (const edge of approvalEdges) {
      if (meetsTimeHorizonThreshold(
        politicalMarkets.find(m => m.ticker === edge.market.ticker) ?? edge.market,
        edge.edge,
        POLITICS_CONFIG,
        'Politics'
      )) {
        edges.push(edge);
      }
    }

    if (edges.length > 0) {
      logger.info(`Polling detector: Found ${edges.length} edges (after time horizon filtering)`);
    }
    return edges;
  },
});

// =============================================================================
// MARKET MATCHING
// =============================================================================

/**
 * Check if a market is a political/election market
 */
function isPoliticalMarket(market: Market): boolean {
  const title = market.title.toLowerCase();
  const subtitle = (market.subtitle ?? '').toLowerCase();
  const text = `${title} ${subtitle}`;

  return POLITICAL_KEYWORDS.some(keyword => text.includes(keyword));
}

/**
 * Extract candidate name from market
 */
function extractCandidate(market: Market): string | null {
  const title = market.title.toLowerCase();

  for (const { pattern, candidate } of CANDIDATE_PATTERNS) {
    if (pattern.test(title)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Build a map of candidate names to market YES prices
 */
function buildMarketPriceMap(markets: Market[]): Record<string, number> {
  const prices: Record<string, number> = {};

  for (const market of markets) {
    const candidate = extractCandidate(market);
    if (candidate && market.price !== undefined) {
      // Store as decimal (0-1)
      prices[candidate] = market.price;
    }
  }

  return prices;
}

/**
 * Find the market corresponding to a candidate
 */
function findMarketForCandidate(markets: Market[], candidate: string): Market | null {
  const candidateLower = candidate.toLowerCase();

  for (const market of markets) {
    const marketCandidate = extractCandidate(market);
    if (marketCandidate?.toLowerCase() === candidateLower) {
      return market;
    }

    // Also check if market title directly mentions candidate
    if (market.title.toLowerCase().includes(candidateLower)) {
      return market;
    }
  }

  return null;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Create Edge from polling signal
 */
function createPollingEdge(
  market: Market,
  signal: PollingEdgeSignal,
  polling: PollingData
): Edge {
  const edgeDecimal = signal.edge / 100;  // Convert percentage to decimal

  const reason = buildReason(market, signal, polling);

  return createEdge(
    market,
    signal.direction,
    edgeDecimal,
    signal.confidence,
    reason,
    {
      type: 'polling',
      candidate: signal.candidate,
      pollingImplied: signal.pollingImplied,
      marketPrice: signal.marketPrice,
      sources: polling.sources,
      reasoning: signal.reasoning,
    }
  );
}

/**
 * Detect edges in approval rating markets
 */
function detectApprovalEdges(markets: Market[], polling: PollingData): Edge[] {
  const edges: Edge[] = [];

  // Find approval rating markets
  const approvalMarkets = markets.filter(m =>
    m.title.toLowerCase().includes('approval') ||
    m.title.toLowerCase().includes('approve')
  );

  if (approvalMarkets.length === 0 || polling.approvalRatings.length === 0) {
    return edges;
  }

  for (const market of approvalMarkets) {
    const candidate = extractCandidate(market);
    if (!candidate) continue;

    // Find matching approval rating
    const rating = polling.approvalRatings.find(r =>
      r.politician.toLowerCase().includes(candidate.toLowerCase()) ||
      candidate.toLowerCase().includes(r.politician.toLowerCase())
    );

    if (!rating) continue;

    // Check for threshold markets (e.g., "Trump approval above 50%")
    const thresholdMatch = market.title.match(/(?:above|over|at least|>=?)\s*(\d+)/i);
    if (thresholdMatch) {
      const threshold = parseInt(thresholdMatch[1], 10);
      const edge = analyzeApprovalThreshold(market, rating, threshold, polling);
      if (edge) {
        edges.push(edge);
      }
    }
  }

  return edges;
}

/**
 * Analyze an approval threshold market
 */
function analyzeApprovalThreshold(
  market: Market,
  rating: { politician: string; approve: number; disapprove: number; source: string },
  threshold: number,
  polling: PollingData
): Edge | null {
  const currentApproval = rating.approve;
  const marketPrice = market.price;

  // Estimate probability of being above threshold
  // Use a simple model: assume normal distribution with stddev of 3 (typical polling error)
  const stdDev = 3;
  const zScore = (threshold - currentApproval) / stdDev;

  // Standard normal CDF approximation for P(X > threshold)
  const probability = 1 - normalCDF(zScore);

  const edge = Math.abs(probability - marketPrice);
  if (edge < MIN_EDGE) return null;

  const direction = probability > marketPrice ? 'YES' : 'NO';
  const confidence = Math.min(0.85, 0.5 + polling.sources.length * 0.1);

  // Get time horizon context
  const { label: timeLabel } = analyzeTimeHorizon(market, POLITICS_CONFIG);
  const edgePct = (edge * 100).toFixed(1);

  const reason = `${timeLabel} | **POLITICS** Approval | ` +
    `${rating.politician} at ${currentApproval.toFixed(1)}% (${rating.source}) | ` +
    `P(>${threshold}%): ${(probability * 100).toFixed(0)}% vs Mkt: ${(marketPrice * 100).toFixed(0)}% | ` +
    `→ **${edgePct}% edge**`;

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'polling',
      subtype: 'approval-threshold',
      politician: rating.politician,
      currentApproval,
      threshold,
      impliedProbability: probability,
      marketPrice,
      sources: polling.sources,
    }
  );
}

/**
 * Build human-readable reason string with time horizon context
 */
function buildReason(market: Market, signal: PollingEdgeSignal, polling: PollingData): string {
  const { label: timeLabel } = analyzeTimeHorizon(market, POLITICS_CONFIG);
  const edgePct = signal.edge.toFixed(1);

  return `${timeLabel} | **POLITICS** ${signal.candidate} | ` +
    `Polling: ${signal.pollingImplied.toFixed(0)}% vs Mkt: ${signal.marketPrice.toFixed(0)}% | ` +
    `${signal.reasoning} | Sources: ${polling.sources.join(', ')} | ` +
    `→ **${edgePct}% edge**`;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Standard normal CDF approximation
 */
function normalCDF(x: number): number {
  // Approximation using error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}
