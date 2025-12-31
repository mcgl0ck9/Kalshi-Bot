/**
 * Fetchers module exports
 */

export {
  fetchAllRssFeeds,
  fetchNewsApi,
  fetchAllNews,
} from './news.js';

// Economic indicators
export * from './economic/index.js';

export {
  getWhaleInfo,
  getAllWhales,
  analyzeWhaleText,
  checkWhaleActivity,
  formatWhaleActivity,
  getWhaleLeaderboard,
} from './whales.js';

export {
  // Rotten Tomatoes
  fetchRottenTomatoesScore,
  searchRottenTomatoes,
  fetchMultipleMovieScores,
  // Box Office
  fetchWeekendBoxOffice,
  fetchMovieBoxOffice,
  // Utilities
  normalizeMovieTitle,
  extractMovieFromMarketTitle,
  formatMovieScore,
  formatBoxOffice,
  formatWeekendBoxOfficeReport,
  // Types
  type MovieScore,
  type BoxOfficeData,
  type UpcomingRelease,
} from './entertainment.js';

// Options-implied probabilities
export {
  fetchFedFundsImplied,
  fetchSPXImplied,
  fetchTreasuryYields,
  fetchAllOptionsImplied,
  findOptionsEdge,
  formatOptionsImpliedReport,
} from './options-implied.js';
