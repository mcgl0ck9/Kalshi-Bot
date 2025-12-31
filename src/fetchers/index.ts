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

// Sports odds (The Odds API integration)
export {
  fetchSportOdds,
  fetchAllSportsOdds,
  analyzeInjuryOverreaction,
  compareKalshiToConsensus,
  findSportsEdges,
  formatSportsOddsReport,
  formatSportsEdgesReport,
  type SportOdds,
  type BookmakerOdds,
  type LineMovement,
  type InjuryLineImpact,
  type SportsEdgeSignal,
} from './sports-odds.js';

// Polymarket on-chain data (Goldsky subgraphs + Gamma API)
export {
  fetchActiveMarkets,
  fetchLargePositions,
  fetchMarketPositions,
  fetchOrderbookDepth,
  fetchRecentTrades,
  analyzeMarketConviction,
  findWhaleConvictionSignals,
  formatWhaleConvictionReport,
  type WhalePosition,
  type MarketConviction,
  type OrderbookDepth,
  type PolymarketSignal,
  type GammaMarket,
  type RecentTrade,
} from './polymarket-onchain.js';
