/**
 * Entertainment Data Source (v4)
 *
 * Fetches movie and entertainment data for Kalshi markets:
 * - Rotten Tomatoes scores (via scraping)
 * - TMDb data (via API)
 * - OMDB data (via API)
 *
 * Migrated from src/fetchers/entertainment.ts
 */

import { defineSource, type Category } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MovieScore {
  title: string;
  year?: number;
  tomatometer?: number;        // Critics score 0-100
  audienceScore?: number;      // Audience score 0-100
  certifiedFresh?: boolean;
  consensus?: string;
  reviewCount?: number;
  url: string;
  fetchedAt: string;
}

export interface EntertainmentData {
  movies: MovieScore[];
  lastUpdated: string;
}

// =============================================================================
// TRACKED MOVIES (for Kalshi entertainment markets)
// =============================================================================

const TRACKED_MOVIES = [
  // 2025/2026 releases commonly on Kalshi
  { slug: 'captain_america_brave_new_world', title: 'Captain America: Brave New World' },
  { slug: 'snow_white_2025', title: 'Snow White' },
  { slug: 'minecraft_movie', title: 'A Minecraft Movie' },
  { slug: 'thunderbolts', title: 'Thunderbolts' },
  { slug: 'lilo_and_stitch_2025', title: 'Lilo & Stitch' },
  { slug: 'mission_impossible_the_final_reckoning', title: 'Mission: Impossible' },
  { slug: 'jurassic_world_rebirth', title: 'Jurassic World Rebirth' },
  { slug: 'superman_2025', title: 'Superman' },
  { slug: 'fantastic_four_first_steps', title: 'Fantastic Four' },
  { slug: 'avatar_fire_and_ash', title: 'Avatar 3' },
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<EntertainmentData>({
  name: 'entertainment',
  category: 'entertainment' as Category,
  cacheTTL: 3600,  // 1 hour cache (scores don't change rapidly)

  async fetch(): Promise<EntertainmentData> {
    const movies: MovieScore[] = [];

    // Fetch scores for tracked movies (with rate limiting)
    for (const movie of TRACKED_MOVIES) {
      const score = await fetchRottenTomatoesScore(movie.slug);
      if (score) {
        movies.push({ ...score, title: movie.title });
      }
      // Small delay to respect rate limits
      await delay(300);
    }

    logger.info(`Fetched ${movies.length} movie scores`);

    return {
      movies,
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRottenTomatoesScore(slug: string): Promise<MovieScore | null> {
  try {
    const url = `https://www.rottentomatoes.com/m/${slug}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.debug(`RT fetch failed for ${slug}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Try JSON-LD first (most reliable)
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(\{[^<]+\})<\/script>/);
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        if (jsonLd.aggregateRating?.ratingValue) {
          return {
            title: jsonLd.name || slug,
            tomatometer: parseInt(jsonLd.aggregateRating.ratingValue, 10),
            reviewCount: jsonLd.aggregateRating.ratingCount,
            url,
            fetchedAt: new Date().toISOString(),
          };
        }
      } catch {
        // JSON parse failed, try regex fallback
      }
    }

    // Fallback: regex patterns
    const tomatometerMatch = html.match(/(?:tomatometerscore|tomatometerScore|ratingValue)["\s:]+(\d+)/i);
    const tomatometer = tomatometerMatch ? parseInt(tomatometerMatch[1], 10) : undefined;

    const audienceMatch = html.match(/(?:audiencescore|audienceScore)["\s:]+(\d+)/i);
    const audienceScore = audienceMatch ? parseInt(audienceMatch[1], 10) : undefined;

    const certifiedFresh = html.includes('certified-fresh') || html.includes('certified_fresh');

    if (tomatometer === undefined) {
      return null;
    }

    return {
      title: slug,
      tomatometer,
      audienceScore,
      certifiedFresh,
      url,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.debug(`RT scrape error for ${slug}: ${error}`);
    return null;
  }
}

// =============================================================================
// TITLE NORMALIZATION
// =============================================================================

const TITLE_TO_SLUG: Record<string, string> = {
  'captain america brave new world': 'captain_america_brave_new_world',
  'captain america': 'captain_america_brave_new_world',
  'snow white': 'snow_white_2025',
  'minecraft': 'minecraft_movie',
  'a minecraft movie': 'minecraft_movie',
  'thunderbolts': 'thunderbolts',
  'lilo and stitch': 'lilo_and_stitch_2025',
  'lilo & stitch': 'lilo_and_stitch_2025',
  'mission impossible': 'mission_impossible_the_final_reckoning',
  'jurassic world': 'jurassic_world_rebirth',
  'superman': 'superman_2025',
  'fantastic four': 'fantastic_four_first_steps',
  'avatar 3': 'avatar_fire_and_ash',
  'avatar fire and ash': 'avatar_fire_and_ash',
};

/**
 * Normalize movie title to RT slug.
 */
export function normalizeMovieTitle(title: string): string {
  const lower = title.toLowerCase().trim();

  // Check known mappings
  if (TITLE_TO_SLUG[lower]) {
    return TITLE_TO_SLUG[lower];
  }

  // Standard normalization
  return lower
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^(the|a|an)_/, '');
}

// =============================================================================
// EXPORTS FOR EDGE ANALYSIS
// =============================================================================

/**
 * Find movie score by title.
 */
export function getMovieScore(
  data: EntertainmentData,
  title: string
): MovieScore | null {
  const slug = normalizeMovieTitle(title);
  return data.movies.find(m =>
    normalizeMovieTitle(m.title) === slug ||
    m.title.toLowerCase().includes(title.toLowerCase())
  ) ?? null;
}

/**
 * Calculate edge for RT score market.
 */
export function calculateRTEdge(
  data: EntertainmentData,
  movieTitle: string,
  threshold: number,
  marketPrice: number
): { edge: number; direction: 'YES' | 'NO'; confidence: number } | null {
  const movie = getMovieScore(data, movieTitle);
  if (!movie || movie.tomatometer === undefined) {
    return null;
  }

  const score = movie.tomatometer;
  const reviewCount = movie.reviewCount ?? 0;

  // Calculate probability of exceeding threshold
  let prob: number;
  if (score >= threshold + 5) {
    prob = 0.90;  // Score well above threshold
  } else if (score >= threshold) {
    prob = 0.75;  // Score at or slightly above
  } else if (score >= threshold - 5) {
    prob = 0.35;  // Score close but below
  } else {
    prob = 0.10;  // Score well below threshold
  }

  // Adjust confidence based on review count
  const confidence = reviewCount > 100 ? 0.85 :
    reviewCount > 50 ? 0.70 :
      reviewCount > 20 ? 0.55 : 0.40;

  // Determine direction and edge
  if (prob > marketPrice) {
    return {
      edge: prob - marketPrice,
      direction: 'YES',
      confidence,
    };
  } else if (prob < marketPrice) {
    return {
      edge: marketPrice - prob,
      direction: 'NO',
      confidence,
    };
  }

  return null;
}

/**
 * Extract movie info from Kalshi market title.
 */
export function extractMovieFromMarketTitle(marketTitle: string): {
  movieTitle: string;
  threshold?: number;
} | null {
  // Pattern: "Movie Name Rotten Tomatoes score? Above X"
  const pattern = /["']?([^"']+?)["']?\s+rotten\s+tomatoes\s+score\??\s+above\s+(\d+)/i;
  const match = marketTitle.toLowerCase().match(pattern);

  if (match) {
    return {
      movieTitle: match[1].trim(),
      threshold: parseInt(match[2], 10),
    };
  }

  // Simple pattern: just look for RT mention
  const simplePattern = /["']?([^"']+?)["']?\s+rotten\s+tomatoes/i;
  const simpleMatch = marketTitle.toLowerCase().match(simplePattern);

  if (simpleMatch) {
    return { movieTitle: simpleMatch[1].trim() };
  }

  return null;
}
