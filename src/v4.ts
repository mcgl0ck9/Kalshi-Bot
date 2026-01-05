#!/usr/bin/env node
/**
 * Kalshi Edge Detector v4.0
 *
 * New plugin-based architecture for edge detection.
 *
 * Usage:
 *   npm run v4           # Run v4.0 pipeline
 *   npm run v4 -- --scan # Run scan once
 */

import 'dotenv/config';
import { logger } from './utils/index.js';

// Core v4.0 imports
import { runPipeline, getRegistryStats, type PipelineResult, type Edge } from './core/index.js';
import { registerAllSources } from './sources/index.js';
import { registerAllDetectors } from './detectors/index.js';
import { registerAllProcessors } from './processors/index.js';

// =============================================================================
// INITIALIZATION
// =============================================================================

function initializeV4(): void {
  logger.info('Initializing Kalshi Edge Detector v4.0...');

  // Register all plugins
  registerAllSources();
  registerAllProcessors();
  registerAllDetectors();

  // Log registry stats
  const stats = getRegistryStats();
  logger.info(`Registered: ${stats.sourceCount} sources, ${stats.processorCount} processors, ${stats.detectorCount} detectors`);
}

// =============================================================================
// EDGE FORMATTING
// =============================================================================

function formatEdgeForConsole(edge: Edge): string {
  const urgencyIcon = edge.urgency === 'critical' ? '🔴' : edge.urgency === 'standard' ? '🟡' : '🟢';
  const dirIcon = edge.direction === 'YES' ? '📈' : '📉';
  const edgePct = (edge.edge * 100).toFixed(1);
  const pricePct = (edge.market.price * 100).toFixed(0);

  return `${urgencyIcon}${dirIcon} ${edge.market.title.slice(0, 50)}...
   ${edge.direction} @ ${pricePct}¢ | Edge: ${edgePct}% | ${edge.reason}`;
}

// =============================================================================
// PIPELINE EXECUTION
// =============================================================================

async function runV4Pipeline(): Promise<PipelineResult> {
  logger.info('Running v4.0 edge detection pipeline...');

  const result = await runPipeline();

  // Log results
  logger.info(`Pipeline complete in ${result.stats.totalTime}ms`);
  logger.info(`Found ${result.edges.length} edges`);

  // Log any errors
  for (const error of result.errors) {
    logger.error(`[${error.source}] ${error.error}`);
  }

  // Send alerts for high-conviction edges
  const criticalEdges = result.edges.filter(e => e.urgency === 'critical');
  const standardEdges = result.edges.filter(e => e.urgency === 'standard');

  logger.info(`Critical: ${criticalEdges.length}, Standard: ${standardEdges.length}`);

  // Log top 5 edges to console
  console.log('\n=== TOP EDGES ===\n');
  for (const edge of result.edges.slice(0, 5)) {
    console.log(formatEdgeForConsole(edge));
    console.log('');
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              KALSHI EDGE DETECTOR v4.0                     ║
║           Plugin-Based Edge Detection                      ║
╚════════════════════════════════════════════════════════════╝
`);

  // Initialize
  initializeV4();

  // Parse args
  const args = process.argv.slice(2);
  const runOnce = args.includes('--scan') || args.includes('--run-now');

  if (runOnce) {
    // Run once and exit
    const result = await runV4Pipeline();
    const exitCode = result.errors.length === 0 ? 0 : 1;
    process.exit(exitCode);
  }

  // Continuous mode - run every 5 minutes
  logger.info('Starting continuous monitoring (5 min interval)...');

  while (true) {
    try {
      await runV4Pipeline();
    } catch (error) {
      logger.error(`Pipeline error: ${error}`);
    }

    // Wait 5 minutes
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
  }
}

// Run
main().catch(error => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
