/**
 * Meta Edge Types
 *
 * Types for advanced edge detection:
 * - Multi-channel Discord routing
 * - New market detection
 * - Options-implied probabilities
 * - Calibration tracking
 */

// =============================================================================
// DISCORD CHANNEL ROUTING
// =============================================================================

export type DiscordChannel =
  | 'sports'            // NFL, NBA, MLB, NHL, NCAAF, NCAAB
  | 'weather'           // Temperature, precipitation, climate
  | 'economics'         // Fed rates, CPI, Jobs, GDP
  | 'mentions'          // Fed speech keywords, earnings mentions
  | 'entertainment'     // Movies, RT scores, box office, awards
  | 'health'            // Measles, disease tracking
  | 'politics'          // Elections, government, policy
  | 'crypto'            // Bitcoin, Ethereum, crypto markets
  | 'digest'            // Daily summary
  | 'status';           // System health

export interface ChannelConfig {
  name: DiscordChannel;
  webhookUrl: string;
  enabled: boolean;
  minEdge?: number;      // Minimum edge to post
  minConfidence?: number; // Minimum confidence to post
}

export interface RoutedAlert {
  channel: DiscordChannel;
  priority: 'critical' | 'high' | 'normal' | 'low';
  content: string;
  embeds?: Array<Record<string, unknown>>;
  timestamp: string;
}

// =============================================================================
// NEW MARKET DETECTION
// =============================================================================

export interface NewMarket {
  market: {
    id: string;
    platform: 'kalshi' | 'polymarket';
    title: string;
    category: string;
    price: number;
    volume: number;
    url: string;
  };
  detectedAt: string;
  ageMinutes: number;

  // Analysis
  hasExternalReference: boolean;
  externalEstimate?: number;       // From options, polls, etc.
  potentialEdge?: number;

  // Liquidity assessment
  currentLiquidity: number;
  liquidityTrend: 'increasing' | 'stable' | 'decreasing';
  earlyMoverAdvantage: 'high' | 'medium' | 'low';

  // Similar markets
  similarMarkets?: {
    platform: string;
    id: string;
    title: string;
    price: number;
    similarity: number;
  }[];
}

export interface MarketSnapshot {
  marketId: string;
  platform: 'kalshi' | 'polymarket';
  firstSeenAt: string;
  priceHistory: { timestamp: string; price: number }[];
  volumeHistory: { timestamp: string; volume: number }[];
}

// =============================================================================
// OPTIONS-IMPLIED PROBABILITIES
// =============================================================================

export interface FedFundsImplied {
  meetingDate: string;
  currentTarget: { lower: number; upper: number };
  impliedRate: number;

  // Probability distribution
  probabilities: {
    rate: number;           // Target rate
    probability: number;    // Implied probability
  }[];

  // Summary
  probCut25: number;        // P(cut 25bp)
  probCut50: number;        // P(cut 50bp+)
  probHold: number;         // P(no change)
  probHike25: number;       // P(hike 25bp)
  probHike50: number;       // P(hike 50bp+)

  // Comparison to Kalshi
  kalshiComparison?: {
    marketId: string;
    marketTitle: string;
    kalshiPrice: number;
    impliedPrice: number;
    edge: number;
  };

  source: 'cme' | 'treasury' | 'calculated';
  fetchedAt: string;
}

export interface SPXImplied {
  expirationDate: string;
  currentPrice: number;

  // Probability of levels
  probabilities: {
    level: number;
    probAbove: number;
    probBelow: number;
  }[];

  // Recession proxy (SPX down >20%)
  probDown10: number;
  probDown20: number;       // Recession proxy
  probDown30: number;

  // VIX integration
  vixCurrent: number;
  vixImpliedMove: number;   // Expected move from VIX

  fetchedAt: string;
}

export interface TreasuryImplied {
  // Yield curve data
  yields: {
    tenor: '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | '10y' | '30y';
    yield: number;
  }[];

  // Inversion analysis
  curve2s10s: number;       // 10y - 2y spread
  curve3m10y: number;       // 10y - 3m spread
  isInverted: boolean;
  inversionDepth: number;

  // Recession probability from yield curve
  recessionProb12m: number; // NY Fed model style

  fetchedAt: string;
}

export interface OptionsImpliedData {
  fedFunds: FedFundsImplied | null;
  spx: SPXImplied | null;
  treasury: TreasuryImplied | null;
  aggregatedAt: string;
}

// =============================================================================
// CALIBRATION TRACKING
// =============================================================================

export interface CalibrationRecord {
  id: string;

  // Market info
  marketId: string;
  marketTitle: string;
  platform: 'kalshi' | 'polymarket';
  category: string;

  // Our prediction
  predictedAt: string;
  ourEstimate: number;         // Our probability estimate
  marketPriceAtPrediction: number;
  edge: number;                // ourEstimate - marketPrice
  confidence: number;
  signalSources: string[];     // Which signals contributed

  // Resolution
  resolvedAt?: string;
  actualOutcome?: boolean;     // true = YES, false = NO
  marketPriceAtResolution?: number;

  // Performance metrics (calculated after resolution)
  wasCorrectDirection?: boolean;  // Did we predict the right direction?
  brierContribution?: number;     // (estimate - outcome)^2
  profitLoss?: number;            // Simulated P&L
}

export interface CalibrationBucket {
  range: string;              // e.g., "60-70%"
  lowerBound: number;
  upperBound: number;
  count: number;
  outcomes: number;           // How many resolved YES
  actualFrequency: number;    // outcomes / count
  calibrationError: number;   // |midpoint - actualFrequency|
}

export interface CalibrationReport {
  // Overall metrics
  totalPredictions: number;
  resolvedPredictions: number;
  pendingPredictions: number;

  // Accuracy
  brierScore: number;          // Lower is better, 0 = perfect
  accuracy: number;            // % correct direction

  // Calibration
  buckets: CalibrationBucket[];
  overallCalibrationError: number;
  isOverconfident: boolean;

  // By category
  categoryMetrics: Map<string, {
    count: number;
    brierScore: number;
    accuracy: number;
  }>;

  // By signal source
  signalMetrics: Map<string, {
    count: number;
    brierScore: number;
    accuracy: number;
  }>;

  // Trend
  recentPerformance: {
    period: string;
    brierScore: number;
    accuracy: number;
  }[];

  generatedAt: string;
}

// =============================================================================
// META EDGE AGGREGATION
// =============================================================================

export interface MetaEdgeSignal {
  marketId: string;
  marketTitle: string;
  platform: 'kalshi' | 'polymarket';
  category: string;
  currentPrice: number;
  url: string;

  // Signal components
  optionsImplied?: {
    source: 'fed_funds' | 'spx' | 'treasury';
    impliedProbability: number;
    edge: number;
    confidence: number;
  };

  calibrationAdjustment?: {
    historicalBias: number;      // How much market typically off
    adjustedEstimate: number;
    confidence: number;
  };

  newMarketBonus?: {
    ageMinutes: number;
    earlyMoverEdge: number;
    confidence: number;
  };

  // Aggregated
  metaEdge: number;              // Combined edge estimate
  metaConfidence: number;
  direction: 'buy_yes' | 'buy_no';

  reasoning: string;
  generatedAt: string;
}
