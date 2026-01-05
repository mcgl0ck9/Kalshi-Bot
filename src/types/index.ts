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
  subtitle?: string;       // Kalshi outcome description (e.g., "$100K or above")
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
    weatherBias?: string;  // DEPRECATED: Use weather instead
    recencyBias?: boolean;
    // City weather edge with full evidence
    weather?: {
      city: string;
      measurementType: 'snow' | 'rain' | 'temperature';
      threshold: number;
      unit: string;
      bucket?: string;              // e.g., "4-8 inches" for range markets
      ticker?: string;              // Exact ticker for this bucket
      // Evidence data (the WHY)
      monthToDate: number;          // Current accumulation
      daysRemaining: number;        // Days left in month
      historicalAverage: number;    // 30-year NOAA average
      historicalStdDev: number;     // Standard deviation
      // Probability analysis
      climatologicalProb: number;   // Our estimate based on data
      marketPrice: number;          // What Kalshi is pricing
      // Forecast data (if available)
      forecast?: {
        source: string;             // e.g., "NWS Chicago"
        expectedRemaining: number;  // Expected remaining accumulation
        confidence: string;         // e.g., "high", "medium", "low"
      };
      // Other buckets in this series (for grouping)
      allBuckets?: Array<{
        threshold: number;
        bucket: string;
        ticker: string;
        price: number;
        edge: number;
      }>;
    };
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
      weekNumber?: number;
      lastYearTotal?: number;
      reasoning?: string;
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
    // Player prop edge (individual player stats)
    playerProp?: {
      playerName: string;
      propType: string;      // 'Passing Yards', 'Points', etc.
      line: number;          // The over/under line
      isOver: boolean;
      consensusProb: number;
      reasoning: string;
    };
    // Line movement edge (steam moves, opening value)
    lineMove?: {
      moveType: 'steam' | 'reverse' | 'drift' | 'opening_value';
      direction: 'home' | 'away';
      magnitude: number;
      timeframeMinutes: number;
      previousProb: number;
      currentProb: number;
      openingProb?: number;
      reasoning: string;
    };
    // ESPN odds edge (P0 data source)
    espnOdds?: {
      homeTeam: string;
      awayTeam: string;
      homeSpread: number;
      homeMoneyline: number;
      awayMoneyline: number;
      espnImpliedProb: number;
      reasoning: string;
    };
    // CDC wastewater edge (P0 data source)
    wastewater?: {
      pathogen?: string;
      currentLevel: string;
      projectedLevel: string;
      leadDays: number;
      reasoning: string;
    };
    // Crypto funding rate edge (P0 data source)
    cryptoFunding?: {
      symbol: string;
      fundingRate?: number;
      openInterest?: number;
      signalType: string;
      reasoning: string;
    };
    // Fear & Greed Index edge (P0 data source)
    fearGreed?: {
      value: number;
      classification: string;
      reasoning: string;
    };
    // GDP nowcast edge (P0 data source)
    gdpNow?: {
      estimate: number;
      quarter: string;
      impliedProb: number;
      reasoning: string;
    };
    // Inflation nowcast edge (P0 data source)
    inflationNow?: {
      headline: number;
      month: string;
      impliedProb: number;
      reasoning: string;
    };
    // Time decay / theta (options-style pricing)
    timeDecay?: {
      daysToExpiry: number;
      hoursToExpiry: number;
      theta: number;              // 0-1, decay factor
      thetaPerDay: number;        // Daily decay rate
      urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
      adjustedEdge: number;       // Edge after theta adjustment
      recommendedOrderType: 'limit' | 'market';
      limitOrderSuggestion?: {
        price: number;
        fillProbability: number;
        estimatedFillTime: string;
      };
      reasoning: string;
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
