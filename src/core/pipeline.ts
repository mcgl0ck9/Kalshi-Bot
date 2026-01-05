/**
 * Simplified Pipeline for Kalshi Edge Detector v4.0
 *
 * The pipeline is now just ~200 lines instead of 2000+.
 * It simply:
 * 1. Fetches data from all registered sources
 * 2. Runs all enabled detectors
 * 3. Collects and returns edges
 */

import type {
  Edge,
  Market,
  PipelineResult,
  PipelineStats,
  PipelineError,
  Category,
  SourceData,
} from './types.js';
import {
  getAllSources,
  getEnabledDetectors,
  fetchSources,
  fetchSource,
} from './registry.js';
import { logger } from '../utils/index.js';

// =============================================================================
// PIPELINE EXECUTION
// =============================================================================

/**
 * Run the full edge detection pipeline.
 *
 * This is the main entry point. It:
 * 1. Fetches data from all registered sources
 * 2. Runs all enabled detectors in parallel
 * 3. Collects edges and returns results
 */
export async function runPipeline(): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: PipelineError[] = [];
  const allEdges: Edge[] = [];

  logger.info('=== Starting Edge Detection Pipeline ===');

  // Step 1: Fetch Kalshi markets (required for all detectors)
  logger.step(1, 'Fetching Kalshi markets...');
  const kalshiMarkets = await fetchSource<Market[]>('kalshi') ?? [];
  logger.info(`Fetched ${kalshiMarkets.length} Kalshi markets`);

  if (kalshiMarkets.length === 0) {
    logger.error('No Kalshi markets found, aborting pipeline');
    return {
      edges: [],
      stats: createEmptyStats(Date.now() - startTime),
      errors: [{ source: 'kalshi', error: 'No markets found', timestamp: Date.now() }],
    };
  }

  // Step 2: Fetch all other sources in parallel
  logger.step(2, 'Fetching data sources...');
  const sourceFetchStart = Date.now();

  const sourceNames = getAllSources()
    .filter(s => s.name !== 'kalshi')
    .map(s => s.name);

  const sourceData = await fetchSources(sourceNames);
  sourceData['kalshi'] = kalshiMarkets;

  const sourceFetchTime = Date.now() - sourceFetchStart;
  logger.info(`Fetched ${Object.keys(sourceData).length} sources in ${sourceFetchTime}ms`);

  // Step 3: Run all enabled detectors
  logger.step(3, 'Running edge detectors...');
  const detectorStart = Date.now();
  const detectors = getEnabledDetectors();

  const detectorResults = await Promise.allSettled(
    detectors.map(async (detector) => {
      const runStart = Date.now();

      try {
        // Check if detector has all required sources
        const missingSource = detector.sources.find(s => !(s in sourceData));
        if (missingSource) {
          logger.debug(`Skipping ${detector.name}: missing source "${missingSource}"`);
          return { name: detector.name, edges: [] as Edge[] };
        }

        // Run detector
        const edges = await detector.detect(sourceData, kalshiMarkets);

        // Filter by minimum edge threshold
        const minEdge = detector.minEdge ?? 0.03;
        const filteredEdges = edges.filter(e => e.edge >= minEdge);

        // Update detector stats
        detector.lastEdgeCount = filteredEdges.length;
        detector.lastRun = Date.now();
        detector.avgRunTime = Date.now() - runStart;

        if (filteredEdges.length > 0) {
          logger.info(`  ${detector.name}: ${filteredEdges.length} edges found`);
        }

        return { name: detector.name, edges: filteredEdges };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`  ${detector.name}: ERROR - ${errorMsg}`);
        errors.push({
          source: detector.name,
          error: errorMsg,
          timestamp: Date.now(),
        });
        return { name: detector.name, edges: [] as Edge[] };
      }
    })
  );

  // Collect all edges
  for (const result of detectorResults) {
    if (result.status === 'fulfilled' && result.value.edges.length > 0) {
      allEdges.push(...result.value.edges);
    }
  }

  const detectorRunTime = Date.now() - detectorStart;

  // Step 4: Sort and dedupe edges
  logger.step(4, 'Processing results...');
  const processedEdges = processEdges(allEdges);

  // Calculate stats
  const stats = calculateStats(processedEdges, detectorResults, sourceFetchTime, detectorRunTime, startTime);

  logger.info(`=== Pipeline Complete: ${processedEdges.length} edges in ${stats.totalTime}ms ===`);

  return {
    edges: processedEdges,
    stats,
    errors,
  };
}

// =============================================================================
// EDGE PROCESSING
// =============================================================================

/**
 * Process edges: dedupe, sort by edge size.
 */
function processEdges(edges: Edge[]): Edge[] {
  // Dedupe by market ID + direction
  const seen = new Set<string>();
  const unique: Edge[] = [];

  for (const edge of edges) {
    const key = `${edge.market.platform}:${edge.market.id}:${edge.direction}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(edge);
    }
  }

  // Sort by edge size (highest first)
  unique.sort((a, b) => b.edge - a.edge);

  return unique;
}

// =============================================================================
// STATS CALCULATION
// =============================================================================

/**
 * Calculate pipeline statistics.
 */
function calculateStats(
  edges: Edge[],
  detectorResults: PromiseSettledResult<{ name: string; edges: Edge[] }>[],
  sourceFetchTime: number,
  detectorRunTime: number,
  startTime: number
): PipelineStats {
  const byCategory: Record<Category, number> = {
    sports: 0,
    crypto: 0,
    macro: 0,
    politics: 0,
    entertainment: 0,
    health: 0,
    weather: 0,
    other: 0,
  };

  const byDetector: Record<string, number> = {};

  for (const edge of edges) {
    byCategory[edge.market.category] = (byCategory[edge.market.category] ?? 0) + 1;
    byDetector[edge.signal.type] = (byDetector[edge.signal.type] ?? 0) + 1;
  }

  return {
    totalEdges: edges.length,
    byCategory,
    byDetector,
    sourceFetchTime,
    processorRunTime: 0,  // Not yet implemented
    detectorRunTime,
    mlScoringTime: 0,     // Not yet implemented
    totalTime: Date.now() - startTime,
  };
}

/**
 * Create empty stats for error cases.
 */
function createEmptyStats(totalTime: number): PipelineStats {
  return {
    totalEdges: 0,
    byCategory: {
      sports: 0,
      crypto: 0,
      macro: 0,
      politics: 0,
      entertainment: 0,
      health: 0,
      weather: 0,
      other: 0,
    },
    byDetector: {},
    sourceFetchTime: 0,
    processorRunTime: 0,
    detectorRunTime: 0,
    mlScoringTime: 0,
    totalTime,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Run pipeline and return only critical edges (edge >= 0.10).
 */
export async function runCriticalOnly(): Promise<Edge[]> {
  const result = await runPipeline();
  return result.edges.filter(e => e.urgency === 'critical');
}

/**
 * Run pipeline for a specific category only.
 */
export async function runForCategory(category: Category): Promise<Edge[]> {
  const result = await runPipeline();
  return result.edges.filter(e => e.market.category === category);
}
