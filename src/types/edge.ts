/**
 * Edge Detection Types
 *
 * Types for the meta-edge framework:
 * - Signal aggregation
 * - Base rate analysis
 * - Cross-platform arbitrage
 * - Confidence scoring
 */

// =============================================================================
// SIGNAL TYPES
// =============================================================================

export type SignalSource =
  | 'fed_watch'
  | 'cpi_nowcast'
  | 'gdp_nowcast'
  | 'jobs_leading'
  | 'polling'
  | 'whale_activity'
  | 'cross_platform'
  | 'sentiment'
  | 'exchange_flows'
  | 'funding_rates'
  | 'options_data'
  | 'base_rate'
  | 'historical_analog';

export interface Signal {
  source: SignalSource;
  name: string;
  value: number;                 // Normalized 0-1 (probability)
  rawValue?: number;             // Original value before normalization
  confidence: number;            // 0-1 confidence in this signal
  weight: number;                // Weight in aggregation (based on track record)
  freshness: number;             // 0-1, decays with age
  timestamp: string;             // When signal was generated
  metadata?: Record<string, unknown>;
}

export interface SignalCorrelation {
  source1: SignalSource;
  source2: SignalSource;
  correlation: number;           // -1 to 1
  sampleSize: number;
  period: string;                // e.g., "30 days"
}

// =============================================================================
// AGGREGATION TYPES
// =============================================================================

export interface AggregatedSignal {
  marketId: string;
  marketTitle: string;

  // Individual signals
  signals: Signal[];

  // Aggregated result
  aggregatedValue: number;       // Combined probability estimate
  aggregatedConfidence: number;  // Overall confidence

  // Agreement metrics
  signalAgreement: number;       // 0-1, how much signals agree
  disagreementSources: string[]; // Which signals disagree most

  // Ensemble boost
  ensembleBoost: number;         // Confidence boost from agreement

  // Final recommendation
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  reasoning: string;

  generatedAt: string;
}

export interface SignalWeight {
  source: SignalSource;
  baseWeight: number;            // Starting weight
  accuracyAdjustment: number;    // Based on historical accuracy
  recencyAdjustment: number;     // Based on how fresh
  correlationAdjustment: number; // Reduced if correlated with others
  finalWeight: number;           // Product of adjustments
}

// =============================================================================
// BASE RATE TYPES
// =============================================================================

export interface HistoricalOutcome {
  date: string;
  event: string;
  outcome: boolean;
  conditions: Record<string, number | string | boolean>;
  similarity?: number;           // Similarity to current conditions
}

export interface BaseRateAnalysis {
  event: string;                 // e.g., "Fed cuts rates"
  category: string;              // e.g., "fed", "inflation"

  // Simple base rate
  totalOccurrences: number;
  totalOpportunities: number;
  baseRate: number;              // occurrences / opportunities

  // Conditional base rate
  currentConditions: Record<string, number | string | boolean>;
  analogPeriods: HistoricalOutcome[];
  conditionalRate: number;       // Rate given similar conditions

  // Market comparison
  marketPrice: number;
  divergence: number;            // conditionalRate - marketPrice

  // Confidence
  sampleSize: number;
  confidence: number;            // Higher with more analogs

  analysisDate: string;
}

export interface HistoricalAnalog {
  period: string;                // e.g., "2019 Q4"
  description: string;
  similarity: number;            // 0-1 similarity to current
  outcome: boolean;
  keyFactors: string[];
  lessonLearned?: string;
}

// =============================================================================
// ARBITRAGE TYPES
// =============================================================================

export type ArbitrageType =
  | 'pure_price'                 // Same market, different prices
  | 'structural'                 // Platform structure creates opportunity
  | 'correlation'                // Related markets mispriced
  | 'temporal'                   // Different time horizons inconsistent
  | 'information';               // One market slower to price info

export interface ArbitrageOpportunity {
  type: ArbitrageType;
  description: string;

  // Markets involved
  market1: {
    platform: string;
    id: string;
    title: string;
    price: number;
    url: string;
  };
  market2?: {
    platform: string;
    id: string;
    title: string;
    price: number;
    url: string;
  };

  // Opportunity metrics
  priceDifference: number;       // Absolute difference
  percentDifference: number;     // Percentage difference
  theoreticalEdge: number;       // Expected profit
  confidence: number;            // Confidence this is real arb

  // Execution
  suggestedAction: string;       // e.g., "Buy Kalshi YES, Sell Poly YES"
  estimatedProfit: number;       // After fees
  fees: number;
  maxSize: number;               // Limited by liquidity

  // Risk
  risks: string[];
  riskLevel: 'low' | 'medium' | 'high';

  detectedAt: string;
  expiresAt?: string;            // When opportunity likely closes
}

export interface CorrelationArbitrage {
  // Related markets
  primaryMarket: {
    id: string;
    title: string;
    price: number;
  };
  relatedMarkets: {
    id: string;
    title: string;
    price: number;
    expectedCorrelation: number; // What correlation should be
    actualImplied: number;       // What prices imply
    divergence: number;
  }[];

  // Analysis
  mathematicalRelationship: string; // e.g., "P(A|B) × P(B) + P(A|~B) × P(~B)"
  impliedVsActual: number;
  opportunity: string;

  confidence: number;
  detectedAt: string;
}

// =============================================================================
// MICROSTRUCTURE TYPES
// =============================================================================

export interface MarketMicrostructure {
  marketId: string;
  platform: string;

  // Current state
  bestBid: number;
  bestAsk: number;
  spread: number;
  midPrice: number;

  // Depth
  bidDepth: number;              // Total size on bid side
  askDepth: number;              // Total size on ask side
  depthImbalance: number;        // (bid - ask) / (bid + ask)

  // Historical
  averageSpread: number;
  spreadPercentile: number;      // Current spread vs history
  volatility: number;            // Recent price movement

  // Patterns
  timeOfDayBias?: number;        // Avg price movement by hour
  dayOfWeekBias?: number;

  // Execution estimates
  estimatedSlippage: number;
  optimalOrderSize: number;

  analyzedAt: string;
}

// =============================================================================
// CONFIDENCE & CALIBRATION
// =============================================================================

export interface PredictionRecord {
  id: string;
  marketId: string;
  marketTitle: string;

  // Our prediction
  ourEstimate: number;           // 0-1 probability
  confidence: number;
  signals: SignalSource[];

  // Market price at prediction
  marketPriceAtPrediction: number;
  edge: number;

  // Resolution
  resolved: boolean;
  actualOutcome?: boolean;
  marketPriceAtResolution?: number;

  // Performance
  wasCorrect?: boolean;          // Did outcome match our estimate > 0.5?
  profitLoss?: number;           // Simulated P&L

  createdAt: string;
  resolvedAt?: string;
}

export interface CalibrationMetrics {
  // Brier score (lower is better, 0 is perfect)
  brierScore: number;

  // Calibration by bucket
  calibrationBuckets: {
    predictedRange: string;      // e.g., "60-70%"
    predictions: number;
    actualFrequency: number;     // How often outcome was true
    calibrationError: number;    // |predicted - actual|
  }[];

  // By signal source
  accuracyBySource: Map<SignalSource, number>;

  // Overconfidence analysis
  averageConfidence: number;
  averageAccuracy: number;
  overconfidenceFactor: number;  // confidence / accuracy

  // Sample info
  totalPredictions: number;
  period: string;
}

// =============================================================================
// COMPOSITE EDGE SCORE
// =============================================================================

export interface EdgeScore {
  marketId: string;
  marketTitle: string;
  platform: string;
  currentPrice: number;

  // Component scores (0-1, where 0.5 = neutral)
  signalScore: number;           // From aggregated signals
  baseRateScore: number;         // From historical analysis
  arbitrageScore: number;        // From cross-platform
  microstructureScore: number;   // From market structure

  // Composite
  compositeScore: number;        // Weighted combination
  compositeConfidence: number;

  // Recommendation
  direction: 'long' | 'short' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  suggestedSize: number;         // Kelly-based
  expectedValue: number;

  // Risk metrics
  maxDrawdown: number;
  sharpeEstimate: number;

  reasoning: string[];

  generatedAt: string;
}
