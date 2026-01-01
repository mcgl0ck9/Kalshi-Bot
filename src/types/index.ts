/**
 * Core type definitions for Kalshi Edge Detector
 */

// =============================================================================
// MARKET TYPES
// =============================================================================

export interface Market {
  platform: 'kalshi' | 'polymarket';
  id: string;
  ticker?: string;
  title: string;
  description?: string;
  category: MarketCategory;
  price: number;           // YES price as decimal (0-1)
  volume: number;
  volume24h?: number;
  liquidity?: number;
  openInterest?: number;
  url: string;
  closeTime?: string;
  tokenId?: string;        // For Polymarket token-level matching
  outcomes?: OutcomeToken[];
}

export interface OutcomeToken {
  outcome: string;
  tokenId: string;
  price: number;
}

export type MarketCategory =
  | 'politics'
  | 'crypto'
  | 'macro'
  | 'sports'
  | 'entertainment'
  | 'geopolitics'
  | 'weather'
  | 'tech'
  | 'other';

// =============================================================================
// EDGE DETECTION TYPES
// =============================================================================

export interface CrossPlatformMatch {
  kalshi: Market;
  polymarket: Market;
  similarity: number;
  kalshiPrice: number;
  polymarketPrice: number;
  priceDifference: number;
  absDifference: number;
  polymarketMoreBullish: boolean;
  category: MarketCategory;
}

export interface SentimentEdge {
  market: Market;
  topic: string;
  category: MarketCategory;
  marketPrice: number;
  impliedPrice: number;
  edge: number;
  direction: 'BUY YES' | 'BUY NO';
  sentiment: number;
  sentimentLabel: 'bullish' | 'bearish' | 'neutral';
  articleCount: number;
  confidence: number;
  urgency: 'critical' | 'standard' | 'fyi';
  topArticles?: NewsArticle[];
}

export interface EdgeOpportunity {
  market: Market;
  source: 'cross-platform' | 'sentiment' | 'whale' | 'combined' | 'measles' | 'earnings' | 'macro' | 'options' | 'sports' | 'new-market';
  edge: number;
  confidence: number;
  urgency: 'critical' | 'standard' | 'fyi';
  direction: 'BUY YES' | 'BUY NO';
  signals: {
    crossPlatform?: CrossPlatformMatch;
    sentiment?: SentimentEdge;
    whale?: WhaleSignal;
    // Sports and macro signals
    sportsConsensus?: number;
    matchedGame?: string;
    fedRegime?: string;
    injuryOverreaction?: number;
    // Weather and bias signals
    weatherBias?: string;
    recencyBias?: boolean;
    // Polymarket whale conviction (on-chain data)
    whaleConviction?: {
      polymarketPrice: number;
      whaleImpliedPrice: number;
      convictionStrength: number;
      topWhaleCount: number;
    };
    // Fed speech keyword analysis
    fedSpeech?: {
      keyword: string;
      historicalFrequency: number;
      reasoning: string;
    };
    // CDC measles case count analysis
    measles?: {
      currentCases: number;
      threshold: number;
      projectedYearEnd: number;
    };
    // Earnings call keyword analysis
    earnings?: {
      company: string;
      keyword: string;
      impliedProbability: number;
      reasoning: string;
    };
    // Macro economic edge analysis (CPI, Jobs, GDP)
    macroEdge?: {
      indicatorType: string;
      indicatorName: string;
      indicatorValue: number;
      indicatorSource: string;
      impliedProbability: number;
      reasoning: string;
    };
    // Options-implied probability edge (Fed Funds, SPX, Treasury)
    optionsImplied?: {
      source: string;
      impliedProb: number;
      marketPrice: number;
      dataType: 'fed' | 'spx' | 'recession';
      reasoning: string;
    };
    // Enhanced sports edge (sharp/square, injuries, weather combined)
    enhancedSports?: {
      sport: string;
      homeTeam: string;
      awayTeam: string;
      compositeEdge: number;
      sharpEdge?: number;
      injuryAdvantage?: string;
      weatherImpact?: number;
      signals: string[];
      primaryReason: string;
    };
    // New market early mover advantage
    newMarket?: {
      ageMinutes: number;
      earlyMoverAdvantage: 'high' | 'medium' | 'low';
      potentialEdge?: number;
      liquidityTrend: string;
      hasExternalReference: boolean;
      similarMarkets?: number;
    };
    // Entertainment edge (RT scores, box office)
    entertainment?: {
      movieTitle: string;
      currentScore: number;
      threshold: number;
      scoreType: 'tomatometer' | 'audience';
      reviewCount?: number;
      buffer: number;  // currentScore - threshold
      sources: string[];
    };
  };
  sizing?: PositionSizing;
}

// =============================================================================
// SENTIMENT TYPES
// =============================================================================

export interface NewsArticle {
  source: string;
  title: string;
  description?: string;
  content?: string;
  url: string;
  published?: string;
  sentiment?: number;
  sentimentLabel?: 'bullish' | 'bearish' | 'neutral';
}

export interface TopicSentiment {
  topic: string;
  category: MarketCategory;
  articleCount: number;
  avgSentiment: number;
  sentimentLabel: 'bullish' | 'bearish' | 'neutral';
  minSentiment: number;
  maxSentiment: number;
  topArticles: NewsArticle[];
}

// =============================================================================
// WHALE TYPES
// =============================================================================

export interface Whale {
  name: string;
  twitter?: string;
  wallet?: string;  // Polymarket wallet address for on-chain tracking
  platform: 'polymarket' | 'kalshi';
  profit: number;
  specialty: string[];
  description?: string;
}

export interface WhaleSignal {
  whale: string;
  whaleProfit: number;
  text: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  tickersMentioned: string[];
  timestamp?: string;
  specialty: string[];
}

// =============================================================================
// POSITION SIZING TYPES
// =============================================================================

export interface PositionSizing {
  direction: 'BUY YES' | 'BUY NO';
  positionSize: number;
  kellyFraction: number;
  adjustedKelly: number;
  edge: number;
  confidence: number;
  maxLoss: number;
}

// =============================================================================
// CONFIG TYPES
// =============================================================================

export interface Config {
  // Discord
  discordWebhookUrl: string;
  discordBotToken: string;

  // Kalshi
  kalshiApiKeyId?: string;
  kalshiPrivateKey?: string;

  // APIs
  newsApiKey?: string;
  oddsApiKey?: string;

  // Trading
  bankroll: number;
  maxPositionPct: number;
  minEdgeThreshold: number;
  minConfidence: number;

  // Schedule
  timezone: string;
  schedule: { hour: number; minute: number }[];
}

export interface TopicConfig {
  keywords: string[];
  category: MarketCategory;
}

// =============================================================================
// ORDERBOOK TYPES (from dr-manhattan)
// =============================================================================

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp?: number;
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export * from './economic.js';
export * from './edge.js';
export * from './meta-edge.js';
