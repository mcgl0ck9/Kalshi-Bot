/**
 * Economic Indicator Types
 *
 * Types for macro economic data used to find edge in Kalshi markets:
 * - Fed rate decisions
 * - CPI/Inflation
 * - Jobs reports
 * - GDP
 */

// =============================================================================
// BASE TYPES
// =============================================================================

export interface EconomicIndicator {
  name: string;
  value: number;
  previousValue?: number;
  change?: number;
  asOfDate: string;
  nextUpdate?: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

// =============================================================================
// FED RATE TYPES
// =============================================================================

export interface FedRateProbability {
  rate: number;           // Target rate (e.g., 4.25, 4.50, 4.75)
  probability: number;    // 0-1 probability
}

export interface FedMeetingProbabilities {
  meetingDate: string;           // YYYY-MM-DD
  meetingName: string;           // e.g., "January 2025 FOMC"
  currentRate: number;           // Current Fed Funds rate
  probabilities: FedRateProbability[];
  impliedRate: number;           // Probability-weighted expected rate
  impliedCut: number;            // Expected bps change (negative = cut)
  probCut: number;               // P(rate lower than current)
  probHold: number;              // P(rate same as current)
  probHike: number;              // P(rate higher than current)
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface FedWatchData {
  currentRate: number;
  meetings: FedMeetingProbabilities[];
  nextMeeting: FedMeetingProbabilities | null;
  yearEndImpliedRate: number;
  totalCutsImplied: number;      // Implied cuts by year end (in 25bp increments)
  source: string;
  fetchedAt: string;
}

// =============================================================================
// INFLATION TYPES
// =============================================================================

export interface InflationNowcast {
  // Current estimates
  currentMonthCPI: number;       // Month-over-month CPI estimate
  yearOverYearCPI: number;       // Year-over-year CPI estimate
  coreCPI?: number;              // Core CPI (ex food/energy)

  // Previous readings
  previousMonthCPI?: number;
  previousYoYCPI?: number;

  // Components (if available)
  components?: {
    food?: number;
    energy?: number;
    shelter?: number;
    core?: number;
  };

  // Confidence interval
  confidence?: {
    low: number;
    high: number;
  };

  // Metadata
  forecastMonth: string;         // Which month this forecasts (e.g., "December 2024")
  source: string;
  sourceUrl: string;
  asOfDate: string;
  nextUpdate?: string;
  fetchedAt: string;
}

export interface InflationData {
  clevelandFed?: InflationNowcast;
  truflation?: InflationNowcast;
  breakevens?: {
    fiveYear: number;
    tenYear: number;
  };
  consensusEstimate?: number;
  aggregatedEstimate: number;    // Our best estimate combining sources
  confidence: number;            // 0-1 confidence in estimate
  fetchedAt: string;
}

// =============================================================================
// JOBS TYPES
// =============================================================================

export interface JobsIndicator {
  type: 'adp' | 'initial_claims' | 'continuing_claims' | 'nfp' | 'ism_employment' | 'jolts';
  value: number;
  previousValue: number;
  change: number;
  changePercent: number;
  surprise?: number;             // Actual - Consensus expectation
  consensusEstimate?: number;
  period: string;                // e.g., "December 2024" or "Week of Dec 21"

  // For claims (weekly data)
  fourWeekAverage?: number;
  previousFourWeekAverage?: number;

  source: string;
  sourceUrl: string;
  releaseDate: string;
  fetchedAt: string;
}

export interface JobsData {
  // Leading indicators
  adp?: JobsIndicator;
  initialClaims?: JobsIndicator;
  continuingClaims?: JobsIndicator;
  ismEmployment?: JobsIndicator;
  jolts?: JobsIndicator;

  // Official (lagging)
  nfp?: JobsIndicator;
  unemploymentRate?: number;

  // Our prediction
  nfpPrediction?: {
    estimate: number;
    confidence: {
      low: number;
      high: number;
    };
    direction: 'strong' | 'moderate' | 'weak';
    reasoning: string;
  };

  fetchedAt: string;
}

// =============================================================================
// GDP TYPES
// =============================================================================

export interface GDPNowcast {
  quarter: string;               // e.g., "Q4 2024"
  estimate: number;              // GDP growth rate (annualized)
  previousEstimate?: number;

  // Components
  components?: {
    personalConsumption?: number;
    grossPrivateInvestment?: number;
    netExports?: number;
    governmentSpending?: number;
  };

  // Model details
  modelVersion?: string;
  contributingIndicators?: string[];

  source: string;
  sourceUrl: string;
  asOfDate: string;
  nextUpdate?: string;
  fetchedAt: string;
}

export interface GDPData {
  atlantaFed?: GDPNowcast;
  nyFed?: GDPNowcast;
  consensusEstimate?: number;
  aggregatedEstimate: number;
  confidence: number;
  fetchedAt: string;
}

// =============================================================================
// MACRO EDGE TYPES
// =============================================================================

export interface MacroEdgeSignal {
  // Market info
  marketId: string;
  marketTitle: string;
  marketPlatform: 'kalshi' | 'polymarket';
  marketPrice: number;           // Current market price (0-1)
  marketUrl: string;

  // Indicator info
  indicatorType: 'fed' | 'cpi' | 'jobs' | 'gdp';
  indicatorName: string;
  indicatorValue: number;
  indicatorSource: string;

  // Edge calculation
  impliedProbability: number;    // What indicator suggests prob should be
  edge: number;                  // impliedProbability - marketPrice
  edgePercent: number;           // Edge as percentage

  // Confidence
  confidence: number;            // 0-1 confidence in signal
  signalStrength: 'strong' | 'moderate' | 'weak';

  // Action
  direction: 'buy_yes' | 'buy_no' | 'hold';
  reasoning: string;

  // Risk
  maxLoss: number;               // If wrong (0 or 1 - entry)
  expectedValue: number;         // edge × confidence
  kellySize?: number;            // Optimal position size

  fetchedAt: string;
}

// =============================================================================
// ECONOMIC CALENDAR
// =============================================================================

export interface EconomicEvent {
  name: string;
  date: string;                  // YYYY-MM-DD
  time?: string;                 // HH:MM ET
  importance: 'high' | 'medium' | 'low';
  category: 'fed' | 'inflation' | 'jobs' | 'gdp' | 'other';
  previousValue?: number;
  consensusEstimate?: number;
  actualValue?: number;

  // Related Kalshi markets
  relatedMarkets?: string[];
}

export interface EconomicCalendar {
  events: EconomicEvent[];
  nextHighImpact?: EconomicEvent;
  fetchedAt: string;
}

// =============================================================================
// RECESSION INDICATORS
// =============================================================================

export interface RecessionIndicator {
  name: string;
  value: number;
  threshold: number;             // Value that signals recession
  isTriggered: boolean;
  historicalAccuracy: number;    // How often this predicted recession correctly
  leadTime?: number;             // Average months before recession
  source: string;
  asOfDate: string;
}

export interface RecessionData {
  indicators: RecessionIndicator[];

  // Key indicators
  yieldCurve?: {
    twoTen: number;              // 2Y-10Y spread
    threeMonthTen: number;       // 3M-10Y spread
    isInverted: boolean;
    daysInverted: number;
  };

  sahmRule?: {
    value: number;
    triggered: boolean;
  };

  leadingIndex?: {
    value: number;
    monthsNegative: number;
  };

  // Aggregate probability
  recessionProbability: number;  // Combined indicator estimate
  timeframe: string;             // e.g., "next 12 months"

  fetchedAt: string;
}
