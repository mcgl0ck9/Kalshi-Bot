/**
 * OMDB (Open Movie Database) Fetcher
 *
 * Provides movie scores and metadata as fallback for Rotten Tomatoes scraping:
 * - Rotten Tomatoes score (when available)
 * - IMDB rating
 * - Metacritic score
 * - Awards information
 * - Box office data
 *
 * API: omdbapi.com
 * Cost: Free tier (1000 requests/day)
 * Docs: https://www.omdbapi.com/
 */

import { logger } from '../utils/index.js';
import { OMDB_API_KEY } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface OMDbRating {
  source: string;
  value: string;
}

export interface OMDbMovie {
  title: string;
  year: string;
  rated: string;
  released: string;
  runtime: string;
  genre: string;
  director: string;
  writer: string;
  actors: string;
  plot: string;
  language: string;
  country: string;
  awards: string;
  poster: string;
  ratings: OMDbRating[];
  metascore: string;
  imdbRating: string;
  imdbVotes: string;
  imdbId: string;
  type: 'movie' | 'series' | 'episode';
  dvd: string;
  boxOffice: string;
  production: string;
  website: string;
  // Parsed scores
  rottenTomatoes?: number;
  metacritic?: number;
  imdb?: number;
}

export interface OMDbSearchResult {
  title: string;
  year: string;
  imdbId: string;
  type: string;
  poster: string;
}

// =============================================================================
// API CONFIGURATION
// =============================================================================

const OMDB_BASE_URL = 'https://www.omdbapi.com';

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Get movie by title (and optionally year)
 */
export async function getMovieByTitle(title: string, year?: number): Promise<OMDbMovie | null> {
  if (!OMDB_API_KEY) {
    logger.debug('OMDB_API_KEY not configured, skipping OMDB fetch');
    return null;
  }

  try {
    const params = new URLSearchParams({
      apikey: OMDB_API_KEY,
      t: title,
      type: 'movie',
      plot: 'short',
    });

    if (year) {
      params.set('y', year.toString());
    }

    const response = await fetch(`${OMDB_BASE_URL}/?${params}`);

    if (!response.ok) {
      logger.warn(`OMDB fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      Response: string;
      Error?: string;
      Title?: string;
      Year?: string;
      Rated?: string;
      Released?: string;
      Runtime?: string;
      Genre?: string;
      Director?: string;
      Writer?: string;
      Actors?: string;
      Plot?: string;
      Language?: string;
      Country?: string;
      Awards?: string;
      Poster?: string;
      Ratings?: Array<{ Source: string; Value: string }>;
      Metascore?: string;
      imdbRating?: string;
      imdbVotes?: string;
      imdbID?: string;
      Type?: string;
      DVD?: string;
      BoxOffice?: string;
      Production?: string;
      Website?: string;
    };

    if (data.Response === 'False') {
      logger.debug(`OMDB: ${data.Error ?? 'Movie not found'}`);
      return null;
    }

    return parseOMDbResponse(data);
  } catch (error) {
    logger.error(`OMDB fetch error: ${error}`);
    return null;
  }
}

/**
 * Get movie by IMDB ID
 */
export async function getMovieByImdbId(imdbId: string): Promise<OMDbMovie | null> {
  if (!OMDB_API_KEY) {
    logger.debug('OMDB_API_KEY not configured');
    return null;
  }

  try {
    const params = new URLSearchParams({
      apikey: OMDB_API_KEY,
      i: imdbId,
      plot: 'short',
    });

    const response = await fetch(`${OMDB_BASE_URL}/?${params}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { Response: string } & Record<string, unknown>;

    if (data.Response === 'False') {
      return null;
    }

    return parseOMDbResponse(data);
  } catch (error) {
    logger.error(`OMDB fetch error: ${error}`);
    return null;
  }
}

/**
 * Search for movies by title
 */
export async function searchMovies(query: string, year?: number): Promise<OMDbSearchResult[]> {
  if (!OMDB_API_KEY) {
    logger.debug('OMDB_API_KEY not configured');
    return [];
  }

  try {
    const params = new URLSearchParams({
      apikey: OMDB_API_KEY,
      s: query,
      type: 'movie',
    });

    if (year) {
      params.set('y', year.toString());
    }

    const response = await fetch(`${OMDB_BASE_URL}/?${params}`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      Response: string;
      Search?: Array<{
        Title: string;
        Year: string;
        imdbID: string;
        Type: string;
        Poster: string;
      }>;
    };

    if (data.Response === 'False' || !data.Search) {
      return [];
    }

    return data.Search.map(movie => ({
      title: movie.Title,
      year: movie.Year,
      imdbId: movie.imdbID,
      type: movie.Type,
      poster: movie.Poster,
    }));
  } catch (error) {
    logger.error(`OMDB search error: ${error}`);
    return [];
  }
}

// =============================================================================
// PARSING HELPERS
// =============================================================================

/**
 * Parse OMDB API response into typed object
 */
function parseOMDbResponse(data: Record<string, unknown>): OMDbMovie {
  const ratings: OMDbRating[] = (data.Ratings as Array<{ Source: string; Value: string }> || []).map(r => ({
    source: r.Source,
    value: r.Value,
  }));

  // Parse individual scores
  let rottenTomatoes: number | undefined;
  let metacritic: number | undefined;
  let imdb: number | undefined;

  // Extract Rotten Tomatoes from ratings array
  const rtRating = ratings.find(r => r.source === 'Rotten Tomatoes');
  if (rtRating) {
    const match = rtRating.value.match(/(\d+)%/);
    if (match) {
      rottenTomatoes = parseInt(match[1], 10);
    }
  }

  // Extract Metacritic
  const metascore = data.Metascore as string;
  if (metascore && metascore !== 'N/A') {
    metacritic = parseInt(metascore, 10);
  }

  // Extract IMDB
  const imdbRating = data.imdbRating as string;
  if (imdbRating && imdbRating !== 'N/A') {
    imdb = parseFloat(imdbRating);
  }

  return {
    title: (data.Title as string) ?? '',
    year: (data.Year as string) ?? '',
    rated: (data.Rated as string) ?? '',
    released: (data.Released as string) ?? '',
    runtime: (data.Runtime as string) ?? '',
    genre: (data.Genre as string) ?? '',
    director: (data.Director as string) ?? '',
    writer: (data.Writer as string) ?? '',
    actors: (data.Actors as string) ?? '',
    plot: (data.Plot as string) ?? '',
    language: (data.Language as string) ?? '',
    country: (data.Country as string) ?? '',
    awards: (data.Awards as string) ?? '',
    poster: (data.Poster as string) ?? '',
    ratings,
    metascore: metascore ?? '',
    imdbRating: imdbRating ?? '',
    imdbVotes: (data.imdbVotes as string) ?? '',
    imdbId: (data.imdbID as string) ?? '',
    type: (data.Type as 'movie' | 'series' | 'episode') ?? 'movie',
    dvd: (data.DVD as string) ?? '',
    boxOffice: (data.BoxOffice as string) ?? '',
    production: (data.Production as string) ?? '',
    website: (data.Website as string) ?? '',
    rottenTomatoes,
    metacritic,
    imdb,
  };
}

/**
 * Parse box office string to number
 * "$150,000,000" -> 150000000
 */
export function parseBoxOffice(boxOfficeStr: string): number | null {
  if (!boxOfficeStr || boxOfficeStr === 'N/A') {
    return null;
  }

  const match = boxOfficeStr.match(/\$?([\d,]+)/);
  if (!match) {
    return null;
  }

  return parseInt(match[1].replace(/,/g, ''), 10);
}

/**
 * Parse runtime string to minutes
 * "120 min" -> 120
 */
export function parseRuntime(runtimeStr: string): number | null {
  if (!runtimeStr || runtimeStr === 'N/A') {
    return null;
  }

  const match = runtimeStr.match(/(\d+)/);
  if (!match) {
    return null;
  }

  return parseInt(match[1], 10);
}

// =============================================================================
// SCORE EXTRACTION (Primary use case - RT fallback)
// =============================================================================

/**
 * Get Rotten Tomatoes score via OMDB
 * Use this as fallback when direct RT scraping fails
 */
export async function getRottenTomatoesScore(title: string, year?: number): Promise<{
  tomatometer?: number;
  imdbRating?: number;
  metacritic?: number;
  source: 'omdb';
} | null> {
  const movie = await getMovieByTitle(title, year);

  if (!movie) {
    return null;
  }

  // Only return if we have at least one score
  if (!movie.rottenTomatoes && !movie.imdb && !movie.metacritic) {
    return null;
  }

  return {
    tomatometer: movie.rottenTomatoes,
    imdbRating: movie.imdb,
    metacritic: movie.metacritic,
    source: 'omdb',
  };
}

/**
 * Check if a movie has awards recognition
 * Useful for Oscar/awards markets
 */
export function hasAwardsRecognition(movie: OMDbMovie): {
  hasOscar: boolean;
  hasNominations: boolean;
  oscarWins?: number;
  oscarNominations?: number;
  totalWins?: number;
  totalNominations?: number;
} {
  const awards = movie.awards.toLowerCase();

  const oscarWinMatch = awards.match(/won (\d+) oscar/i);
  const oscarNomMatch = awards.match(/nominated for (\d+) oscar/i);
  const winsMatch = awards.match(/(\d+) win/i);
  const nomsMatch = awards.match(/(\d+) nomination/i);

  return {
    hasOscar: awards.includes('oscar') && awards.includes('won'),
    hasNominations: awards.includes('nominat'),
    oscarWins: oscarWinMatch ? parseInt(oscarWinMatch[1], 10) : undefined,
    oscarNominations: oscarNomMatch ? parseInt(oscarNomMatch[1], 10) : undefined,
    totalWins: winsMatch ? parseInt(winsMatch[1], 10) : undefined,
    totalNominations: nomsMatch ? parseInt(nomsMatch[1], 10) : undefined,
  };
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format OMDB movie for display
 */
export function formatOMDbMovie(movie: OMDbMovie): string {
  const lines: string[] = [`**${movie.title}** (${movie.year})`];

  // Scores
  const scores: string[] = [];
  if (movie.rottenTomatoes !== undefined) {
    const icon = movie.rottenTomatoes >= 60 ? '🍅' : '🤢';
    scores.push(`${icon} RT: ${movie.rottenTomatoes}%`);
  }
  if (movie.imdb !== undefined) {
    scores.push(`⭐ IMDB: ${movie.imdb}/10`);
  }
  if (movie.metacritic !== undefined) {
    scores.push(`📊 Meta: ${movie.metacritic}/100`);
  }

  if (scores.length > 0) {
    lines.push(scores.join(' | '));
  }

  // Other info
  if (movie.runtime && movie.runtime !== 'N/A') {
    lines.push(`🎬 ${movie.runtime}`);
  }

  if (movie.genre && movie.genre !== 'N/A') {
    lines.push(`🎭 ${movie.genre}`);
  }

  if (movie.boxOffice && movie.boxOffice !== 'N/A') {
    lines.push(`💰 Box Office: ${movie.boxOffice}`);
  }

  if (movie.awards && movie.awards !== 'N/A' && movie.awards.length < 80) {
    lines.push(`🏆 ${movie.awards}`);
  }

  return lines.join('\n');
}

/**
 * Format comparison between RT scrape and OMDB data
 */
export function formatScoreComparison(
  title: string,
  rtScore?: number,
  omdbScore?: number
): string {
  if (rtScore === undefined && omdbScore === undefined) {
    return `**${title}**: No scores available`;
  }

  const lines: string[] = [`**${title}**`];

  if (rtScore !== undefined) {
    lines.push(`  RT (direct): ${rtScore}%`);
  }
  if (omdbScore !== undefined) {
    lines.push(`  RT (OMDB): ${omdbScore}%`);
  }

  if (rtScore !== undefined && omdbScore !== undefined && rtScore !== omdbScore) {
    const diff = rtScore - omdbScore;
    lines.push(`  Δ: ${diff > 0 ? '+' : ''}${diff}% (OMDB may be stale)`);
  }

  return lines.join('\n');
}
