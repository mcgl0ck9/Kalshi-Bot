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
} from '../fetchers/_legacy/entertainment.js';

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

      // Handle Awards markets
      if (classified.type === 'awards') {
        const edge = await analyzeAwardsMarket(market, classified);
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

  // Deduplicate: only keep best edge per movie
  const bestPerMovie = new Map<string, EntertainmentEdge>();
  for (const edge of edges) {
    const key = normalizeMovieTitle(edge.movieTitle);
    const existing = bestPerMovie.get(key);
    if (!existing || edge.edge > existing.edge) {
      bestPerMovie.set(key, edge);
    }
  }

  const dedupedEdges = Array.from(bestPerMovie.values());
  logger.info(`Found ${dedupedEdges.length} entertainment edges (deduplicated from ${edges.length})`);
  return dedupedEdges;
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
  if (!classified.movieTitle || !classified.threshold) {
    return null;
  }

  const threshold = classified.threshold;

  try {
    // Fetch current box office data
    const { fetchWeekendBoxOffice, fetchMovieBoxOffice, normalizeMovieTitle } = await import('../fetchers/_legacy/entertainment.js');

    // First check weekend box office for the movie
    const weekendData = await fetchWeekendBoxOffice();
    const normalizedTitle = normalizeMovieTitle(classified.movieTitle);

    // Find the movie in weekend data
    const movieEntry = weekendData.find(m =>
      normalizeMovieTitle(m.title) === normalizedTitle
    );

    let currentGross = 0;
    let projectedFinal = 0;
    let weekendNumber = 0;

    if (movieEntry && movieEntry.weekendGross) {
      currentGross = movieEntry.totalGross ?? movieEntry.weekendGross;
      weekendNumber = 1; // Assume opening weekend if we found it in weekend charts

      // Project final gross using typical multipliers
      // Opening weekend typically represents 30-35% of final domestic gross
      // Second weekend ~15%, third ~8%, etc.
      if (!movieEntry.totalGross || movieEntry.totalGross === movieEntry.weekendGross) {
        // This is opening weekend - project final
        // Use conservative multiplier (2.5-3x opening for typical films)
        projectedFinal = movieEntry.weekendGross * 2.8;
      } else {
        // Has been running - use current trajectory
        // Simple model: final = current + (current * (1 / weeks_running))
        projectedFinal = currentGross * 1.3; // Assume 30% more to come
      }
    } else {
      // Try to fetch specific movie data
      const movieData = await fetchComprehensiveMovieData(classified.movieTitle);
      if (movieData?.boxOffice) {
        currentGross = movieData.boxOffice;
        projectedFinal = currentGross * 1.1; // Near end of run
      } else {
        // No data available
        return null;
      }
    }

    // Calculate probability of hitting threshold
    let probability: number;

    if (currentGross >= threshold) {
      // Already exceeded threshold
      probability = 0.99;
    } else if (projectedFinal >= threshold * 1.1) {
      // Projected to clearly exceed
      probability = 0.85;
    } else if (projectedFinal >= threshold) {
      // Projected to just barely exceed
      probability = 0.65;
    } else if (projectedFinal >= threshold * 0.9) {
      // Close but unlikely
      probability = 0.35;
    } else if (projectedFinal >= threshold * 0.7) {
      // Very unlikely
      probability = 0.15;
    } else {
      // Won't happen
      probability = 0.05;
    }

    const marketPrice = market.price ?? 0.5;
    const edge = probability - marketPrice;

    // Only surface significant edges
    if (Math.abs(edge) < 0.08) {
      return null;
    }

    const direction: 'buy_yes' | 'buy_no' = edge > 0 ? 'buy_yes' : 'buy_no';

    // Generate caveats
    const caveats: string[] = [];
    if (weekendNumber <= 1) {
      caveats.push('Projection based on early data');
    }
    if (Math.abs(projectedFinal - threshold) < threshold * 0.2) {
      caveats.push('Close to threshold - higher uncertainty');
    }

    return {
      market,
      edgeType: 'box_office',
      movieTitle: classified.movieTitle,
      edge: Math.abs(edge),
      direction,
      confidence: Math.min(0.85, 0.5 + Math.abs(edge)),
      impliedProbability: probability,
      marketPrice,
      reason: `${classified.movieTitle}: Current $${(currentGross / 1_000_000).toFixed(1)}M, projected $${(projectedFinal / 1_000_000).toFixed(1)}M vs threshold $${(threshold / 1_000_000).toFixed(0)}M`,
      caveats,
      movieData: {
        title: classified.movieTitle,
        sources: ['box_office_mojo'],
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.debug(`Box office analysis failed for ${classified.movieTitle}: ${error}`);
    return null;
  }
}

/**
 * Analyze an Awards market (Oscars, Emmys, Grammys, etc.)
 *
 * Uses precursor awards and historical patterns to predict winners.
 *
 * KEY INSIGHT: Precursor awards are highly predictive:
 * - Golden Globes Drama winner → 60% chance of Oscar
 * - SAG Ensemble → 70% chance of Best Picture
 * - DGA Winner → 80% chance of Best Director
 * - PGA Winner → 75% chance of Best Picture
 */
async function analyzeAwardsMarket(
  market: Market,
  classified: EntertainmentMarketMatch
): Promise<EntertainmentEdge | null> {
  const title = (market.title ?? '').toLowerCase();

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
  const isGoldenGlobe = title.includes('golden globe');

  // Base probabilities for different scenarios
  // These would ideally be fetched from award prediction sites
  let baseProbability = 0.20; // Default: assume 5 nominees = 20% base

  // Adjust based on award type and category
  if (isOscar) {
    // Oscar prediction model
    // Major categories have more predictable patterns

    if (categoryName.includes('picture')) {
      // Best Picture: Check for precursor wins
      // PGA, DGA, SAG Ensemble are key predictors
      baseProbability = 0.20; // 5 nominees base

      // Could fetch precursor data here in production
      // For now, use market price as a signal and look for deviations
    } else if (categoryName.includes('actor') || categoryName.includes('actress')) {
      // Acting categories: SAG Individual is 80%+ predictive
      baseProbability = 0.20;
    } else if (categoryName.includes('director')) {
      // Director: DGA is 85%+ predictive
      baseProbability = 0.20;
    }
  } else if (isEmmy) {
    // Emmy categories often have clear frontrunners
    baseProbability = 0.17; // Typically 6 nominees
  } else if (isGrammy) {
    // Grammy categories are less predictable
    baseProbability = 0.20;
  }

  // Try to get additional data about the nominee (movie/show)
  try {
    const movieData = await fetchComprehensiveMovieData(nomineeName);

    if (movieData) {
      // Adjust probability based on movie quality metrics
      // Higher RT/Metacritic scores correlate with awards wins

      if (movieData.rottenTomatoes && movieData.rottenTomatoes >= 90) {
        baseProbability *= 1.3; // 30% boost for excellent reviews
      } else if (movieData.rottenTomatoes && movieData.rottenTomatoes >= 80) {
        baseProbability *= 1.15;
      }

      if (movieData.metacritic && movieData.metacritic >= 85) {
        baseProbability *= 1.25; // Metacritic highly predictive
      } else if (movieData.metacritic && movieData.metacritic >= 75) {
        baseProbability *= 1.1;
      }

      // Awards mentions in OMDB data
      if (movieData.awards) {
        const awardsLower = movieData.awards.toLowerCase();
        if (awardsLower.includes('won') && (awardsLower.includes('oscar') || awardsLower.includes('academy'))) {
          baseProbability *= 1.5; // Already won major award
        } else if (awardsLower.includes('nominated') && awardsLower.includes('oscar')) {
          baseProbability *= 1.2;
        }
        if (awardsLower.includes('golden globe') && awardsLower.includes('won')) {
          baseProbability *= 1.3;
        }
      }
    }
  } catch {
    // No movie data available, use base probability
  }

  // Cap probability at 95%
  baseProbability = Math.min(0.95, baseProbability);

  const marketPrice = market.price ?? 0.5;
  const edge = baseProbability - marketPrice;

  // Only surface significant edges (8%+)
  if (Math.abs(edge) < 0.08) {
    return null;
  }

  const direction: 'buy_yes' | 'buy_no' = edge > 0 ? 'buy_yes' : 'buy_no';

  // Generate caveats
  const caveats: string[] = [];
  if (isOscar) {
    caveats.push('Oscar voting is unpredictable');
  }
  if (baseProbability < 0.3) {
    caveats.push('Low base probability - high risk');
  }

  return {
    market,
    edgeType: 'awards',
    movieTitle: nomineeName,
    edge: Math.abs(edge),
    direction,
    confidence: Math.min(0.75, 0.4 + Math.abs(edge)),
    impliedProbability: baseProbability,
    marketPrice,
    reason: `${nomineeName} for ${categoryName}: Model suggests ${(baseProbability * 100).toFixed(0)}% vs market ${(marketPrice * 100).toFixed(0)}%`,
    caveats,
    movieData: {
      title: nomineeName,
      sources: ['model_prediction'],
      fetchedAt: new Date().toISOString(),
    },
  };
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
