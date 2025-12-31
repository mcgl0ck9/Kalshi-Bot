/**
 * Edge Detection Pipeline
 *
 * Main pipeline that:
 * 1. Fetches markets from Kalshi + Polymarket
 * 2. Fetches news for sentiment analysis
 * 3. Checks whale activity
 * 4. Finds cross-platform divergences
 * 5. Finds sentiment-based edges
 * 6. Combines signals for final opportunities
 * 7. Sends alerts to Discord
 */

import type { EdgeOpportunity, CrossPlatformMatch, Market, TopicSentiment, WhaleSignal, PositionSizing } from './types/index.js';
import { logger, delay } from './utils/index.js';
import { BANKROLL, CATEGORY_PRIORITIES, MIN_EDGE_THRESHOLD } from './config.js';

// Exchanges
import { fetchKalshiMarkets, fetchPolymarketMarkets } from './exchanges/index.js';

// Fetchers
import { fetchAllNews, checkWhaleActivity } from './fetchers/index.js';

// Analysis
import {
  matchMarketsCrossPlatform,
  getDivergentMarkets,
  analyzeSentimentForTopics,
  findSentimentEdges,
  calculateAdaptivePosition,
  formatDivergenceReport,
} from './analysis/index.js';

// Output
import {
  sendWebhookMessage,
  formatEdgeAlert,
  formatSummaryReport,
} from './output/index.js';

// =============================================================================
// PIPELINE RESULT
// =============================================================================

export interface PipelineResult {
  success: boolean;
  stats: {
    totalMarkets: number;
    kalshiMarkets: number;
    polymarketMarkets: number;
    articlesAnalyzed: number;
    divergencesFound: number;
    opportunitiesFound: number;
    alertsSent: number;
  };
  opportunities: EdgeOpportunity[];
  divergences: CrossPlatformMatch[];
  whaleSignals: WhaleSignal[];
  duration: number;
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

/**
 * Run the full edge detection pipeline
 */
export async function runPipeline(bankroll: number = BANKROLL): Promise<PipelineResult> {
  const startTime = Date.now();

  logger.divider();
  logger.info('Starting Kalshi Edge Detection Pipeline');
  logger.divider();

  const stats = {
    totalMarkets: 0,
    kalshiMarkets: 0,
    polymarketMarkets: 0,
    articlesAnalyzed: 0,
    divergencesFound: 0,
    opportunitiesFound: 0,
    alertsSent: 0,
  };

  const opportunities: EdgeOpportunity[] = [];
  const allDivergences: CrossPlatformMatch[] = [];
  const whaleSignals: WhaleSignal[] = [];

  try {
    // ========== STEP 1: FETCH PREDICTION MARKETS ==========
    logger.step(1, 'Fetching prediction markets...');

    const [kalshiMarkets, polymarketMarkets] = await Promise.all([
      fetchKalshiMarkets(100),
      fetchPolymarketMarkets(100),
    ]);

    stats.kalshiMarkets = kalshiMarkets.length;
    stats.polymarketMarkets = polymarketMarkets.length;
    stats.totalMarkets = kalshiMarkets.length + polymarketMarkets.length;

    logger.success(`Kalshi: ${kalshiMarkets.length} markets`);
    logger.success(`Polymarket: ${polymarketMarkets.length} markets`);

    // ========== STEP 2: FETCH NEWS ==========
    logger.step(2, 'Fetching news for sentiment analysis...');

    const articles = await fetchAllNews();
    stats.articlesAnalyzed = articles.length;

    logger.success(`${articles.length} news articles`);

    // ========== STEP 3: CHECK WHALE ACTIVITY ==========
    logger.step(3, 'Checking whale activity...');

    const whales = await checkWhaleActivity();
    whaleSignals.push(...whales);

    logger.success(`${whales.length} whale signals`);

    // ========== STEP 4: CROSS-PLATFORM DIVERGENCE ==========
    logger.step(4, 'Finding cross-platform divergences...');

    const matches = matchMarketsCrossPlatform(kalshiMarkets, polymarketMarkets);
    const divergent = getDivergentMarkets(matches, 0.05);
    allDivergences.push(...divergent);
    stats.divergencesFound = divergent.length;

    logger.success(`${divergent.length} divergent markets (>5% difference)`);

    // ========== STEP 5: SENTIMENT ANALYSIS ==========
    logger.step(5, 'Analyzing sentiment by topic...');

    const topicSentiment = analyzeSentimentForTopics(articles);

    for (const [topic, data] of topicSentiment) {
      if (data.articleCount >= 3) {
        const emoji = data.sentimentLabel === 'bullish' ? '📈' : data.sentimentLabel === 'bearish' ? '📉' : '➡️';
        logger.info(`  ${emoji} ${topic}: ${data.sentimentLabel} (${data.articleCount} articles)`);
      }
    }

    // ========== STEP 6: FIND SENTIMENT EDGES ==========
    logger.step(6, 'Finding sentiment-based edges...');

    const sentimentEdges = findSentimentEdges(topicSentiment, kalshiMarkets, MIN_EDGE_THRESHOLD);

    logger.success(`${sentimentEdges.length} sentiment edges found`);

    // ========== STEP 7: COMBINE SIGNALS ==========
    logger.step(7, 'Combining signals for final opportunities...');

    // Add divergence-based opportunities
    for (const div of divergent.slice(0, 10)) {
      const edge = div.polymarketMoreBullish
        ? div.polymarketPrice - div.kalshiPrice
        : div.kalshiPrice - div.polymarketPrice;

      const opportunity: EdgeOpportunity = {
        market: div.kalshi,
        source: 'cross-platform',
        edge: Math.abs(edge),
        confidence: Math.min(0.9, 0.5 + div.similarity * 0.3),
        urgency: Math.abs(edge) >= 0.15 ? 'critical' : Math.abs(edge) >= 0.08 ? 'standard' : 'fyi',
        direction: div.polymarketMoreBullish ? 'BUY YES' : 'BUY NO',
        signals: { crossPlatform: div },
      };

      opportunity.sizing = calculateAdaptivePosition(bankroll, opportunity);
      opportunities.push(opportunity);
    }

    // Add sentiment-based opportunities
    for (const sentEdge of sentimentEdges.slice(0, 10)) {
      const opportunity: EdgeOpportunity = {
        market: sentEdge.market,
        source: 'sentiment',
        edge: Math.abs(sentEdge.edge),
        confidence: sentEdge.confidence,
        urgency: sentEdge.urgency,
        direction: sentEdge.direction,
        signals: { sentiment: sentEdge },
      };

      opportunity.sizing = calculateAdaptivePosition(bankroll, opportunity);
      opportunities.push(opportunity);
    }

    // Sort by edge magnitude and urgency
    opportunities.sort((a, b) => {
      if (a.urgency !== b.urgency) {
        const urgencyOrder = { critical: 0, standard: 1, fyi: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }
      return b.edge - a.edge;
    });

    stats.opportunitiesFound = opportunities.length;

    logger.success(`${opportunities.length} total opportunities`);

    // ========== STEP 8: SEND ALERTS ==========
    logger.step(8, 'Sending alerts...');

    // Send top 5 opportunities
    for (const opp of opportunities.slice(0, 5)) {
      const message = formatEdgeAlert(opp);
      const sent = await sendWebhookMessage(message);
      if (sent) stats.alertsSent++;
      await delay(1000); // Rate limit
    }

    // Send summary report
    const summary = formatSummaryReport(
      opportunities,
      allDivergences,
      whaleSignals,
      stats
    );
    await sendWebhookMessage(summary);

    logger.success(`Sent ${stats.alertsSent} alerts`);

    // ========== COMPLETE ==========
    const duration = (Date.now() - startTime) / 1000;

    logger.divider();
    logger.info(`Pipeline complete in ${duration.toFixed(1)}s`);
    logger.info(`  Markets: ${stats.totalMarkets} | Articles: ${stats.articlesAnalyzed}`);
    logger.info(`  Opportunities: ${stats.opportunitiesFound} | Alerts: ${stats.alertsSent}`);
    logger.divider();

    return {
      success: true,
      stats,
      opportunities,
      divergences: allDivergences,
      whaleSignals,
      duration,
    };
  } catch (error) {
    logger.error(`Pipeline error: ${error}`);

    return {
      success: false,
      stats,
      opportunities,
      divergences: allDivergences,
      whaleSignals,
      duration: (Date.now() - startTime) / 1000,
    };
  }
}

// =============================================================================
// INDIVIDUAL SCANS
// =============================================================================

/**
 * Get divergences only (for /divergences command)
 */
export async function getDivergencesReport(): Promise<string> {
  const [kalshi, poly] = await Promise.all([
    fetchKalshiMarkets(100),
    fetchPolymarketMarkets(100),
  ]);

  const matches = matchMarketsCrossPlatform(kalshi, poly);
  const divergent = getDivergentMarkets(matches, 0.05);

  return formatDivergenceReport(divergent, 10);
}

/**
 * Get status report (for /status command)
 */
export function getStatusReport(): string {
  return [
    '**Kalshi Edge Detector Status**',
    '',
    `Status: Online ✅`,
    `Bankroll: $${BANKROLL.toLocaleString()}`,
    `Min Edge: ${(MIN_EDGE_THRESHOLD * 100).toFixed(0)}%`,
    `Schedule: 6:30am, 12pm, 5pm ET`,
    '',
    `Using dr-manhattan for exchange APIs`,
  ].join('\n');
}
