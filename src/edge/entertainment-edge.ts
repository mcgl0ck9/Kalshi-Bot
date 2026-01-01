/**
 * Entertainment Edge Detection
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
 * - Market: "Will Primate RT score be above 85%?" trading at 75¢
 * - Edge: Score is already above 85%, near-certain YES
 * - Only risk: Score drops below 85% before market closes (rare for established films)
 */

import { logger } from '../utils/index.js';
import type { Market } from '../types/index.js';
import {
  fetchMovieScoreResilient,
  fetchComprehensiveMovieData,
  extractMovieFromMarketTitle,
  normalizeMovieTitle,
  type ResilientMovieScore,
  type ComprehensiveMovieData,
} from '../fetchers/entertainment.js';

// =============================================================================
// TYPES
// =============================================================================

export interface EntertainmentEdge {
  market: Market;
  edgeType: 'rotten_tomatoes' | 'box_office' | 'awards';
  movieTitle: string;

  // For RT markets
  threshold?: number;
  currentScore?: number;
  scoreType?: 'tomatometer' | 'audience';
  reviewCount?: number;

  // Edge calculation
  impliedProbability: number;  // What the score implies (0-1)
  marketPrice: number;         // Current market price (0-1)
  edge: number;                // impliedProbability - marketPrice
  direction: 'buy_yes' | 'buy_no';
  confidence: number;

  // Context
  movieData?: ComprehensiveMovieData;
  reason: string;
  caveats: string[];
}

export interface EntertainmentMarketMatch {
  market: Market;
  type: 'rotten_tomatoes' | 'box_office' | 'awards' | 'streaming' | 'unknown';
  movieTitle?: string;
  threshold?: number;
  scoreType?: 'tomatometer' | 'audience';
}

// =============================================================================
// MARKET IDENTIFICATION
// =============================================================================

/**
 * Patterns for identifying entertainment market types
 */
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
  streaming: [
    /netflix/i,
    /disney\+/i,
    /streaming/i,
    /viewership/i,
    /subscribers/i,
  ],
};

/**
 * Check if a market is an entertainment market
 */
export function isEntertainmentMarket(market: Market): boolean {
  const text = `${market.title} ${market.description ?? ''}`.toLowerCase();

  for (const patterns of Object.values(ENTERTAINMENT_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return true;
    }
  }

  return false;
}

/**
 * Classify and extract info from entertainment market
 */
export function classifyEntertainmentMarket(market: Market): EntertainmentMarketMatch | null {
  const text = `${market.title} ${market.description ?? ''}`;
  const lower = text.toLowerCase();

  // Check Rotten Tomatoes
  if (ENTERTAINMENT_PATTERNS.rottenTomatoes.some(p => p.test(lower))) {
    const extracted = extractMovieFromMarketTitle(market.title);

    return {
      market,
      type: 'rotten_tomatoes',
      movieTitle: extracted?.movieTitle,
      threshold: extracted?.threshold,
      scoreType: extracted?.scoreType ?? 'tomatometer',
    };
  }

  // Check Box Office
  if (ENTERTAINMENT_PATTERNS.boxOffice.some(p => p.test(lower))) {
    // Extract movie title and threshold from box office markets
    const boMatch = lower.match(/(?:will\s+)?["']?([^"']+?)["']?\s+(?:earn|gross|make|hit)\s+(?:over|above|more than)?\s*\$?([\d.]+)\s*(?:m|million)/i);

    return {
      market,
      type: 'box_office',
      movieTitle: boMatch?.[1]?.trim(),
      threshold: boMatch ? parseFloat(boMatch[2]) * 1_000_000 : undefined,
    };
  }

  // Check Awards
  if (ENTERTAINMENT_PATTERNS.awards.some(p => p.test(lower))) {
    return {
      market,
      type: 'awards',
    };
  }

  // Check Streaming
  if (ENTERTAINMENT_PATTERNS.streaming.some(p => p.test(lower))) {
    return {
      market,
      type: 'streaming',
    };
  }

  return null;
}

// =============================================================================
// RT EDGE CALCULATION
// =============================================================================

/**
 * Calculate implied probability that RT score stays above threshold
 *
 * Key insight: RT scores generally DECLINE over time as more reviews come in
 * (early reviews often from enthusiasts, later reviews from general critics)
 *
 * Factors:
 * - Current score vs threshold (buffer room)
 * - Number of reviews (more reviews = more stable)
 * - How far above/below threshold
 */
function calculateRTImpliedProbability(
  currentScore: number,
  threshold: number,
  reviewCount?: number
): { probability: number; confidence: number; reasoning: string } {
  const buffer = currentScore - threshold;
  const reviews = reviewCount ?? 50;  // Default assumption

  // Score is BELOW threshold
  if (buffer < 0) {
    // Very unlikely to rise unless very few reviews
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
  if (buffer >= 0) {
    // Base probability starts high
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

  return { probability: 0.5, confidence: 0.3, reasoning: 'Unknown' };
}

// =============================================================================
// MAIN EDGE DETECTION
// =============================================================================

/**
 * Detect entertainment edges from Kalshi markets
 */
export async function detectEntertainmentEdges(
  markets: Market[]
): Promise<EntertainmentEdge[]> {
  const edges: EntertainmentEdge[] = [];

  // Find entertainment markets
  const entertainmentMarkets = markets.filter(isEntertainmentMarket);

  if (entertainmentMarkets.length === 0) {
    logger.debug('No entertainment markets found');
    return edges;
  }

  logger.info(`Found ${entertainmentMarkets.length} entertainment markets`);

  // Debug: log the entertainment market titles
  for (const m of entertainmentMarkets) {
    logger.info(`  📽️ Entertainment market: ${m.title} (price: ${(m.price * 100).toFixed(0)}¢)`);
  }

  // Process each market
  for (const market of entertainmentMarkets) {
    try {
      const classified = classifyEntertainmentMarket(market);

      if (!classified) continue;

      // Handle RT markets
      if (classified.type === 'rotten_tomatoes' && classified.movieTitle) {
        const edge = await analyzeRTMarket(market, classified);
        if (edge) {
          edges.push(edge);
        }
      }

      // Handle Box Office markets
      if (classified.type === 'box_office' && classified.movieTitle) {
        const edge = await analyzeBoxOfficeMarket(market, classified);
        if (edge) {
          edges.push(edge);
        }
      }

      // Add small delay to respect rate limits
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      logger.debug(`Error analyzing market ${market.id}: ${error}`);
    }
  }

  // Sort by edge size
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  logger.info(`Found ${edges.length} entertainment edges`);
  return edges;
}

/**
 * Analyze a Rotten Tomatoes market
 */
async function analyzeRTMarket(
  market: Market,
  classified: EntertainmentMarketMatch
): Promise<EntertainmentEdge | null> {
  logger.info(`  Analyzing RT market: ${market.title}`);
  logger.info(`    Movie: "${classified.movieTitle}", Threshold: ${classified.threshold}%`);

  if (!classified.movieTitle || classified.threshold === undefined) {
    logger.info(`    ❌ Missing title or threshold`);
    return null;
  }

  // Fetch current RT score
  logger.info(`    Fetching RT score for "${classified.movieTitle}"...`);
  const movieData = await fetchComprehensiveMovieData(classified.movieTitle);

  if (!movieData) {
    logger.info(`    ❌ Could not fetch movie data`);
    return null;
  }

  // Get the relevant score
  const score = classified.scoreType === 'audience'
    ? movieData.audienceScore
    : movieData.rottenTomatoes;

  if (score === undefined) {
    // Check if movie exists but just doesn't have scores yet (unreleased)
    const hasAnyData = movieData.sources.length > 0 || movieData.tmdbRating !== undefined;
    if (hasAnyData) {
      logger.info(`    ⏳ Movie found but no RT score yet (unreleased or too new)`);
    } else {
      logger.info(`    ❌ Movie not found in any database`);
    }
    return null;
  }

  logger.info(`    ✓ Got score: ${score}% from ${movieData.sources.join(', ')}`);
  if (movieData.reviewCount) {
    logger.info(`    📊 ${movieData.reviewCount} reviews`);
  }

  // Calculate implied probability (include review count for stability assessment)
  const { probability, confidence, reasoning } = calculateRTImpliedProbability(
    score,
    classified.threshold,
    movieData.reviewCount
  );

  // Get market price
  const marketPrice = market.price;

  // Calculate edge
  const edge = probability - marketPrice;

  // Only surface significant edges (lowered from 3% to 1%)
  if (Math.abs(edge) < 0.01) {
    logger.debug(`Edge too small for ${classified.movieTitle}: ${(edge * 100).toFixed(1)}%`);
    return null;
  }

  // Determine caveats
  const caveats: string[] = [];

  if (score - classified.threshold <= 3) {
    caveats.push('Score is close to threshold - could drop');
  }

  if (movieData.sources.length === 1 && movieData.sources[0] === 'tmdb') {
    caveats.push('RT score estimated from TMDb - may be inaccurate');
  }

  return {
    market,
    edgeType: 'rotten_tomatoes',
    movieTitle: classified.movieTitle,
    threshold: classified.threshold,
    currentScore: score,
    scoreType: classified.scoreType,
    reviewCount: movieData.reviewCount,
    impliedProbability: probability,
    marketPrice,
    edge: Math.abs(edge),
    direction: edge > 0 ? 'buy_yes' : 'buy_no',
    confidence,
    movieData,
    reason: reasoning,
    caveats,
  };
}

/**
 * Analyze a Box Office market
 */
async function analyzeBoxOfficeMarket(
  market: Market,
  classified: EntertainmentMarketMatch
): Promise<EntertainmentEdge | null> {
  if (!classified.movieTitle) {
    return null;
  }

  // Fetch movie data including box office
  const movieData = await fetchComprehensiveMovieData(classified.movieTitle);

  if (!movieData) {
    return null;
  }

  // Box office edge calculation is more complex
  // Would need current box office tracking data
  // For now, return null - can enhance later

  return null;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format entertainment edge for Discord alert
 */
export function formatEntertainmentEdge(edge: EntertainmentEdge): string {
  const actionIcon = edge.direction === 'buy_yes' ? '🟢' : '🔴';
  const action = edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO';

  const lines: string[] = [
    `🎬 **ENTERTAINMENT EDGE DETECTED**`,
    '',
    `**${edge.market.title}**`,
    '',
    '```',
    `${actionIcon} ${action} @ ${(edge.marketPrice * 100).toFixed(0)}¢`,
    '```',
    '',
  ];

  if (edge.edgeType === 'rotten_tomatoes') {
    const scoreIcon = edge.currentScore && edge.currentScore >= 60 ? '🍅' : '🤢';
    lines.push(`${scoreIcon} **Current RT Score:** ${edge.currentScore}%`);
    lines.push(`🎯 **Threshold:** ${edge.threshold}%`);
    lines.push(`📊 **Buffer:** ${edge.currentScore! - edge.threshold!} points`);
  }

  lines.push('');
  lines.push(`📈 **Edge:** +${(edge.edge * 100).toFixed(1)}%`);
  lines.push(`🎯 **Implied Probability:** ${(edge.impliedProbability * 100).toFixed(0)}%`);
  lines.push(`💰 **Market Price:** ${(edge.marketPrice * 100).toFixed(0)}¢`);
  lines.push(`🔒 **Confidence:** ${(edge.confidence * 100).toFixed(0)}%`);

  lines.push('');
  lines.push(`**Why this edge exists:**`);
  lines.push(`• ${edge.reason}`);

  if (edge.caveats.length > 0) {
    lines.push('');
    lines.push(`**⚠️ Caveats:**`);
    for (const caveat of edge.caveats) {
      lines.push(`• ${caveat}`);
    }
  }

  if (edge.movieData) {
    lines.push('');
    lines.push(`_Sources: ${edge.movieData.sources.join(', ')}_`);
  }

  if (edge.market.url) {
    lines.push('');
    lines.push(`[>>> TRADE NOW <<<](${edge.market.url})`);
  }

  return lines.join('\n');
}

/**
 * Quick check for obvious RT edges
 * Use this for rapid scanning before full analysis
 */
export function quickCheckRTEdge(
  movieTitle: string,
  currentScore: number,
  threshold: number,
  marketPrice: number
): { hasEdge: boolean; direction: 'yes' | 'no'; edgeSize: number } {
  const buffer = currentScore - threshold;

  // Score is significantly above threshold (7+ points)
  if (buffer >= 7 && marketPrice < 0.85) {
    return {
      hasEdge: true,
      direction: 'yes',
      edgeSize: 0.95 - marketPrice,  // Should be ~95% YES
    };
  }

  // Score is significantly below threshold
  if (buffer <= -7 && marketPrice > 0.15) {
    return {
      hasEdge: true,
      direction: 'no',
      edgeSize: marketPrice - 0.05,  // Should be ~5% YES (95% NO)
    };
  }

  return { hasEdge: false, direction: 'yes', edgeSize: 0 };
}

// =============================================================================
// PRIMATE EXAMPLE (for testing)
// =============================================================================

/**
 * Example: Analyze "Primate" RT market
 * Current score: 92%
 * Market: "Will Primate RT score be above 85%?"
 *
 * Expected result:
 * - Buffer: 92 - 85 = 7 points
 * - Implied probability: ~95%+ (score is well above threshold)
 * - If market is at 75¢, edge is +20%
 */
export async function examplePrimateAnalysis(): Promise<void> {
  const mockMarket: Market = {
    id: 'example',
    platform: 'kalshi',
    title: 'Will "Primate" have a Rotten Tomatoes score above 85%?',
    price: 0.75,
    volume: 10000,
    url: 'https://kalshi.com/example',
    category: 'entertainment',
  };

  const classified = classifyEntertainmentMarket(mockMarket);
  console.log('Classified:', classified);

  if (classified?.type === 'rotten_tomatoes') {
    // Simulate: current score is 92%
    const { probability, confidence, reasoning } = calculateRTImpliedProbability(92, 85, 150);

    console.log('\n=== PRIMATE ANALYSIS ===');
    console.log(`Current RT Score: 92%`);
    console.log(`Threshold: 85%`);
    console.log(`Buffer: 7 points`);
    console.log(`Implied Probability: ${(probability * 100).toFixed(1)}%`);
    console.log(`Market Price: 75¢`);
    console.log(`EDGE: +${((probability - 0.75) * 100).toFixed(1)}%`);
    console.log(`Reasoning: ${reasoning}`);
    console.log(`Confidence: ${(confidence * 100).toFixed(0)}%`);
    console.log('========================\n');
  }
}
