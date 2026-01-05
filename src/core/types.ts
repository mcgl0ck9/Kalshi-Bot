/**
 * Core Types for Kalshi Edge Detector v4.0
 *
 * Unified type definitions for the plugin-based architecture.
 * All data sources, processors, and edge detectors implement these interfaces.
 */

// =============================================================================
// MARKET TYPES
// =============================================================================

export type Category =
  | 'sports'
  | 'crypto'
  | 'macro'
  | 'politics'
  | 'entertainment'
  | 'health'
  | 'weather'
  | 'other';

export interface Market {
  platform: 'kalshi' | 'polymarket';
  id: string;
  ticker?: string;
  title: string;
  subtitle?: string;
  category: Category;
  price: number;           // YES price as decimal (0-1)
  volume?: number;
  liquidity?: number;
  url: string;
  closeTime?: string;
}

// =============================================================================
// EDGE TYPES
// =============================================================================

export type Direction = 'YES' | 'NO';
export type Urgency = 'critical' | 'standard' | 'low';

export interface Edge {
  market: Market;
  direction: Direction;
  edge: number;              // 0-1 (e.g., 0.12 = 12% edge)
  confidence: number;        // 0-1
  urgency: Urgency;
  reason: string;            // Human-readable WHY
  signal: EdgeSignal;        // Raw signal data for display
  features?: FeatureVector;  // ML features (optional)
  mlScore?: number;          // ML-adjusted score (optional)
}

/**
 * Signal data attached to an edge.
 * Each detector can add its own signal type.
 */
export interface EdgeSignal {
  type: string;              // Detector name (e.g., 'cross-platform', 'sentiment')
  [key: string]: unknown;    // Detector-specific data
}

/**
 * Feature vector for ML scoring.
 * Standardized features that ML models can use.
 */
export interface FeatureVector {
  // Edge features
  edgeSize: number;
  confidence: number;
  urgency: number;           // 0=low, 1=standard, 2=critical

  // Market features
  price: number;
  daysToExpiry?: number;
  volume?: number;
  liquidity?: number;

  // Signal features
  signalCount: number;
  hasWhaleSignal: boolean;
  hasSentimentSignal: boolean;
  hasCrossPlatformSignal: boolean;

  // Category (one-hot encoded)
  category: Category;

  // Custom features from processors
  [key: string]: unknown;
}

// =============================================================================
// DATA SOURCE TYPES
// =============================================================================

/**
 * Configuration for defining a data source.
 * Use `defineSource()` helper to create sources.
 */
export interface SourceConfig<T = unknown> {
  /** Unique identifier for this source */
  name: string;

  /** Category for routing/filtering */
  category: Category;

  /** Cache TTL in seconds (default: 300 = 5 min) */
  cacheTTL?: number;

  /** Whether this source requires authentication */
  requiresAuth?: boolean;

  /** Fetch function that returns the data */
  fetch: () => Promise<T>;
}

/**
 * A registered data source with metadata.
 */
export interface DataSource<T = unknown> extends SourceConfig<T> {
  /** Last fetch timestamp */
  lastFetch?: number;

  /** Cached data */
  cachedData?: T;
}

// =============================================================================
// PROCESSOR TYPES (NEW - for NLP, ML features, enrichment)
// =============================================================================

/**
 * Processors transform/enrich data between sources and detectors.
 * Use cases:
 * - NLP/sentiment analysis on text
 * - Feature extraction for ML
 * - Data normalization
 * - Transcript parsing
 */
export interface ProcessorConfig<TInput = unknown, TOutput = unknown> {
  /** Unique identifier */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Input source(s) this processor reads from */
  inputSources: string[];

  /** Output key in SourceData (defaults to processor name) */
  outputKey?: string;

  /** Process function */
  process: (inputs: Record<string, TInput>) => Promise<TOutput>;
}

export interface Processor<TInput = unknown, TOutput = unknown> extends ProcessorConfig<TInput, TOutput> {
  lastRun?: number;
  avgRunTime?: number;
}

// =============================================================================
// ML SCORER TYPES (NEW - for ML-based edge scoring)
// =============================================================================

/**
 * ML Scorer adjusts edge confidence based on trained models.
 */
export interface MLScorerConfig {
  /** Unique identifier */
  name: string;

  /** Path to model file or model identifier */
  modelPath?: string;

  /** Whether to use this scorer */
  enabled: boolean;

  /** Score function: takes edges, returns edges with mlScore */
  score: (edges: Edge[]) => Promise<Edge[]>;

  /** Optional: train from historical data */
  train?: (historicalEdges: HistoricalEdge[]) => Promise<void>;
}

export interface HistoricalEdge {
  edge: Edge;
  outcome: 'win' | 'loss' | 'push';
  settledAt: number;
  profit: number;
}

// =============================================================================
// TEXT ANALYSIS TYPES (NEW - for earnings, transcripts, filings)
// =============================================================================

/**
 * Analyzed text with sentiment and extracted entities.
 */
export interface AnalyzedText {
  source: string;            // e.g., 'earnings-transcript', 'edgar-10k'
  rawText: string;
  sentiment: number;         // -1 to 1
  keywords: KeywordMatch[];
  entities: Entity[];
  summary?: string;
}

export interface KeywordMatch {
  keyword: string;
  count: number;
  context: string[];         // Surrounding sentences
  sentiment: number;         // Sentiment when keyword appears
}

export interface Entity {
  type: 'company' | 'person' | 'metric' | 'date' | 'money';
  value: string;
  normalized?: string;       // e.g., "$1.5B" -> 1500000000
}

/**
 * Earnings call data structure.
 */
export interface EarningsCall {
  company: string;
  ticker: string;
  date: string;
  quarter: string;
  preparedRemarks: AnalyzedText;
  qaSection: AnalyzedText;
  keyMetrics: Record<string, number>;
  guidance?: {
    metric: string;
    value: number;
    vsConsensus: number;      // Percentage vs analyst consensus
  }[];
}

/**
 * EDGAR filing data structure.
 */
export interface EdgarFiling {
  company: string;
  ticker: string;
  filingType: '10-K' | '10-Q' | '8-K' | 'S-1';
  filedDate: string;
  periodEnd: string;
  sections: Record<string, AnalyzedText>;
  financials?: {
    revenue: number;
    netIncome: number;
    eps: number;
    guidance?: string;
  };
}

// =============================================================================
// EDGE DETECTOR TYPES
// =============================================================================

/**
 * Data provided to detectors from sources and processors.
 * Keys are source/processor names, values are the data.
 */
export type SourceData = Record<string, unknown>;

/**
 * Configuration for defining an edge detector.
 * Use `defineDetector()` helper to create detectors.
 */
export interface DetectorConfig {
  /** Unique identifier for this detector */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Which data sources/processors this detector needs */
  sources: string[];

  /** Whether this detector is enabled (default: true) */
  enabled?: boolean;

  /** Minimum edge threshold to report (default: 0.03) */
  minEdge?: number;

  /** Detect function that analyzes data and returns edges */
  detect: (data: SourceData, markets: Market[]) => Promise<Edge[]>;
}

/**
 * A registered edge detector with metadata.
 */
export interface EdgeDetector extends DetectorConfig {
  /** Number of edges found in last run */
  lastEdgeCount?: number;

  /** Last run timestamp */
  lastRun?: number;

  /** Average run time in ms */
  avgRunTime?: number;
}

// =============================================================================
// PIPELINE TYPES
// =============================================================================

export interface PipelineConfig {
  /** Minimum edge to include in results */
  minEdge?: number;

  /** Whether to run ML scoring */
  enableML?: boolean;

  /** Categories to include (empty = all) */
  categories?: Category[];

  /** Specific detectors to run (empty = all enabled) */
  detectors?: string[];
}

export interface PipelineResult {
  edges: Edge[];
  stats: PipelineStats;
  errors: PipelineError[];
}

export interface PipelineStats {
  totalEdges: number;
  byCategory: Record<Category, number>;
  byDetector: Record<string, number>;
  sourceFetchTime: number;
  processorRunTime: number;
  detectorRunTime: number;
  mlScoringTime: number;
  totalTime: number;
}

export interface PipelineError {
  source: string;            // Source, processor, or detector name
  error: string;
  timestamp: number;
}

// =============================================================================
// STORAGE TYPES (NEW - for tracking predictions)
// =============================================================================

export interface Prediction {
  id: string;
  edge: Edge;
  createdAt: number;
  status: 'pending' | 'won' | 'lost' | 'expired';
  settledAt?: number;
  profit?: number;
}

export interface CalibrationStats {
  totalPredictions: number;
  wins: number;
  losses: number;
  winRate: number;
  avgEdge: number;
  avgProfit: number;
  brierScore: number;
  byCategory: Record<Category, { wins: number; losses: number; winRate: number }>;
  byDetector: Record<string, { wins: number; losses: number; winRate: number }>;
}

// =============================================================================
// OUTPUT TYPES
// =============================================================================

export interface AlertConfig {
  channel: string;
  minEdge?: number;
  minConfidence?: number;
  minMLScore?: number;
  categories?: Category[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Define a data source with type safety.
 */
export function defineSource<T>(config: SourceConfig<T>): DataSource<T> {
  return {
    cacheTTL: 300,  // Default 5 min cache
    ...config,
  };
}

/**
 * Define a processor with type safety.
 */
export function defineProcessor<TInput, TOutput>(
  config: ProcessorConfig<TInput, TOutput>
): Processor<TInput, TOutput> {
  return {
    outputKey: config.name,
    ...config,
  };
}

/**
 * Define an edge detector with type safety.
 */
export function defineDetector(config: DetectorConfig): EdgeDetector {
  return {
    enabled: true,
    minEdge: 0.03,
    ...config,
  };
}

/**
 * Create an edge with defaults.
 */
export function createEdge(
  market: Market,
  direction: Direction,
  edge: number,
  confidence: number,
  reason: string,
  signal: EdgeSignal
): Edge {
  return {
    market,
    direction,
    edge,
    confidence,
    urgency: edge >= 0.15 ? 'critical' : edge >= 0.08 ? 'standard' : 'low',
    reason,
    signal,
  };
}

/**
 * Extract basic features from an edge for ML.
 */
export function extractFeatures(edge: Edge): FeatureVector {
  const daysToExpiry = edge.market.closeTime
    ? Math.max(0, (new Date(edge.market.closeTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;

  return {
    edgeSize: edge.edge,
    confidence: edge.confidence,
    urgency: edge.urgency === 'critical' ? 2 : edge.urgency === 'standard' ? 1 : 0,
    price: edge.market.price,
    daysToExpiry,
    volume: edge.market.volume,
    liquidity: edge.market.liquidity,
    signalCount: 1,  // Base count, processors can enhance
    hasWhaleSignal: edge.signal.type === 'whale',
    hasSentimentSignal: edge.signal.type === 'sentiment',
    hasCrossPlatformSignal: edge.signal.type === 'cross-platform',
    category: edge.market.category,
  };
}
