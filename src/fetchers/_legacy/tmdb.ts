/**
 * TMDb (The Movie Database) Fetcher
 *
 * Provides comprehensive movie metadata:
 * - Movie details (title, release date, runtime, budget, revenue)
 * - Popularity scores and vote averages
 * - Release dates and status
 * - Box office data (when available)
 *
 * API: api.themoviedb.org/3
 * Cost: Free (rate limited)
 * Docs: https://developer.themoviedb.org/docs
 */

import { logger } from '../../utils/index.js';
import { TMDB_API_KEY } from '../../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TMDbMovie {
  id: number;
  title: string;
  originalTitle: string;
  overview: string;
  releaseDate: string;
  status: 'Rumored' | 'Planned' | 'In Production' | 'Post Production' | 'Released' | 'Canceled';
  runtime: number | null;
  budget: number;
  revenue: number;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  productionCompanies: string[];
  tagline: string;
  imdbId: string | null;
  homepage: string | null;
}

export interface TMDbSearchResult {
  id: number;
  title: string;
  originalTitle: string;
  releaseDate: string;
  overview: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  posterPath: string | null;
}

export interface TMDbUpcoming {
  movies: TMDbSearchResult[];
  totalResults: number;
  totalPages: number;
}

// =============================================================================
// API CONFIGURATION
// =============================================================================

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Search for movies by title
 */
export async function searchMovies(query: string, year?: number): Promise<TMDbSearchResult[]> {
  if (!TMDB_API_KEY) {
    logger.debug('TMDB_API_KEY not configured, skipping TMDb search');
    return [];
  }

  try {
    const params = new URLSearchParams({
      api_key: TMDB_API_KEY,
      query,
      include_adult: 'false',
      language: 'en-US',
    });

    if (year) {
      params.set('year', year.toString());
    }

    const response = await fetch(`${TMDB_BASE_URL}/search/movie?${params}`);

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('TMDB_API_KEY is invalid');
      } else if (response.status === 429) {
        logger.warn('TMDb rate limit exceeded');
      }
      return [];
    }

    const data = await response.json() as {
      results: Array<{
        id: number;
        title: string;
        original_title: string;
        release_date: string;
        overview: string;
        popularity: number;
        vote_average: number;
        vote_count: number;
        poster_path: string | null;
      }>;
    };

    return data.results.map(movie => ({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      releaseDate: movie.release_date,
      overview: movie.overview,
      popularity: movie.popularity,
      voteAverage: movie.vote_average,
      voteCount: movie.vote_count,
      posterPath: movie.poster_path,
    }));
  } catch (error) {
    logger.error(`TMDb search error: ${error}`);
    return [];
  }
}

/**
 * Get detailed movie information by TMDb ID
 */
export async function getMovieDetails(movieId: number): Promise<TMDbMovie | null> {
  if (!TMDB_API_KEY) {
    logger.debug('TMDB_API_KEY not configured');
    return null;
  }

  try {
    const params = new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: 'en-US',
    });

    const response = await fetch(`${TMDB_BASE_URL}/movie/${movieId}?${params}`);

    if (!response.ok) {
      logger.debug(`TMDb movie fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      id: number;
      title: string;
      original_title: string;
      overview: string;
      release_date: string;
      status: string;
      runtime: number | null;
      budget: number;
      revenue: number;
      popularity: number;
      vote_average: number;
      vote_count: number;
      poster_path: string | null;
      backdrop_path: string | null;
      genres: Array<{ id: number; name: string }>;
      production_companies: Array<{ id: number; name: string }>;
      tagline: string;
      imdb_id: string | null;
      homepage: string | null;
    };

    return {
      id: data.id,
      title: data.title,
      originalTitle: data.original_title,
      overview: data.overview,
      releaseDate: data.release_date,
      status: data.status as TMDbMovie['status'],
      runtime: data.runtime,
      budget: data.budget,
      revenue: data.revenue,
      popularity: data.popularity,
      voteAverage: data.vote_average,
      voteCount: data.vote_count,
      posterPath: data.poster_path,
      backdropPath: data.backdrop_path,
      genres: data.genres.map(g => g.name),
      productionCompanies: data.production_companies.map(c => c.name),
      tagline: data.tagline,
      imdbId: data.imdb_id,
      homepage: data.homepage,
    };
  } catch (error) {
    logger.error(`TMDb movie details error: ${error}`);
    return null;
  }
}

/**
 * Get upcoming movies
 */
export async function getUpcomingMovies(page: number = 1): Promise<TMDbUpcoming> {
  if (!TMDB_API_KEY) {
    logger.debug('TMDB_API_KEY not configured');
    return { movies: [], totalResults: 0, totalPages: 0 };
  }

  try {
    const params = new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: 'en-US',
      page: page.toString(),
      region: 'US',
    });

    const response = await fetch(`${TMDB_BASE_URL}/movie/upcoming?${params}`);

    if (!response.ok) {
      return { movies: [], totalResults: 0, totalPages: 0 };
    }

    const data = await response.json() as {
      results: Array<{
        id: number;
        title: string;
        original_title: string;
        release_date: string;
        overview: string;
        popularity: number;
        vote_average: number;
        vote_count: number;
        poster_path: string | null;
      }>;
      total_results: number;
      total_pages: number;
    };

    return {
      movies: data.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        releaseDate: movie.release_date,
        overview: movie.overview,
        popularity: movie.popularity,
        voteAverage: movie.vote_average,
        voteCount: movie.vote_count,
        posterPath: movie.poster_path,
      })),
      totalResults: data.total_results,
      totalPages: data.total_pages,
    };
  } catch (error) {
    logger.error(`TMDb upcoming error: ${error}`);
    return { movies: [], totalResults: 0, totalPages: 0 };
  }
}

/**
 * Get now playing movies (currently in theaters)
 */
export async function getNowPlayingMovies(page: number = 1): Promise<TMDbUpcoming> {
  if (!TMDB_API_KEY) {
    logger.debug('TMDB_API_KEY not configured');
    return { movies: [], totalResults: 0, totalPages: 0 };
  }

  try {
    const params = new URLSearchParams({
      api_key: TMDB_API_KEY,
      language: 'en-US',
      page: page.toString(),
      region: 'US',
    });

    const response = await fetch(`${TMDB_BASE_URL}/movie/now_playing?${params}`);

    if (!response.ok) {
      return { movies: [], totalResults: 0, totalPages: 0 };
    }

    const data = await response.json() as {
      results: Array<{
        id: number;
        title: string;
        original_title: string;
        release_date: string;
        overview: string;
        popularity: number;
        vote_average: number;
        vote_count: number;
        poster_path: string | null;
      }>;
      total_results: number;
      total_pages: number;
    };

    return {
      movies: data.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        releaseDate: movie.release_date,
        overview: movie.overview,
        popularity: movie.popularity,
        voteAverage: movie.vote_average,
        voteCount: movie.vote_count,
        posterPath: movie.poster_path,
      })),
      totalResults: data.total_results,
      totalPages: data.total_pages,
    };
  } catch (error) {
    logger.error(`TMDb now playing error: ${error}`);
    return { movies: [], totalResults: 0, totalPages: 0 };
  }
}

/**
 * Search and get full details for a movie by title
 * Convenience function that combines search + details
 */
export async function findMovieByTitle(title: string, year?: number): Promise<TMDbMovie | null> {
  const searchResults = await searchMovies(title, year);

  if (searchResults.length === 0) {
    return null;
  }

  // Get the most relevant result (first one, highest relevance)
  return getMovieDetails(searchResults[0].id);
}

/**
 * Get poster URL for a movie
 */
export function getPosterUrl(posterPath: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w342'): string | null {
  if (!posterPath) return null;
  return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
}

// =============================================================================
// BOX OFFICE ESTIMATION
// =============================================================================

/**
 * Estimate box office performance based on TMDb data
 * Note: TMDb revenue data is not always up-to-date
 */
export function estimateBoxOfficeFromTMDb(movie: TMDbMovie): {
  hasBoxOfficeData: boolean;
  domesticEstimate?: number;
  worldwideGross?: number;
  openingWeekendEstimate?: number;
  profitability?: 'profitable' | 'break-even' | 'loss' | 'unknown';
} {
  const hasRevenue = movie.revenue > 0;
  const hasBudget = movie.budget > 0;

  if (!hasRevenue) {
    return { hasBoxOfficeData: false };
  }

  // TMDb reports worldwide gross
  const worldwideGross = movie.revenue;

  // Estimate domestic as ~40% of worldwide (rough average)
  const domesticEstimate = Math.round(worldwideGross * 0.4);

  // Estimate opening weekend as ~30-40% of domestic total
  const openingWeekendEstimate = Math.round(domesticEstimate * 0.35);

  // Determine profitability
  let profitability: 'profitable' | 'break-even' | 'loss' | 'unknown' = 'unknown';
  if (hasBudget) {
    // Rule of thumb: need ~2.5x budget to be profitable (marketing costs)
    const breakEven = movie.budget * 2.5;
    if (worldwideGross >= breakEven * 1.2) {
      profitability = 'profitable';
    } else if (worldwideGross >= breakEven * 0.8) {
      profitability = 'break-even';
    } else {
      profitability = 'loss';
    }
  }

  return {
    hasBoxOfficeData: true,
    domesticEstimate,
    worldwideGross,
    openingWeekendEstimate,
    profitability,
  };
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format TMDb movie for display
 */
export function formatTMDbMovie(movie: TMDbMovie): string {
  const lines: string[] = [`**${movie.title}** (${movie.releaseDate?.split('-')[0] ?? 'TBD'})`];

  if (movie.tagline) {
    lines.push(`_"${movie.tagline}"_`);
  }

  lines.push(`⭐ TMDb: ${movie.voteAverage.toFixed(1)}/10 (${movie.voteCount.toLocaleString()} votes)`);

  if (movie.runtime) {
    lines.push(`🎬 Runtime: ${movie.runtime} min`);
  }

  if (movie.genres.length > 0) {
    lines.push(`🎭 ${movie.genres.slice(0, 3).join(', ')}`);
  }

  if (movie.budget > 0) {
    lines.push(`💰 Budget: $${(movie.budget / 1_000_000).toFixed(0)}M`);
  }

  if (movie.revenue > 0) {
    lines.push(`📊 Worldwide: $${(movie.revenue / 1_000_000).toFixed(1)}M`);
  }

  lines.push(`📅 Status: ${movie.status}`);

  return lines.join('\n');
}

/**
 * Format upcoming movies report
 */
export function formatUpcomingMoviesReport(upcoming: TMDbUpcoming): string {
  if (upcoming.movies.length === 0) {
    return 'No upcoming movies found.';
  }

  const lines: string[] = ['**🎬 Upcoming Releases**\n'];

  for (const movie of upcoming.movies.slice(0, 10)) {
    const date = movie.releaseDate ? new Date(movie.releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD';
    const rating = movie.voteAverage > 0 ? ` ⭐${movie.voteAverage.toFixed(1)}` : '';
    lines.push(`• **${movie.title}** - ${date}${rating}`);
  }

  return lines.join('\n');
}
