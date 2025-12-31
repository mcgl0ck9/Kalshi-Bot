/**
 * Entertainment Data Fetcher
 *
 * Fetches data relevant to Kalshi entertainment markets:
 * - Rotten Tomatoes scores (Tomatometer + Audience Score)
 * - Box Office data (opening weekend, total gross)
 * - Upcoming releases
 */

import { logger, delay } from '../utils/index.js';

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
  try {
    const url = `https://www.rottentomatoes.com/m/${movieSlug}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.debug(`RT fetch failed for ${movieSlug}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract Tomatometer score
    const tomatometerMatch = html.match(/(?:tomatometerscore|tomatometerScore)["\s:]+(\d+)/i);
    const tomatometer = tomatometerMatch ? parseInt(tomatometerMatch[1], 10) : undefined;

    // Extract Audience Score
    const audienceMatch = html.match(/(?:audiencescore|audienceScore)["\s:]+(\d+)/i);
    const audienceScore = audienceMatch ? parseInt(audienceMatch[1], 10) : undefined;

    // Extract title
    const titleMatch = html.match(/<h1[^>]*slot="titleIntro"[^>]*>([^<]+)</i) ||
                       html.match(/<title>([^|<]+)/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/ - Rotten Tomatoes$/, '') : movieSlug;

    // Check for Certified Fresh
    const certifiedFresh = html.includes('certified-fresh') || html.includes('certified_fresh');

    // Extract consensus
    const consensusMatch = html.match(/data-qa="critics-consensus">([^<]+)</i);
    const consensus = consensusMatch ? consensusMatch[1].trim() : undefined;

    return {
      title,
      tomatometer,
      audienceScore,
      certifiedFresh,
      consensus,
      url,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`RT scrape error for ${movieSlug}: ${error}`);
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
 */
const TITLE_NORMALIZATIONS: Record<string, string[]> = {
  // Add known title variations here
  // 'normalized_slug': ['kalshi variation', 'another variation']
};

/**
 * Normalize a movie title for matching
 */
export function normalizeMovieTitle(title: string): string {
  return title
    .toLowerCase()
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

  // Pattern: "Will X have a Rotten Tomatoes score above Y%?"
  const rtPattern = /(?:will\s+)?["']?([^"']+?)["']?\s+(?:have\s+)?(?:a\s+)?(?:rotten\s+tomatoes|rt)\s+(?:score\s+)?(?:above|over|at least|greater than)\s+(\d+)/i;

  const match = lower.match(rtPattern);
  if (match) {
    return {
      movieTitle: match[1].trim(),
      scoreType: lower.includes('audience') ? 'audience' : 'tomatometer',
      threshold: parseInt(match[2], 10),
    };
  }

  // Pattern: "X Rotten Tomatoes score"
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
