/**
 * Plugin Registry for Kalshi Edge Detector v4.0
 *
 * Central registry for data sources and edge detectors.
 * Provides automatic discovery and dependency resolution.
 */

import type { DataSource, EdgeDetector, Processor, Category, SourceData } from './types.js';
import { logger } from '../utils/index.js';

// =============================================================================
// REGISTRY STATE
// =============================================================================

const sources = new Map<string, DataSource>();
const detectors = new Map<string, EdgeDetector>();
const processors = new Map<string, Processor>();

// =============================================================================
// SOURCE REGISTRATION
// =============================================================================

/**
 * Register a data source.
 */
export function registerSource<T>(source: DataSource<T>): void {
  if (sources.has(source.name)) {
    logger.warn(`Source "${source.name}" already registered, overwriting`);
  }
  sources.set(source.name, source as DataSource);
  logger.debug(`Registered source: ${source.name}`);
}

/**
 * Get a registered source by name.
 */
export function getSource<T = unknown>(name: string): DataSource<T> | undefined {
  return sources.get(name) as DataSource<T> | undefined;
}

/**
 * Get all registered sources.
 */
export function getAllSources(): DataSource[] {
  return Array.from(sources.values());
}

/**
 * Get sources by category.
 */
export function getSourcesByCategory(category: Category): DataSource[] {
  return Array.from(sources.values()).filter(s => s.category === category);
}

// =============================================================================
// DETECTOR REGISTRATION
// =============================================================================

/**
 * Register an edge detector.
 */
export function registerDetector(detector: EdgeDetector): void {
  if (detectors.has(detector.name)) {
    logger.warn(`Detector "${detector.name}" already registered, overwriting`);
  }

  // Validate that required sources exist
  for (const sourceName of detector.sources) {
    if (!sources.has(sourceName)) {
      logger.warn(`Detector "${detector.name}" requires unknown source "${sourceName}"`);
    }
  }

  detectors.set(detector.name, detector);
  logger.debug(`Registered detector: ${detector.name} (sources: ${detector.sources.join(', ')})`);
}

/**
 * Get a registered detector by name.
 */
export function getDetector(name: string): EdgeDetector | undefined {
  return detectors.get(name);
}

/**
 * Get all registered detectors.
 */
export function getAllDetectors(): EdgeDetector[] {
  return Array.from(detectors.values());
}

/**
 * Get enabled detectors only.
 */
export function getEnabledDetectors(): EdgeDetector[] {
  return Array.from(detectors.values()).filter(d => d.enabled !== false);
}

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Fetch data from a source, using cache if available.
 */
export async function fetchSource<T>(name: string): Promise<T | null> {
  const source = sources.get(name) as DataSource<T> | undefined;
  if (!source) {
    logger.warn(`Source "${name}" not found`);
    return null;
  }

  const now = Date.now();
  const cacheTTL = (source.cacheTTL ?? 300) * 1000; // Convert to ms

  // Check cache
  if (source.cachedData && source.lastFetch && (now - source.lastFetch) < cacheTTL) {
    logger.debug(`Using cached data for ${name} (age: ${Math.round((now - source.lastFetch) / 1000)}s)`);
    return source.cachedData;
  }

  // Fetch fresh data
  try {
    const data = await source.fetch();
    source.cachedData = data;
    source.lastFetch = now;
    return data;
  } catch (error) {
    logger.error(`Failed to fetch source "${name}": ${error}`);
    // Return stale cache if available
    if (source.cachedData) {
      logger.warn(`Returning stale cache for ${name}`);
      return source.cachedData;
    }
    return null;
  }
}

/**
 * Fetch data from multiple sources in parallel.
 */
export async function fetchSources(names: string[]): Promise<SourceData> {
  const results: SourceData = {};

  await Promise.all(
    names.map(async (name) => {
      const data = await fetchSource(name);
      if (data !== null) {
        results[name] = data;
      }
    })
  );

  return results;
}

/**
 * Fetch all registered sources in parallel.
 */
export async function fetchAllSources(): Promise<SourceData> {
  return fetchSources(Array.from(sources.keys()));
}

// =============================================================================
// PROCESSOR REGISTRATION
// =============================================================================

/**
 * Register a processor.
 */
export function registerProcessor<TIn, TOut>(processor: Processor<TIn, TOut>): void {
  if (processors.has(processor.name)) {
    logger.warn(`Processor "${processor.name}" already registered, overwriting`);
  }
  processors.set(processor.name, processor as Processor);
  logger.debug(`Registered processor: ${processor.name}`);
}

/**
 * Get a registered processor by name.
 */
export function getProcessor<TIn = unknown, TOut = unknown>(
  name: string
): Processor<TIn, TOut> | undefined {
  return processors.get(name) as Processor<TIn, TOut> | undefined;
}

/**
 * Get all registered processors.
 */
export function getAllProcessors(): Processor[] {
  return Array.from(processors.values());
}

/**
 * Run a processor with source data.
 */
export async function runProcessor<TOut>(
  name: string,
  sourceData: SourceData
): Promise<TOut | null> {
  const processor = processors.get(name);
  if (!processor) {
    logger.warn(`Processor "${name}" not found`);
    return null;
  }

  // Build inputs from source data
  const inputs: Record<string, unknown> = {};
  for (const sourceName of processor.inputSources) {
    if (sourceData[sourceName]) {
      inputs[sourceName] = sourceData[sourceName];
    }
  }

  try {
    const result = await processor.process(inputs);
    return result as TOut;
  } catch (error) {
    logger.error(`Processor "${name}" failed: ${error}`);
    return null;
  }
}

// =============================================================================
// REGISTRY INFO
// =============================================================================

/**
 * Get registry statistics.
 */
export function getRegistryStats(): {
  sourceCount: number;
  detectorCount: number;
  processorCount: number;
  enabledDetectors: number;
  sourcesByCategory: Record<Category, number>;
} {
  const sourcesByCategory: Record<string, number> = {};

  for (const source of sources.values()) {
    sourcesByCategory[source.category] = (sourcesByCategory[source.category] ?? 0) + 1;
  }

  return {
    sourceCount: sources.size,
    detectorCount: detectors.size,
    processorCount: processors.size,
    enabledDetectors: getEnabledDetectors().length,
    sourcesByCategory: sourcesByCategory as Record<Category, number>,
  };
}

/**
 * Clear all caches.
 */
export function clearAllCaches(): void {
  for (const source of sources.values()) {
    source.cachedData = undefined;
    source.lastFetch = undefined;
  }
  logger.info('Cleared all source caches');
}

/**
 * Reset registry (for testing).
 */
export function resetRegistry(): void {
  sources.clear();
  detectors.clear();
  logger.debug('Registry reset');
}
