/**
 * Edge Detection Pipeline
 *
 * Main pipeline that:
 * 1. Fetches markets from Kalshi + Polymarket
 * 2. Fetches news for sentiment analysis
 * 3. Checks whale activity
 * 4. Finds cross-platform divergences
 * 5. Finds sentiment-based edges
 * 6. Runs validated macro signals (Fed regime, sports, injury)
 * 7. Combines signals for final opportunities
 * 8. Sends alerts to Discord
 *
 * VALIDATED SIGNALS (passed adversarial testing):
 * - Fed Regime Bias Adjustment: Corrects FedWatch for rising/falling rate biases
 * - Injury Overreaction: Detects when public overreacts to injury news
 * - Sports Odds Comparison: Compares Kalshi to sportsbook consensus
 *
 * SKIPPED SIGNALS (failed adversarial testing):
 * - Simple FedWatch arbitrage (too noisy)
 * - Sports arbitrage (arb bots faster, fees eat profits)
 * - Steam move chasing (need ms execution)
 */

import type { EdgeOpportunity, CrossPlatformMatch, Market, TopicSentiment, WhaleSignal, PositionSizing, MacroEdgeSignal } from './types/index.js';
import { logger, delay } from './utils/index.js';
import { BANKROLL, CATEGORY_PRIORITIES, MIN_EDGE_THRESHOLD, ODDS_API_KEY } from './config.js';

// Exchanges
import { fetchKalshiMarkets, fetchPolymarketMarkets } from './exchanges/index.js';

// Fetchers
import { fetchAllNews, checkWhaleActivity, fetchAllSportsOdds, findSportsEdges } from './fetchers/index.js';
import { fetchFedWatch } from './fetchers/economic/fed-watch.js';

// Analysis
import {
  matchMarketsCrossPlatform,
  getDivergentMarkets,
  analyzeSentimentForTopics,
  findSentimentEdges,
  calculateAdaptivePosition,
  formatDivergenceReport,
} from './analysis/index.js';

// Edge detection (validated signals)
import {
  applyRegimeBiasAdjustment,
  findRegimeAdjustedFedEdge,
  toMacroEdgeSignal,
  analyzeAllInjuryOverreactions,
  analyzeWeatherMarkets,
  analyzeMarketsForRecencyBiasSimple,
  recencyBiasToMacroEdgeSignal,
  findCrossPlatformConvictionEdges,
} from './edge/index.js';

// Output
import {
  sendWebhookMessage,
  formatEdgeAlert,
  formatSummaryReport,
} from './output/index.js';

import {
  sendEdgeAlert,
  sendMacroAlert,
  sendToChannel,
} from './output/channels.js';

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
    fedRegimeSignals: number;
    injurySignals: number;
    sportsOddsGames: number;
    sportsEdgesFound: number;
    weatherSignals: number;
    recencyBiasSignals: number;
  whaleConvictionSignals: number;
  };
  opportunities: EdgeOpportunity[];
  divergences: CrossPlatformMatch[];
  whaleSignals: WhaleSignal[];
  macroSignals: MacroEdgeSignal[];
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
    fedRegimeSignals: 0,
    injurySignals: 0,
    sportsOddsGames: 0,
    sportsEdgesFound: 0,
    weatherSignals: 0,
    recencyBiasSignals: 0,
    whaleConvictionSignals: 0,
  };

  const opportunities: EdgeOpportunity[] = [];
  const allDivergences: CrossPlatformMatch[] = [];
  const whaleSignals: WhaleSignal[] = [];
  const macroSignals: MacroEdgeSignal[] = [];

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

    // ========== STEP 6.5: VALIDATED MACRO SIGNALS ==========
    logger.step(6.5, 'Running validated macro signals...');

    // 6.5.1: Fed Regime Bias Adjustment
    logger.info('  Checking Fed regime bias...');
    try {
      const fedWatchData = await fetchFedWatch();
      if (fedWatchData) {
        const regimeAdjusted = applyRegimeBiasAdjustment(fedWatchData);
        if (regimeAdjusted) {
          logger.info(`  Fed regime: ${regimeAdjusted.regime.toUpperCase()} (${(regimeAdjusted.regimeConfidence * 100).toFixed(0)}% conf)`);

          // Find edges in Fed markets using regime-adjusted probabilities
          for (const market of kalshiMarkets) {
            const fedEdge = findRegimeAdjustedFedEdge(market, fedWatchData);
            if (fedEdge) {
              const macroSignal = toMacroEdgeSignal(fedEdge);
              macroSignals.push(macroSignal);
              stats.fedRegimeSignals++;
            }
          }
          logger.success(`  ${stats.fedRegimeSignals} Fed regime signals`);
        }
      }
    } catch (error) {
      logger.warn(`  Fed regime check failed: ${error}`);
    }

    // 6.5.2: Injury Overreaction Detection
    logger.info('  Checking injury overreactions...');
    try {
      const injurySignals = analyzeAllInjuryOverreactions(topicSentiment, kalshiMarkets);
      stats.injurySignals = injurySignals.length;
      if (injurySignals.length > 0) {
        logger.success(`  ${injurySignals.length} injury overreaction signals`);
        // Convert to opportunities
        for (const sig of injurySignals) {
          if (sig.relatedMarket && sig.direction !== 'no_signal') {
            const opp: EdgeOpportunity = {
              market: sig.relatedMarket,
              source: 'sentiment', // Use sentiment source for injury signals
              edge: sig.overreactionScore,
              confidence: sig.confidence,
              urgency: sig.signalStrength === 'strong' ? 'critical' : sig.signalStrength === 'moderate' ? 'standard' : 'fyi',
              direction: sig.direction === 'fade' ? 'BUY NO' : 'BUY YES',
              signals: {},
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      }
    } catch (error) {
      logger.warn(`  Injury detection failed: ${error}`);
    }

    // 6.5.3: Sports Odds Comparison (if API key configured)
    if (ODDS_API_KEY) {
      logger.info('  Fetching sports odds...');
      try {
        const sportsOdds = await fetchAllSportsOdds();
        let totalGames = 0;
        for (const [, games] of sportsOdds) {
          totalGames += games.length;
        }
        stats.sportsOddsGames = totalGames;
        logger.success(`  ${totalGames} games with odds data`);

        // Compare Kalshi sports markets to sportsbook consensus
        const sportsEdges = findSportsEdges(kalshiMarkets, sportsOdds);
        stats.sportsEdgesFound = sportsEdges.length;

        if (sportsEdges.length > 0) {
          logger.success(`  ${sportsEdges.length} sports edges vs consensus`);

          // Convert to opportunities
          for (const edge of sportsEdges.slice(0, 5)) {
            const opp: EdgeOpportunity = {
              market: edge.kalshiMarket,
              source: 'combined', // Cross-referenced with sportsbooks
              edge: Math.abs(edge.edge),
              confidence: edge.confidence,
              urgency: Math.abs(edge.edge) > 0.10 ? 'critical' : Math.abs(edge.edge) > 0.06 ? 'standard' : 'fyi',
              direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
              signals: {
                sportsConsensus: edge.consensusProb,
                matchedGame: `${edge.matchedGame.awayTeam} @ ${edge.matchedGame.homeTeam}`,
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      } catch (error) {
        logger.warn(`  Sports odds fetch failed: ${error}`);
      }
    }

    // 6.5.4: Weather Forecast Overreaction
    logger.info('  Checking weather market overreactions...');
    try {
      const weatherEdges = analyzeWeatherMarkets(kalshiMarkets);
      stats.weatherSignals = weatherEdges.length;

      if (weatherEdges.length > 0) {
        logger.success(`  ${weatherEdges.length} weather overreaction signals`);

        // Convert to opportunities
        for (const edge of weatherEdges.slice(0, 3)) {
          const opp: EdgeOpportunity = {
            market: edge.market,
            source: 'combined',
            edge: Math.abs(edge.edge),
            confidence: edge.confidence,
            urgency: Math.abs(edge.edge) > 0.10 ? 'critical' : Math.abs(edge.edge) > 0.06 ? 'standard' : 'fyi',
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {},
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Weather analysis failed: ${error}`);
    }

    // 6.5.5: Recency Bias / Base Rate Neglect
    logger.info('  Checking for recency bias...');
    try {
      const recencySignals = analyzeMarketsForRecencyBiasSimple(kalshiMarkets);
      stats.recencyBiasSignals = recencySignals.length;

      if (recencySignals.length > 0) {
        logger.success(`  ${recencySignals.length} recency bias signals`);

        // Convert to macro signals and opportunities
        for (const sig of recencySignals.slice(0, 3)) {
          macroSignals.push(recencyBiasToMacroEdgeSignal(sig));

          const opp: EdgeOpportunity = {
            market: sig.market,
            source: 'combined',
            edge: Math.abs(sig.edge),
            confidence: sig.confidence,
            urgency: sig.overreactionFactor > 2.5 ? 'critical' : sig.overreactionFactor > 2.0 ? 'standard' : 'fyi',
            direction: sig.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {},
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Recency bias analysis failed: ${error}`);
    }

    // 6.5.6: Cross-Platform Whale Conviction (Polymarket on-chain data)
    logger.info('  Checking Polymarket whale conviction...');
    try {
      const convictionEdges = await findCrossPlatformConvictionEdges(
        kalshiMarkets,
        polymarketMarkets,
        0.6 // Minimum conviction strength
      );
      stats.whaleConvictionSignals = convictionEdges.length;

      if (convictionEdges.length > 0) {
        logger.success(`  ${convictionEdges.length} whale conviction signals`);

        // Convert to opportunities
        for (const edge of convictionEdges.slice(0, 5)) {
          const opp: EdgeOpportunity = {
            market: edge.kalshiMarket,
            source: 'whale', // New source type for whale signals
            edge: edge.edge,
            confidence: edge.confidence,
            urgency: edge.urgency,
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {
              whaleConviction: {
                polymarketPrice: edge.polymarketPrice,
                whaleImpliedPrice: edge.whaleImpliedPrice,
                convictionStrength: edge.convictionStrength,
                topWhaleCount: edge.topWhaleCount,
              },
            },
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Whale conviction analysis failed: ${error}`);
    }

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

    // Add macro signal opportunities (Fed regime, etc.)
    for (const macroSig of macroSignals.slice(0, 5)) {
      // Find the market from kalshiMarkets
      const market = kalshiMarkets.find(m => m.id === macroSig.marketId);
      if (market) {
        const opportunity: EdgeOpportunity = {
          market,
          source: 'combined', // Macro signals are combined/processed signals
          edge: Math.abs(macroSig.edge),
          confidence: macroSig.confidence,
          urgency: macroSig.signalStrength === 'strong' ? 'critical' : macroSig.signalStrength === 'moderate' ? 'standard' : 'fyi',
          direction: macroSig.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
          signals: {},
        };

        opportunity.sizing = calculateAdaptivePosition(bankroll, opportunity);
        opportunities.push(opportunity);
      }
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

    // Send top 5 opportunities to appropriate channels
    for (const opp of opportunities.slice(0, 5)) {
      try {
        await sendEdgeAlert(opp);
        stats.alertsSent++;
        await delay(1000); // Rate limit
      } catch (error) {
        logger.warn(`Failed to send edge alert: ${error}`);
      }
    }

    // Send macro signals to macro channel
    for (const macroSig of macroSignals.slice(0, 3)) {
      try {
        await sendMacroAlert(macroSig);
        await delay(500);
      } catch (error) {
        logger.warn(`Failed to send macro alert: ${error}`);
      }
    }

    // Send summary report to digest channel
    const summary = formatSummaryReport(
      opportunities,
      allDivergences,
      whaleSignals,
      stats
    );
    await sendToChannel('digest', summary);

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
      macroSignals,
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
      macroSignals,
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
