/**
 * Entertainment Data Fetcher
 *
 * Fetches data relevant to Kalshi entertainment markets:
 * - Rotten Tomatoes scores (Tomatometer + Audience Score)
 * - Box Office data (opening weekend, total gross)
 * - Upcoming releases
 *
 * IMPROVED (v2):
 * - TMDb API for reliable movie metadata
 * - OMDB API as fallback for RT scores
 * - Resilient fetch pattern with caching
 */

import { logger, delay } from '../utils/index.js';
import { fetchWithFallback, createSource } from '../utils/resilient-fetch.js';
import * as tmdb from './tmdb.js';
import * as omdb from './omdb.js';

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
  reviewCount?: number;        // Number of critic reviews
  url: string;
  fetchedAt: string;
}

export interface BoxOfficeData {
  title: string;
  weekendGross?: number;       // Weekend gross in dollars
  totalGross?: number;         // Total domestic gross
  weekendRank?: number;
  weeksInRelease?: number;
  openingWeekend?: number;
  url?: string;
  fetchedAt: string;
}

export interface UpcomingRelease {
  title: string;
  releaseDate: string;
  distributor?: string;
  anticipation?: 'high' | 'medium' | 'low';
}

// =============================================================================
// ROTTEN TOMATOES SCRAPER
// =============================================================================

/**
 * Fetch Rotten Tomatoes score for a movie
 * Note: This scrapes the public page - respect rate limits
 */
export async function fetchRottenTomatoesScore(movieSlug: string): Promise<MovieScore | null> {
  const result = await fetchRTPage(movieSlug);
  if (result) return result;

  return null;
}

/**
 * Fetch RT score with multiple slug variations
 * Tries: base slug, slug_year (2024-2026), and search fallback
 */
export async function fetchRottenTomatoesScoreWithVariations(
  title: string,
  year?: number
): Promise<MovieScore | null> {
  const baseSlug = normalizeMovieTitle(title);

  // Try exact slug first
  let result = await fetchRTPage(baseSlug);
  if (result && result.tomatometer !== undefined) return result;

  // Try with year suffixes (common RT pattern)
  const yearsToTry = year
    ? [year, year - 1, year + 1]
    : [2025, 2026, 2024];  // Default to recent years

  for (const y of yearsToTry) {
    const slugWithYear = `${baseSlug}_${y}`;
    result = await fetchRTPage(slugWithYear);
    if (result && result.tomatometer !== undefined) {
      logger.info(`Found RT score for "${title}" at slug: ${slugWithYear}`);
      return result;
    }
    await delay(200);  // Small delay between attempts
  }

  // Fallback: search RT and scrape first result
  const searchResults = await searchRottenTomatoes(title);
  if (searchResults.length > 0) {
    // Extract slug from URL
    const firstResult = searchResults[0];
    const slugMatch = firstResult.url.match(/\/m\/([^/]+)/);
    if (slugMatch) {
      result = await fetchRTPage(slugMatch[1]);
      if (result && result.tomatometer !== undefined) {
        logger.info(`Found RT score for "${title}" via search: ${slugMatch[1]}`);
        return result;
      }
    }
  }

  logger.debug(`Could not find RT score for "${title}" with any slug variation`);
  return null;
}

/**
 * Internal function to fetch and parse a single RT page
 */
async function fetchRTPage(slug: string): Promise<MovieScore | null> {
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
          const tomatometer = parseInt(jsonLd.aggregateRating.ratingValue, 10);
          return {
            title: jsonLd.name || slug,
            tomatometer,
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

    // Extract Audience Score
    const audienceMatch = html.match(/(?:audiencescore|audienceScore)["\s:]+(\d+)/i);
    const audienceScore = audienceMatch ? parseInt(audienceMatch[1], 10) : undefined;

    // Extract title
    const titleMatch = html.match(/<h1[^>]*slot="titleIntro"[^>]*>([^<]+)</i) ||
                       html.match(/<title>([^|<]+)/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/ - Rotten Tomatoes$/, '') : slug;

    // Check for Certified Fresh
    const certifiedFresh = html.includes('certified-fresh') || html.includes('certified_fresh');

    // Extract consensus
    const consensusMatch = html.match(/data-qa="critics-consensus">([^<]+)</i);
    const consensus = consensusMatch ? consensusMatch[1].trim() : undefined;

    // Extract review count
    const reviewCountMatch = html.match(/ratingCount["\s:]+(\d+)/i);
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1], 10) : undefined;

    if (tomatometer === undefined) {
      return null;
    }

    return {
      title,
      tomatometer,
      audienceScore,
      certifiedFresh,
      consensus,
      url,
      fetchedAt: new Date().toISOString(),
      reviewCount,
    };
  } catch (error) {
    logger.error(`RT scrape error for ${slug}: ${error}`);
    return null;
  }
}

/**
 * Search Rotten Tomatoes for a movie
 */
export async function searchRottenTomatoes(query: string): Promise<MovieScore[]> {
  try {
    const searchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const results: MovieScore[] = [];

    // Extract search results - look for movie links
    const movieLinkPattern = /href="\/m\/([^"]+)"[^>]*>([^<]+)</gi;
    let match;

    while ((match = movieLinkPattern.exec(html)) !== null && results.length < 5) {
      const slug = match[1];
      const title = match[2].trim();

      if (slug && title && !slug.includes('/')) {
        results.push({
          title,
          url: `https://www.rottentomatoes.com/m/${slug}`,
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  } catch (error) {
    logger.error(`RT search error: ${error}`);
    return [];
  }
}

/**
 * Fetch scores for multiple movies
 */
export async function fetchMultipleMovieScores(
  movieSlugs: string[],
  delayMs: number = 1000
): Promise<Map<string, MovieScore>> {
  const results = new Map<string, MovieScore>();

  for (const slug of movieSlugs) {
    const score = await fetchRottenTomatoesScore(slug);
    if (score) {
      results.set(slug, score);
    }
    await delay(delayMs); // Respect rate limits
  }

  logger.info(`Fetched RT scores for ${results.size}/${movieSlugs.length} movies`);
  return results;
}

// =============================================================================
// BOX OFFICE DATA
// =============================================================================

/**
 * Fetch current weekend box office from Box Office Mojo
 * Note: Scrapes the public page
 */
export async function fetchWeekendBoxOffice(): Promise<BoxOfficeData[]> {
  try {
    const url = 'https://www.boxofficemojo.com/weekend/chart/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`Box Office Mojo fetch failed: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const results: BoxOfficeData[] = [];

    // Parse the table rows - look for movie data
    // Box Office Mojo uses a table structure
    const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*>\$?([\d,]+)/gi;

    let match;
    while ((match = rowPattern.exec(html)) !== null && results.length < 20) {
      const rank = parseInt(match[1], 10);
      const url = match[2];
      const title = match[3].trim();
      const grossStr = match[4].replace(/,/g, '');
      const weekendGross = parseInt(grossStr, 10);

      if (title && !isNaN(weekendGross)) {
        results.push({
          title,
          weekendRank: rank,
          weekendGross,
          url: url.startsWith('http') ? url : `https://www.boxofficemojo.com${url}`,
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    // Fallback: try simpler pattern if complex one fails
    if (results.length === 0) {
      const simplePattern = /<a[^>]*href="\/release\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((match = simplePattern.exec(html)) !== null && results.length < 20) {
        const slug = match[1];
        const title = match[2].trim();

        if (title && title.length > 2 && !title.includes('...')) {
          results.push({
            title,
            url: `https://www.boxofficemojo.com/release/${slug}`,
            fetchedAt: new Date().toISOString(),
          });
        }
      }
    }

    logger.info(`Fetched ${results.length} box office entries`);
    return results;
  } catch (error) {
    logger.error(`Box Office fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch box office data for a specific movie
 */
export async function fetchMovieBoxOffice(movieSlug: string): Promise<BoxOfficeData | null> {
  try {
    const url = `https://www.boxofficemojo.com/release/${movieSlug}/`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : movieSlug;

    // Extract gross numbers
    const domesticMatch = html.match(/Domestic[^$]*\$?([\d,]+)/i);
    const openingMatch = html.match(/Opening[^$]*\$?([\d,]+)/i);
    const weeksMatch = html.match(/Weeks[^>]*>(\d+)/i);

    const totalGross = domesticMatch
      ? parseInt(domesticMatch[1].replace(/,/g, ''), 10)
      : undefined;

    const openingWeekend = openingMatch
      ? parseInt(openingMatch[1].replace(/,/g, ''), 10)
      : undefined;

    const weeksInRelease = weeksMatch
      ? parseInt(weeksMatch[1], 10)
      : undefined;

    return {
      title,
      totalGross,
      openingWeekend,
      weeksInRelease,
      url,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Movie box office fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// KALSHI MARKET MATCHING
// =============================================================================

/**
 * Common movie title variations for matching Kalshi markets
 * Maps Kalshi market titles to RT slugs
 */
const TITLE_NORMALIZATIONS: Record<string, string> = {
  // Sequels with numbers
  'sonic 3': 'sonic_the_hedgehog_3',
  'sonic the hedgehog 3': 'sonic_the_hedgehog_3',
  'downton abbey 3': 'downton_abbey_a_new_era',  // May need update when title known
  'mufasa': 'mufasa_the_lion_king',
  'mufasa the lion king': 'mufasa_the_lion_king',

  // Movies with subtitles or special characters
  'soulm8te': 'soulm8te_2025',  // AI movie with number in title
  'soul m8te': 'soulm8te_2025',

  // Common title variations
  'primate': 'primate_2025',
  'the amateur': 'the_amateur_2025',
  'send help': 'send_help',
  'running man': 'the_running_man',
  'the running man': 'the_running_man_2025',

  // Franchise movies
  'captain america brave new world': 'captain_america_brave_new_world',
  'mission impossible 8': 'mission_impossible_dead_reckoning_part_two',

  // Awards season movies
  'conclave': 'conclave',
  'anora': 'anora',
  'wicked': 'wicked_2024',
  'gladiator 2': 'gladiator_ii',
  'gladiator ii': 'gladiator_ii',
};

/**
 * Normalize a movie title for matching
 * First checks the correction map, then falls back to standard normalization
 */
export function normalizeMovieTitle(title: string): string {
  const lower = title.toLowerCase().trim();

  // Check if we have a known correction
  if (TITLE_NORMALIZATIONS[lower]) {
    return TITLE_NORMALIZATIONS[lower];
  }

  // Standard normalization
  return lower
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^(the|a|an)_/, '')
    .trim();
}

/**
 * Try to match a Kalshi market title to a movie
 */
export function extractMovieFromMarketTitle(marketTitle: string): {
  movieTitle: string;
  scoreType?: 'tomatometer' | 'audience';
  threshold?: number;
} | null {
  const lower = marketTitle.toLowerCase();

  // Pattern 1: "Will X have a Rotten Tomatoes score above Y%?"
  const rtPattern = /(?:will\s+)?["']?([^"']+?)["']?\s+(?:have\s+)?(?:a\s+)?(?:rotten\s+tomatoes|rt)\s+(?:score\s+)?(?:above|over|at least|greater than)\s+(\d+)/i;

  const match = lower.match(rtPattern);
  if (match) {
    return {
      movieTitle: match[1].trim(),
      scoreType: lower.includes('audience') ? 'audience' : 'tomatometer',
      threshold: parseInt(match[2], 10),
    };
  }

  // Pattern 2: "X Rotten Tomatoes score? Above Y" (Kalshi format)
  // e.g., "Primate Rotten Tomatoes score? Above 85"
  const kalshiPattern = /["']?([^"']+?)["']?\s+rotten\s+tomatoes\s+score\??\s+above\s+(\d+)/i;
  const kalshiMatch = lower.match(kalshiPattern);
  if (kalshiMatch) {
    return {
      movieTitle: kalshiMatch[1].trim(),
      scoreType: lower.includes('audience') ? 'audience' : 'tomatometer',
      threshold: parseInt(kalshiMatch[2], 10),
    };
  }

  // Pattern 3: "X Rotten Tomatoes score" (no threshold, for general matching)
  const simplePattern = /["']?([^"']+?)["']?\s+rotten\s+tomatoes/i;
  const simpleMatch = lower.match(simplePattern);
  if (simpleMatch) {
    return {
      movieTitle: simpleMatch[1].trim(),
    };
  }

  return null;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format movie score for display
 */
export function formatMovieScore(score: MovieScore): string {
  const lines: string[] = [`**${score.title}**`];

  if (score.tomatometer !== undefined) {
    const freshIcon = score.tomatometer >= 60 ? '🍅' : '🤢';
    const certifiedIcon = score.certifiedFresh ? '✓' : '';
    lines.push(`${freshIcon} Tomatometer: ${score.tomatometer}% ${certifiedIcon}`);
  }

  if (score.audienceScore !== undefined) {
    const audienceIcon = score.audienceScore >= 60 ? '🍿' : '👎';
    lines.push(`${audienceIcon} Audience: ${score.audienceScore}%`);
  }

  if (score.consensus) {
    lines.push(`> ${score.consensus.slice(0, 100)}...`);
  }

  lines.push(`[View on RT](${score.url})`);

  return lines.join('\n');
}

/**
 * Format box office data for display
 */
export function formatBoxOffice(data: BoxOfficeData): string {
  const lines: string[] = [];

  if (data.weekendRank) {
    lines.push(`#${data.weekendRank}`);
  }

  lines.push(`**${data.title}**`);

  if (data.weekendGross) {
    lines.push(`Weekend: $${(data.weekendGross / 1_000_000).toFixed(1)}M`);
  }

  if (data.totalGross) {
    lines.push(`Total: $${(data.totalGross / 1_000_000).toFixed(1)}M`);
  }

  if (data.openingWeekend) {
    lines.push(`Opening: $${(data.openingWeekend / 1_000_000).toFixed(1)}M`);
  }

  return lines.join(' | ');
}

/**
 * Format weekend box office report
 */
export function formatWeekendBoxOfficeReport(data: BoxOfficeData[]): string {
  if (data.length === 0) {
    return 'No box office data available.';
  }

  const lines: string[] = ['**🎬 Weekend Box Office**\n'];

  for (const movie of data.slice(0, 10)) {
    lines.push(formatBoxOffice(movie));
  }

  return lines.join('\n');
}

// =============================================================================
// RESILIENT MOVIE DATA FETCHING (v2)
// =============================================================================

/**
 * Enhanced movie score with source tracking
 */
export interface ResilientMovieScore extends MovieScore {
  source: 'rotten_tomatoes' | 'omdb' | 'tmdb';
  imdbRating?: number;
  metacritic?: number;
  tmdbRating?: number;
  tmdbPopularity?: number;
}

/**
 * Fetch movie score with fallback sources
 *
 * Priority:
 * 1. Rotten Tomatoes (direct scrape) - most accurate
 * 2. OMDB API - has RT scores via API
 * 3. TMDb - has its own ratings
 *
 * Uses caching to avoid repeated API calls
 */
export async function fetchMovieScoreResilient(
  title: string,
  year?: number
): Promise<ResilientMovieScore | null> {
  const cacheKey = `movie:${title.toLowerCase()}:${year ?? 'any'}`;

  const result = await fetchWithFallback<ResilientMovieScore>(
    cacheKey,
    [
      // Source 1: Direct RT scraping (most accurate but fragile)
      createSource('rotten_tomatoes', async () => {
        const slug = normalizeMovieTitle(title);
        const rtScore = await fetchRottenTomatoesScore(slug);

        if (!rtScore || rtScore.tomatometer === undefined) {
          return null;
        }

        return {
          ...rtScore,
          source: 'rotten_tomatoes' as const,
        };
      }, 1),

      // Source 2: OMDB API (reliable, has RT scores)
      createSource('omdb', async () => {
        const omdbData = await omdb.getMovieByTitle(title, year);

        if (!omdbData || omdbData.rottenTomatoes === undefined) {
          return null;
        }

        return {
          title: omdbData.title,
          year: parseInt(omdbData.year, 10) || undefined,
          tomatometer: omdbData.rottenTomatoes,
          url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`,
          fetchedAt: new Date().toISOString(),
          source: 'omdb' as const,
          imdbRating: omdbData.imdb,
          metacritic: omdbData.metacritic,
        };
      }, 2),

      // Source 3: TMDb (always available, different rating system)
      createSource('tmdb', async () => {
        const tmdbData = await tmdb.findMovieByTitle(title, year);

        if (!tmdbData) {
          return null;
        }

        // TMDb uses 0-10 scale, estimate RT equivalent
        // This is a rough approximation: 7.0+ on TMDb ~ 70%+ on RT
        const estimatedRT = tmdbData.voteCount > 100
          ? Math.round(tmdbData.voteAverage * 10)
          : undefined;

        return {
          title: tmdbData.title,
          year: tmdbData.releaseDate ? parseInt(tmdbData.releaseDate.split('-')[0], 10) : undefined,
          tomatometer: estimatedRT,
          url: `https://www.themoviedb.org/movie/${tmdbData.id}`,
          fetchedAt: new Date().toISOString(),
          source: 'tmdb' as const,
          tmdbRating: tmdbData.voteAverage,
          tmdbPopularity: tmdbData.popularity,
        };
      }, 3),
    ],
    {
      cacheTTL: 30 * 60 * 1000,  // 30 minutes
      useStaleOnError: true,
      staleTTL: 24 * 60 * 60 * 1000,  // 24 hours
    }
  );

  if (!result) {
    logger.warn(`Failed to fetch movie score for "${title}" from all sources`);
    return null;
  }

  logger.info(`Movie score for "${title}": ${result.data.tomatometer ?? 'N/A'}% (source: ${result.source})`);
  return result.data;
}

/**
 * Fetch comprehensive movie data from multiple sources
 * Merges data from RT, OMDB, and TMDb
 */
export interface ComprehensiveMovieData {
  title: string;
  year?: number;
  // Scores
  rottenTomatoes?: number;
  audienceScore?: number;
  imdbRating?: number;
  metacritic?: number;
  tmdbRating?: number;
  reviewCount?: number;        // Number of RT critic reviews
  // Box office
  boxOffice?: number;
  budget?: number;
  revenue?: number;
  // Metadata
  runtime?: number;
  genres?: string[];
  director?: string;
  // Awards
  awards?: string;
  hasOscarWin?: boolean;
  hasOscarNom?: boolean;
  // Sources used
  sources: string[];
  fetchedAt: string;
}

export async function fetchComprehensiveMovieData(
  title: string,
  year?: number
): Promise<ComprehensiveMovieData | null> {
  const data: ComprehensiveMovieData = {
    title,
    year,
    sources: [],
    fetchedAt: new Date().toISOString(),
  };

  // Fetch from all sources in parallel
  // Use variations function for RT to handle year suffixes (e.g., primate_2025)
  const [rtResult, omdbResult, tmdbResult] = await Promise.all([
    fetchRottenTomatoesScoreWithVariations(title, year).catch(() => null),
    omdb.getMovieByTitle(title, year).catch(() => null),
    tmdb.findMovieByTitle(title, year).catch(() => null),
  ]);

  // Merge Rotten Tomatoes data
  if (rtResult) {
    data.rottenTomatoes = rtResult.tomatometer;
    data.audienceScore = rtResult.audienceScore;
    data.reviewCount = rtResult.reviewCount;
    data.sources.push('rotten_tomatoes');
  }

  // Merge OMDB data
  if (omdbResult) {
    data.rottenTomatoes = data.rottenTomatoes ?? omdbResult.rottenTomatoes;
    data.imdbRating = omdbResult.imdb;
    data.metacritic = omdbResult.metacritic;
    data.boxOffice = omdb.parseBoxOffice(omdbResult.boxOffice) ?? undefined;
    data.runtime = omdb.parseRuntime(omdbResult.runtime) ?? undefined;
    data.director = omdbResult.director !== 'N/A' ? omdbResult.director : undefined;
    data.awards = omdbResult.awards !== 'N/A' ? omdbResult.awards : undefined;

    const awardsInfo = omdb.hasAwardsRecognition(omdbResult);
    data.hasOscarWin = awardsInfo.hasOscar;
    data.hasOscarNom = awardsInfo.hasNominations;

    data.sources.push('omdb');
  }

  // Merge TMDb data
  if (tmdbResult) {
    data.tmdbRating = tmdbResult.voteAverage;
    data.budget = tmdbResult.budget > 0 ? tmdbResult.budget : undefined;
    data.revenue = tmdbResult.revenue > 0 ? tmdbResult.revenue : undefined;
    data.runtime = data.runtime ?? tmdbResult.runtime ?? undefined;
    data.genres = tmdbResult.genres.length > 0 ? tmdbResult.genres : undefined;
    data.year = data.year ?? (tmdbResult.releaseDate ? parseInt(tmdbResult.releaseDate.split('-')[0], 10) : undefined);
    data.sources.push('tmdb');
  }

  // Return null if no data was found
  if (data.sources.length === 0) {
    return null;
  }

  return data;
}

/**
 * Format comprehensive movie data for display
 */
export function formatComprehensiveMovieData(data: ComprehensiveMovieData): string {
  const lines: string[] = [`**${data.title}** (${data.year ?? 'Unknown year'})`];

  // Scores section
  const scores: string[] = [];
  if (data.rottenTomatoes !== undefined) {
    const icon = data.rottenTomatoes >= 60 ? '🍅' : '🤢';
    scores.push(`${icon} RT: ${data.rottenTomatoes}%`);
  }
  if (data.audienceScore !== undefined) {
    scores.push(`🍿 Aud: ${data.audienceScore}%`);
  }
  if (data.imdbRating !== undefined) {
    scores.push(`⭐ IMDB: ${data.imdbRating}`);
  }
  if (data.metacritic !== undefined) {
    scores.push(`📊 MC: ${data.metacritic}`);
  }
  if (scores.length > 0) {
    lines.push(scores.join(' | '));
  }

  // Box office
  if (data.boxOffice || data.revenue) {
    const amount = data.boxOffice ?? data.revenue!;
    lines.push(`💰 Box Office: $${(amount / 1_000_000).toFixed(1)}M`);
  }

  // Budget
  if (data.budget) {
    lines.push(`📽️ Budget: $${(data.budget / 1_000_000).toFixed(0)}M`);
  }

  // Awards
  if (data.hasOscarWin) {
    lines.push('🏆 Oscar Winner');
  } else if (data.hasOscarNom) {
    lines.push('🎖️ Oscar Nominated');
  }

  // Genres
  if (data.genres && data.genres.length > 0) {
    lines.push(`🎭 ${data.genres.slice(0, 3).join(', ')}`);
  }

  // Sources
  lines.push(`_Sources: ${data.sources.join(', ')}_`);

  return lines.join('\n');
}
