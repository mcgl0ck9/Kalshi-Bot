/**
 * Core Module Exports for Kalshi Edge Detector v4.0
 *
 * This is the main entry point for the core framework.
 */

// Types
export type {
  Category,
  Market,
  Direction,
  Urgency,
  Edge,
  EdgeSignal,
  FeatureVector,
  SourceConfig,
  DataSource,
  SourceData,
  ProcessorConfig,
  Processor,
  DetectorConfig,
  EdgeDetector,
  MLScorerConfig,
  AnalyzedText,
  KeywordMatch,
  Entity,
  EarningsCall,
  EdgarFiling,
  PipelineConfig,
  PipelineResult,
  PipelineStats,
  PipelineError,
  Prediction,
  CalibrationStats,
  AlertConfig,
} from './types.js';

// Type helpers
export {
  defineSource,
  defineProcessor,
  defineDetector,
  createEdge,
  extractFeatures,
} from './types.js';

// Registry
export {
  registerSource,
  registerDetector,
  registerProcessor,
  getSource,
  getDetector,
  getProcessor,
  getAllSources,
  getAllDetectors,
  getAllProcessors,
  getEnabledDetectors,
  getSourcesByCategory,
  fetchSource,
  fetchSources,
  fetchAllSources,
  runProcessor,
  getRegistryStats,
  clearAllCaches,
  resetRegistry,
} from './registry.js';

// Pipeline
export {
  runPipeline,
  runCriticalOnly,
  runForCategory,
} from './pipeline.js';

// Cache
export * as cache from './cache.js';
