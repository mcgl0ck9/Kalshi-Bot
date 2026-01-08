/**
 * Entertainment Edge Detector (v4)
 *
 * Detects edges in entertainment markets:
 * - Rotten Tomatoes score markets (the big one!)
 * - Box office prediction markets
 * - Awards prediction markets
 *
 * EDGE THESIS:
 * RT markets are often mispriced because:
 * 1. Scores can only go DOWN over time (more reviews = regression to mean)
 * 2. If current score is ABOVE threshold, it's very likely to stay above
 * 3. If current score is BELOW threshold with few reviews, it might rise
 * 4. Markets don't update fast enough when scores change
 *
 * EXAMPLE:
 * - Movie "Primate" has 92% RT score
 * - Market: "Will Primate RT score be above 85%?" trading at 75c
 * - Edge: Score is already above 85%, near-certain YES
 * - Only risk: Score drops below 85% before market closes (rare for established films)
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
  type EntertainmentData,
  type MovieScore,
  getMovieScore,
  extractMovieFromMarketTitle,
  normalizeMovieTitle,
} from '../sources/entertainment.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.03;  // 3% minimum edge for RT markets
const MIN_CONFIDENCE = 0.40;

// Patterns for identifying entertainment market types
const ENTERTAINMENT_PATTERNS = {
  rottenTomatoes: [
    /rotten\s*tomatoes/i,
    /tomatometer/i,
    /\brt\b.*score/i,
    /critics?\s*score/i,
  ],
  boxOffice: [
    /box\s*office/i,
    /opening\s*weekend/i,
    /domestic\s*gross/i,
    /weekend\s*gross/i,
    /\$\d+.*million/i,
  ],
  awards: [
    /oscar/i,
    /academy\s*award/i,
    /golden\s*globe/i,
    /emmy/i,
    /grammy/i,
    /best\s*picture/i,
    /best\s*actor/i,
    /best\s*actress/i,
  ],
};

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'entertainment',
  description: 'Detects edges in movie/TV/awards markets (RT scores, box office, awards)',
  sources: ['kalshi', 'entertainment'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const entertainmentData = data['entertainment'] as EntertainmentData | undefined;
    if (!entertainmentData) {
      logger.debug('Entertainment detector: No entertainment data available');
      return edges;
    }

    // Find entertainment markets
    const entertainmentMarkets = markets.filter(m =>
      m.category === 'entertainment' ||
      isEntertainmentMarket(m)
    );

    if (entertainmentMarkets.length === 0) {
      logger.debug('Entertainment detector: No entertainment markets found');
      return edges;
    }

    logger.info(`Entertainment detector: Analyzing ${entertainmentMarkets.length} entertainment markets`);

    // Process each market
    for (const market of entertainmentMarkets) {
      const marketType = classifyMarketType(market);

      if (marketType === 'rotten_tomatoes') {
        const edge = analyzeRTMarket(market, entertainmentData);
        if (edge) edges.push(edge);
      } else if (marketType === 'awards') {
        const edge = analyzeAwardsMarket(market, entertainmentData);
        if (edge) edges.push(edge);
      }
      // Note: Box office requires separate data source integration
    }

    // Deduplicate: only keep best edge per movie
    const dedupedEdges = deduplicateEdges(edges);

    logger.info(`Entertainment detector: Found ${dedupedEdges.length} edges (deduplicated from ${edges.length})`);
    return dedupedEdges;
  },
});

// =============================================================================
// MARKET CLASSIFICATION
// =============================================================================

function isEntertainmentMarket(market: Market): boolean {
  const text = `${market.title} ${market.subtitle ?? ''}`.toLowerCase();

  for (const patterns of Object.values(ENTERTAINMENT_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return true;
    }
  }

  return false;
}

type MarketType = 'rotten_tomatoes' | 'box_office' | 'awards' | 'unknown';

function classifyMarketType(market: Market): MarketType {
  const text = `${market.title} ${market.subtitle ?? ''}`.toLowerCase();

  if (ENTERTAINMENT_PATTERNS.rottenTomatoes.some(p => p.test(text))) {
    return 'rotten_tomatoes';
  }

  if (ENTERTAINMENT_PATTERNS.boxOffice.some(p => p.test(text))) {
    return 'box_office';
  }

  if (ENTERTAINMENT_PATTERNS.awards.some(p => p.test(text))) {
    return 'awards';
  }

  return 'unknown';
}

// =============================================================================
// ROTTEN TOMATOES ANALYSIS
// =============================================================================

function analyzeRTMarket(market: Market, data: EntertainmentData): Edge | null {
  // Extract movie title and threshold from market title (and subtitle for threshold)
  const extracted = extractMovieFromMarketTitle(market.title, market.subtitle);

  if (!extracted?.movieTitle) {
    logger.info(`Entertainment: Could not extract movie from "${market.title}" (subtitle: ${market.subtitle ?? 'none'})`);
    return null;
  }

  const movieTitle = extracted.movieTitle;
  const threshold = extracted.threshold;

  if (threshold === undefined) {
    logger.info(`Entertainment: No threshold found in "${market.title}"`);
    return null;
  }

  logger.info(`Entertainment: Extracted "${movieTitle}" threshold=${threshold} from "${market.title}"`);

  // Find movie score in our data
  const movieScore = getMovieScore(data, movieTitle);

  // CRITICAL: Do NOT generate edges for movies without ACTUAL RT scores
  // Movies without scores (unreleased) are unpredictable - no edge exists
  if (!movieScore) {
    logger.info(`Entertainment: No data found for "${movieTitle}" - skipping (movie not tracked or not released)`);
    return null;
  }

  if (movieScore.tomatometer === undefined || movieScore.tomatometer === null) {
    logger.info(`Entertainment: "${movieTitle}" has no RT score yet (unreleased?) - skipping`);
    return null;
  }

  const currentScore = movieScore.tomatometer;
  const reviewCount = movieScore.reviewCount ?? 0;

  logger.info(`Entertainment: "${movieTitle}" has ${currentScore}% RT with ${reviewCount} reviews, market price ${(market.price * 100).toFixed(0)}¢`);

  // Require at least SOME reviews to have confidence
  if (reviewCount < 5) {
    logger.info(`Entertainment: "${movieTitle}" only has ${reviewCount} reviews - too few for confident prediction`);
    return null;
  }

  logger.info(`Entertainment: ${movieTitle} has ${currentScore}% RT score (${reviewCount} reviews), threshold ${threshold}%`);

  // Calculate implied probability that score stays above threshold
  const { probability, confidence, reasoning } = calculateRTImpliedProbability(
    currentScore,
    threshold,
    reviewCount
  );

  if (confidence < MIN_CONFIDENCE) {
    logger.debug(`Entertainment: Low confidence (${confidence}) for ${movieTitle}`);
    return null;
  }

  // Calculate edge
  const marketPrice = market.price;
  const edge = Math.abs(probability - marketPrice);

  if (edge < MIN_EDGE) {
    logger.debug(`Entertainment: Edge too small (${(edge * 100).toFixed(1)}%) for ${movieTitle}`);
    return null;
  }

  // Determine direction
  const direction = probability > marketPrice ? 'YES' : 'NO';

  // Build reason
  const reason = buildRTReason(movieTitle, currentScore, threshold, probability, marketPrice, direction, reviewCount);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'entertainment',
      subtype: 'rotten_tomatoes',
      movieTitle,
      currentScore,
      threshold,
      scoreType: 'tomatometer',
      reviewCount,
      buffer: currentScore - threshold,
      probability,
      marketPrice,
      sources: data.movies.find(m => normalizeMovieTitle(m.title) === normalizeMovieTitle(movieTitle))
        ? ['rotten_tomatoes']
        : ['estimated'],
    }
  );
}

/**
 * Calculate implied probability that RT score stays above threshold
 *
 * Key insight: RT scores generally DECLINE over time as more reviews come in
 * (early reviews often from enthusiasts, later reviews from general critics)
 */
function calculateRTImpliedProbability(
  currentScore: number,
  threshold: number,
  reviewCount: number
): { probability: number; confidence: number; reasoning: string } {
  const buffer = currentScore - threshold;
  const reviews = reviewCount || 50;  // Default assumption

  // Score is BELOW threshold
  if (buffer < 0) {
    if (reviews < 10) {
      // Could still swing with few reviews
      const prob = Math.max(0.05, 0.3 + (buffer * 0.02));
      return {
        probability: prob,
        confidence: 0.5,
        reasoning: `Score ${currentScore}% is ${Math.abs(buffer)} points BELOW ${threshold}%, but only ${reviews} reviews - could swing`,
      };
    } else {
      // Established score, unlikely to rise
      const prob = Math.max(0.02, 0.1 + (buffer * 0.01));
      return {
        probability: prob,
        confidence: 0.8,
        reasoning: `Score ${currentScore}% is ${Math.abs(buffer)} points BELOW ${threshold}% with ${reviews} reviews - very unlikely to rise`,
      };
    }
  }

  // Score is ABOVE threshold - calculate probability it stays above
  let probability = 0.5;

  // More buffer = higher probability
  // Each point of buffer adds ~3% certainty (capped)
  probability += Math.min(0.45, buffer * 0.03);

  // More reviews = more stable (less likely to drop)
  // 100+ reviews = very stable, 10 reviews = volatile
  const stabilityBonus = Math.min(0.15, (reviews / 100) * 0.15);
  probability += stabilityBonus;

  // Large buffer (10+ points) = near certain
  if (buffer >= 10) {
    probability = Math.min(0.98, probability + 0.1);
  }

  // Massive buffer (20+ points) = essentially certain
  if (buffer >= 20) {
    probability = 0.99;
  }

  // Very small buffer (1-2 points) = risky
  if (buffer <= 2) {
    probability = Math.max(0.55, probability - 0.15);
  }

  // Confidence based on review count
  const confidence = Math.min(0.95, 0.5 + (reviews / 200));

  return {
    probability: Math.min(0.99, probability),
    confidence,
    reasoning: `Score ${currentScore}% is ${buffer} points ABOVE ${threshold}% with ${reviews} reviews`,
  };
}

function buildRTReason(
  movieTitle: string,
  currentScore: number,
  threshold: number,
  probability: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  reviewCount: number
): string {
  const probPct = (probability * 100).toFixed(0);
  const pricePct = (marketPrice * 100).toFixed(0);
  const buffer = currentScore - threshold;

  if (direction === 'YES') {
    if (buffer > 0) {
      return `${movieTitle} RT score is ${currentScore}% (${buffer} points ABOVE ${threshold}% threshold). ` +
        `With ${reviewCount} reviews, ${probPct}% likely to stay above vs market price ${pricePct}%.`;
    } else {
      return `${movieTitle} RT score is ${currentScore}% (below ${threshold}%), but only ${reviewCount} reviews. ` +
        `${probPct}% chance to exceed threshold vs market price ${pricePct}%.`;
    }
  } else {
    return `${movieTitle} RT score is ${currentScore}% vs ${threshold}% threshold. ` +
      `Only ${probPct}% chance YES, but market prices at ${pricePct}%.`;
  }
}

// =============================================================================
// AWARDS ANALYSIS
// =============================================================================

function analyzeAwardsMarket(market: Market, data: EntertainmentData): Edge | null {
  const title = market.title.toLowerCase();

  // Extract nominee/category info from market title
  const nomineeMatch = title.match(/(?:will\s+)?["']?([^"']+?)["']?\s+win\s+(?:the\s+)?(?:best\s+)?([^?]+)/i);

  if (!nomineeMatch) {
    return null;
  }

  const nomineeName = nomineeMatch[1].trim();
  const categoryName = nomineeMatch[2].trim();

  // Determine award type
  const isOscar = title.includes('oscar') || title.includes('academy');
  const isEmmy = title.includes('emmy');
  const isGrammy = title.includes('grammy');

  // Base probabilities for different scenarios
  let baseProbability = 0.20;  // Default: assume 5 nominees = 20% base

  // Try to get additional data about the nominee (movie/show)
  const movieScore = getMovieScore(data, nomineeName);

  if (movieScore) {
    // Adjust probability based on movie quality metrics
    // Higher RT scores correlate with awards wins
    if (movieScore.tomatometer && movieScore.tomatometer >= 90) {
      baseProbability *= 1.3;  // 30% boost for excellent reviews
    } else if (movieScore.tomatometer && movieScore.tomatometer >= 80) {
      baseProbability *= 1.15;
    }

    // Certified fresh is a positive signal
    if (movieScore.certifiedFresh) {
      baseProbability *= 1.1;
    }
  }

  // Adjust for award type
  if (isOscar) {
    // Oscar prediction model - look for patterns
    if (categoryName.includes('picture')) {
      baseProbability = Math.min(0.95, baseProbability);
    }
  } else if (isEmmy) {
    baseProbability = 0.17;  // Typically 6 nominees
  } else if (isGrammy) {
    baseProbability = 0.20;  // Less predictable
  }

  // Cap probability at 95%
  baseProbability = Math.min(0.95, baseProbability);

  const marketPrice = market.price;
  const edge = Math.abs(baseProbability - marketPrice);

  // Only surface significant edges (8%+) for awards
  if (edge < 0.08) {
    return null;
  }

  const direction = baseProbability > marketPrice ? 'YES' : 'NO';
  const confidence = Math.min(0.75, 0.4 + edge);  // Awards are inherently less predictable

  const reason = `${nomineeName} for ${categoryName}: Model suggests ${(baseProbability * 100).toFixed(0)}% vs market ${(marketPrice * 100).toFixed(0)}%`;

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'entertainment',
      subtype: 'awards',
      nominee: nomineeName,
      category: categoryName,
      isOscar,
      isEmmy,
      isGrammy,
      probability: baseProbability,
      marketPrice,
      hasMovieData: !!movieScore,
    }
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Deduplicate edges, keeping only the best edge per movie
 */
function deduplicateEdges(edges: Edge[]): Edge[] {
  const bestPerMovie = new Map<string, Edge>();

  for (const edge of edges) {
    const movieTitle = edge.signal.movieTitle as string || edge.signal.nominee as string || 'unknown';
    const key = normalizeMovieTitle(movieTitle);
    const existing = bestPerMovie.get(key);

    if (!existing || edge.edge > existing.edge) {
      bestPerMovie.set(key, edge);
    }
  }

  return Array.from(bestPerMovie.values());
}
