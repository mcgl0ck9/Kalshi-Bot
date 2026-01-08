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

// Discord output imports
import {
  initializeChannels,
  sendEdgeAlert,
  sendDailyDigest,
  clearSentMarketsCache,
} from './output/index.js';
import type { EdgeOpportunity, Market as LegacyMarket, MarketCategory } from './types/index.js';

// ML scoring imports
import {
  scoreOpportunity,
  getModelStatus,
  type ScoredOpportunity,
} from './ml/scorer.js';

// =============================================================================
// INITIALIZATION
// =============================================================================

function initializeV4(): void {
  logger.info('Initializing Kalshi Edge Detector v4.0...');

  // Register all plugins
  registerAllSources();
  registerAllProcessors();
  registerAllDetectors();

  // Initialize Discord channels
  initializeChannels();

  // Log registry stats
  const stats = getRegistryStats();
  logger.info(`Registered: ${stats.sourceCount} sources, ${stats.processorCount} processors, ${stats.detectorCount} detectors`);
}

// =============================================================================
// EDGE → EDGE OPPORTUNITY ADAPTER
// =============================================================================

/**
 * Convert v4 Edge to legacy EdgeOpportunity format for Discord output
 */
function edgeToOpportunity(edge: Edge): EdgeOpportunity {
  // Map category from v4 to legacy
  const categoryMap: Record<string, MarketCategory> = {
    sports: 'sports',
    crypto: 'crypto',
    macro: 'macro',
    politics: 'politics',
    entertainment: 'entertainment',
    health: 'macro',  // Health maps to macro in legacy
    weather: 'weather',
    other: 'other',
  };

  // Map urgency (v4 uses 'low', legacy uses 'fyi')
  const urgencyMap: Record<string, 'critical' | 'standard' | 'fyi'> = {
    critical: 'critical',
    standard: 'standard',
    low: 'fyi',
  };

  // Map direction (v4 uses 'YES'/'NO', legacy uses 'BUY YES'/'BUY NO')
  const direction = edge.direction === 'YES' ? 'BUY YES' : 'BUY NO';

  // Convert market format
  const market: LegacyMarket = {
    platform: edge.market.platform,
    id: edge.market.id,
    ticker: edge.market.ticker,
    title: edge.market.title,
    subtitle: edge.market.subtitle,
    category: categoryMap[edge.market.category] ?? 'other',
    price: edge.market.price,
    volume: edge.market.volume ?? 0,
    url: edge.market.url,
    closeTime: edge.market.closeTime,
  };

  // Build signals object from edge signal
  const signals: EdgeOpportunity['signals'] = {};

  // Map signal type to appropriate signal field
  const signalType = edge.signal.type;
  // Cast to unknown first to allow flexible signal data access
  const signalData = edge.signal as unknown as Record<string, unknown>;

  switch (signalType) {
    case 'cross-platform':
      signals.crossPlatform = signalData as unknown as EdgeOpportunity['signals']['crossPlatform'];
      break;
    case 'sentiment':
      signals.sentiment = signalData as unknown as EdgeOpportunity['signals']['sentiment'];
      break;
    case 'whale':
      signals.whaleConviction = signalData as unknown as EdgeOpportunity['signals']['whaleConviction'];
      break;
    case 'sports':
      if (signalData.consensusProb !== undefined) {
        signals.sportsConsensus = signalData.consensusProb as number;
      }
      if (signalData.enhancedSports) {
        signals.enhancedSports = signalData.enhancedSports as unknown as EdgeOpportunity['signals']['enhancedSports'];
      }
      break;
    case 'fed':
      signals.fedSpeech = signalData as unknown as EdgeOpportunity['signals']['fedSpeech'];
      break;
    case 'health':
    case 'measles':
      signals.measles = signalData as unknown as EdgeOpportunity['signals']['measles'];
      break;
    case 'macro':
      signals.macroEdge = signalData as unknown as EdgeOpportunity['signals']['macroEdge'];
      break;
    case 'weather':
      signals.weather = signalData as unknown as EdgeOpportunity['signals']['weather'];
      break;
    case 'entertainment':
      signals.entertainment = signalData as unknown as EdgeOpportunity['signals']['entertainment'];
      break;
    case 'crypto':
      // Crypto price bucket edge - map signal data to cryptoPrice
      signals.cryptoPrice = {
        symbol: signalData.symbol as 'BTC' | 'ETH',
        currentPrice: signalData.currentPrice as number,
        threshold: signalData.threshold as number,
        isAbove: signalData.isAbove as boolean,
        impliedProb: signalData.impliedProb as number,
        marketPrice: signalData.marketPrice as number,
        daysToExpiry: signalData.daysToExpiry as number,
        fundingSignal: signalData.fundingSignal as string | undefined,
        fearGreedSignal: signalData.fearGreedSignal as string | undefined,
      };
      break;
    case 'new-market':
      signals.newMarket = signalData as unknown as EdgeOpportunity['signals']['newMarket'];
      break;
    case 'time-decay':
      signals.timeDecay = signalData as unknown as EdgeOpportunity['signals']['timeDecay'];
      break;
    case 'arbitrage':
      signals.crossPlatform = signalData as unknown as EdgeOpportunity['signals']['crossPlatform'];
      break;
    case 'polling':
      // Generic polling signal - no specific field
      break;
    case 'mentions':
      // Mentions could be fed speech or earnings
      if (signalData.keyword) {
        signals.fedSpeech = signalData as unknown as EdgeOpportunity['signals']['fedSpeech'];
      }
      break;
    case 'ml-edge':
      // ML predictions don't have a specific signal field
      break;
  }

  // Determine source from signal type
  const sourceMap: Record<string, EdgeOpportunity['source']> = {
    'cross-platform': 'cross-platform',
    sentiment: 'sentiment',
    whale: 'whale',
    sports: 'sports',
    fed: 'combined',
    health: 'measles',
    measles: 'measles',
    macro: 'macro',
    weather: 'combined',
    entertainment: 'combined',
    crypto: 'combined',  // Crypto price bucket detector
    'new-market': 'new-market',
    'time-decay': 'combined',
    arbitrage: 'cross-platform',
    polling: 'combined',
    mentions: 'earnings',
    'ml-edge': 'combined',
  };

  return {
    market,
    source: sourceMap[signalType] ?? 'combined',
    edge: edge.edge,
    confidence: edge.confidence,
    urgency: urgencyMap[edge.urgency] ?? 'fyi',
    direction,
    signals,
  };
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

  // Clear sent markets cache to allow re-alerting in new run
  clearSentMarketsCache();

  const result = await runPipeline();

  // Log results
  logger.info(`Pipeline complete in ${result.stats.totalTime}ms`);
  logger.info(`Found ${result.edges.length} edges`);

  // Log any errors
  for (const error of result.errors) {
    logger.error(`[${error.source}] ${error.error}`);
  }

  // Categorize edges by urgency
  const criticalEdges = result.edges.filter(e => e.urgency === 'critical');
  const standardEdges = result.edges.filter(e => e.urgency === 'standard');
  const lowEdges = result.edges.filter(e => e.urgency === 'low');

  logger.info(`Critical: ${criticalEdges.length}, Standard: ${standardEdges.length}, FYI: ${lowEdges.length}`);

  // Log top 5 edges to console
  console.log('\n=== TOP EDGES ===\n');
  for (const edge of result.edges.slice(0, 5)) {
    console.log(formatEdgeForConsole(edge));
    console.log('');
  }

  // ==========================================================================
  // APPLY ML SCORING
  // ==========================================================================

  const mlStatus = getModelStatus();
  logger.info(`ML Model: ${mlStatus.available ? `v${mlStatus.version} (${mlStatus.trainingSamples} samples, ${(mlStatus.accuracy * 100).toFixed(0)}% accuracy)` : 'Not trained'}`);

  // Convert edges to opportunities and apply ML scoring
  const scoredOpportunities: Array<EdgeOpportunity & { mlScore?: number; rankScore?: number }> = [];

  for (const edge of [...criticalEdges, ...standardEdges]) {
    const opportunity = edgeToOpportunity(edge);

    // Apply ML scoring if model is available
    if (mlStatus.available && mlStatus.trainingSamples >= 20) {
      try {
        const scored = scoreOpportunity(opportunity);
        scoredOpportunities.push({
          ...scored,
          mlScore: scored.mlScore,
          rankScore: scored.rankScore,
        });
      } catch {
        scoredOpportunities.push(opportunity);
      }
    } else {
      scoredOpportunities.push(opportunity);
    }
  }

  // Sort by ML rank score if available
  if (mlStatus.available) {
    scoredOpportunities.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

    const avgMLScore = scoredOpportunities.reduce((sum, o) => sum + (o.mlScore ?? 0.5), 0) / scoredOpportunities.length;
    logger.info(`ML Scoring: avg=${(avgMLScore * 100).toFixed(0)}% across ${scoredOpportunities.length} opportunities`);
  }

  // ==========================================================================
  // SEND DISCORD ALERTS
  // ==========================================================================

  let alertsSent = 0;
  let alertsFailed = 0;

  if (scoredOpportunities.length > 0) {
    logger.info(`Sending ${scoredOpportunities.length} Discord alerts...`);

    for (const opportunity of scoredOpportunities) {
      try {
        // Send to appropriate Discord channel
        await sendEdgeAlert(opportunity);
        alertsSent++;

        // Rate limit: 50ms between messages to avoid Discord rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        logger.error(`Failed to send alert for "${opportunity.market.title}": ${error}`);
        alertsFailed++;
      }
    }

    logger.info(`Discord alerts: ${alertsSent} sent, ${alertsFailed} failed`);
  } else {
    logger.info('No edges above threshold for Discord alerts');
  }

  // ==========================================================================
  // SEND DAILY DIGEST (if any edges found)
  // ==========================================================================

  if (result.edges.length > 0) {
    const topEdge = result.edges[0];
    const avgConfidence = result.edges.reduce((sum, e) => sum + e.confidence, 0) / result.edges.length;

    try {
      await sendDailyDigest({
        totalOpportunities: result.edges.length,
        criticalAlerts: criticalEdges.length,
        topEdge: topEdge ? { title: topEdge.market.title, edge: topEdge.edge } : null,
        avgConfidence,
        newMarkets: result.edges.filter(e => e.signal.type === 'new-market').length,
        whaleSignals: result.edges.filter(e => e.signal.type === 'whale').length,
        calibrationScore: 0.25, // Placeholder - would come from calibration tracker
      });
      logger.info('Daily digest sent');
    } catch (error) {
      logger.error(`Failed to send daily digest: ${error}`);
    }
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
