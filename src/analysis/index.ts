/**
 * Analysis module exports
 */

export {
  calculateTitleSimilarity,
  matchMarketsCrossPlatform,
  getDivergentMarkets,
  formatCrossPlatformComparison,
  formatDivergenceReport,
} from './cross-platform.js';

export {
  analyzeTextSentiment,
  analyzeArticleSentiment,
  matchArticleToTopics,
  analyzeSentimentForTopics,
  findSentimentEdges,
} from './sentiment.js';

export {
  kellyCriterion,
  calculatePositionSize,
  calculateAdaptivePosition,
  formatPositionRecommendation,
  formatOpportunityWithSizing,
} from './position-sizing.js';
