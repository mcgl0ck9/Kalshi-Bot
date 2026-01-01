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
  // Player props
  fetchPlayerProps,
  fetchAllPlayerProps,
  findPlayerPropEdges,
  type SportOdds,
  type BookmakerOdds,
  type LineMovement,
  type InjuryLineImpact,
  type SportsEdgeSignal,
  type PlayerProp,
  type PlayerPropEdge,
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

// Whale auto-discovery
export {
  discoverProfitableWallets,
  getTrackedWhales,
  getWhaleWallets,
  isKnownWhale,
  getWhaleDiscoveryStats,
  formatWhaleDiscoveryReport,
  type DiscoveredWhale,
  type WhaleDiscoveryResult,
} from './whale-discovery.js';

// Transcript parsing (Fed speeches, earnings calls)
export {
  getKeywordFrequencies,
  getKeywordFrequency,
  adjustForContext,
  getContextAdjustedFrequencies,
  parseTranscript,
  addTranscriptToCache,
  getTranscriptStats,
  type TranscriptAnalysis,
  type KeywordFrequency,
} from './transcript-parser.js';

// Health trackers (flu, COVID, mpox)
export {
  fetchFluData,
  fetchCovidData,
  fetchMpoxData,
  fetchAllHealthData,
  calculateDiseaseThresholdProbability,
  getHealthTrackingStats,
  formatHealthReport,
  type DiseaseData,
  type HealthMarketEdge,
} from './health-trackers.js';

// ESPN Sports Odds (no API key required)
export {
  fetchSportsOddsESPN,
  fetchAllSportsOddsESPN,
  findESPNEdge,
  oddsToProb,
  spreadToWinProb,
  detectSharpMoney,
  type ESPNOdds,
  type ESPNGame,
  type ConsensusData,
  type SharpSquareSignal,
} from './espn-odds.js';

// CDC Health Surveillance (wastewater, flu)
export {
  fetchWastewaterData,
  fetchAllHealthSurveillance,
  analyzeWastewaterEdge,
  analyzeFluEdge,
  type WastewaterData,
  type FluData as CDCFluData,
  type HealthEdgeSignal,
} from './cdc-surveillance.js';

// Crypto Funding Rates & Sentiment
export {
  fetchFundingRates,
  fetchFearGreedIndex,
  fetchAllCryptoSentiment,
  analyzeFundingEdge,
  analyzeFearGreedEdge,
  type FundingRate,
  type FundingAggregate,
  type FearGreedIndex,
  type CryptoEdgeSignal,
} from './crypto-funding.js';

// Fed Nowcasts (GDPNow, Inflation)
export {
  fetchGDPNow,
  fetchInflationNowcast,
  fetchAllNowcasts,
  analyzeGDPEdge,
  analyzeInflationEdge,
  type GDPNowcast,
  type InflationNowcast,
  type EconomicEdgeSignal,
} from './fed-nowcasts.js';
