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
import { fetchKalshiMarkets, fetchPolymarketMarkets, fetchKalshiSportsMarkets, fetchAllKalshiMarkets, fetchKalshiWeatherMarkets } from './exchanges/index.js';

// Fetchers
import { fetchAllNews, checkWhaleActivity, fetchAllSportsOdds, findSportsEdges } from './fetchers/index.js';
import { fetchFedWatch } from './fetchers/economic/fed-watch.js';
import { fetchPolymarketMarketsWithPrices } from './fetchers/polymarket-onchain.js';

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
  analyzeCityWeatherMarkets,
  cityWeatherEdgeToOpportunity,
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

// ML scoring
import {
  enhanceOpportunities,
  getModelStatus,
  type ScoredOpportunity,
} from './ml/index.js';

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
    macroEdgeSignals: number;
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
    cityWeatherSignals: 0,
    recencyBiasSignals: 0,
    whaleConvictionSignals: 0,
    macroEdgeSignals: 0,
  };

  const opportunities: EdgeOpportunity[] = [];
  const allDivergences: CrossPlatformMatch[] = [];
  const whaleSignals: WhaleSignal[] = [];
  const macroSignals: MacroEdgeSignal[] = [];

  try {
    // ========== STEP 1: FETCH PREDICTION MARKETS ==========
    logger.step(1, 'Fetching prediction markets...');

    // Fetch markets in parallel - try paginated first, fall back to dr-manhattan
    let kalshiMarkets: Market[] = [];
    let polymarketMarkets: Market[] = [];

    // First try paginated fetch for broader coverage
    const [kalshiGeneral, kalshiSports, polyMarkets] = await Promise.all([
      fetchAllKalshiMarkets(1000).catch(() => [] as Market[]),
      fetchKalshiSportsMarkets().catch(() => [] as Market[]),
      // Use Gamma API for reliable Polymarket prices (dr-manhattan returns 0 prices)
      fetchPolymarketMarketsWithPrices(200),
    ]);

    polymarketMarkets = polyMarkets;

    // Combine and deduplicate Kalshi markets
    const seenKalshiTickers = new Set<string>();
    for (const market of [...kalshiGeneral, ...kalshiSports]) {
      const ticker = market.ticker ?? market.id;
      if (!seenKalshiTickers.has(ticker)) {
        seenKalshiTickers.add(ticker);
        kalshiMarkets.push(market);
      }
    }

    // Fall back to dr-manhattan if paginated fetch returned empty
    if (kalshiMarkets.length === 0) {
      logger.info('Paginated fetch empty, using dr-manhattan client...');
      kalshiMarkets = await fetchKalshiMarkets(200);
    }

    stats.kalshiMarkets = kalshiMarkets.length;
    stats.polymarketMarkets = polymarketMarkets.length;
    stats.totalMarkets = kalshiMarkets.length + polymarketMarkets.length;

    const kalshiBreakdown = kalshiGeneral.length > 0 || kalshiSports.length > 0
      ? `(${kalshiGeneral.length} general + ${kalshiSports.length} sports)`
      : '(via dr-manhattan)';
    logger.success(`Kalshi: ${kalshiMarkets.length} markets ${kalshiBreakdown}`);
    logger.success(`Polymarket: ${polymarketMarkets.length} markets`);

    // ========== STEP 2: FETCH NEWS ==========
    logger.step(2, 'Fetching news for sentiment analysis...');

    const articles = await fetchAllNews();
    stats.articlesAnalyzed = articles.length;

    logger.success(`${articles.length} news articles`);

    // ========== STEP 3: CHECK WHALE ACTIVITY (Legacy - see step 6.5.6 for on-chain) ==========
    logger.step(3, 'Checking social whale activity...');

    // Note: Social media whale tracking is disabled.
    // Real whale tracking via on-chain Polymarket data happens in step 6.5.6.
    const whales = await checkWhaleActivity();
    whaleSignals.push(...whales);

    logger.success(`Social whale signals: ${whales.length} (on-chain in step 6.5.6)`);

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
        for (const [sport, games] of sportsOdds) {
          totalGames += games.length;
          logger.info(`    ${sport.toUpperCase()}: ${games.length} games`);
        }
        stats.sportsOddsGames = totalGames;
        logger.success(`  ${totalGames} games with odds data`);

        // Compare Kalshi sports markets to sportsbook consensus
        // Lower threshold (2%) for more sensitive edge detection
        const sportsEdges = findSportsEdges(kalshiMarkets, sportsOdds, 0.02);
        stats.sportsEdgesFound = sportsEdges.length;

        if (sportsEdges.length > 0) {
          logger.success(`  ${sportsEdges.length} sports edges vs consensus`);

          // Log all sports edges found for visibility
          for (const edge of sportsEdges.slice(0, 10)) {
            const edgePct = (Math.abs(edge.edge) * 100).toFixed(1);
            logger.info(`    📊 ${edge.matchedGame.awayTeam} @ ${edge.matchedGame.homeTeam}: ${edge.direction} (${edgePct}% edge)`);
          }

          // Convert top 10 to opportunities
          for (const edge of sportsEdges.slice(0, 10)) {
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

    // 6.5.4b: City-Specific Weather (Snow in Chicago, Rain in LA, etc.)
    logger.info('  Checking city weather markets...');
    try {
      // Fetch weather-specific markets to ensure we have them
      const weatherMarkets = await fetchKalshiWeatherMarkets().catch(() => [] as Market[]);
      const allWeatherMarkets = [...kalshiMarkets, ...weatherMarkets];

      // Deduplicate by ticker
      const seenWeatherTickers = new Set<string>();
      const uniqueWeatherMarkets = allWeatherMarkets.filter(m => {
        const ticker = m.ticker ?? m.id;
        if (seenWeatherTickers.has(ticker)) return false;
        seenWeatherTickers.add(ticker);
        return true;
      });

      if (weatherMarkets.length > 0) {
        logger.info(`    Fetched ${weatherMarkets.length} weather-specific markets`);
      }

      const cityWeatherEdges = await analyzeCityWeatherMarkets(uniqueWeatherMarkets);
      stats.cityWeatherSignals = cityWeatherEdges.length;

      if (cityWeatherEdges.length > 0) {
        logger.success(`  ${cityWeatherEdges.length} city weather edges found`);

        // Convert to opportunities
        for (const edge of cityWeatherEdges.slice(0, 5)) {
          const opp = cityWeatherEdgeToOpportunity(edge);
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);

          // Log the edge for visibility
          logger.info(`    🌦️ ${edge.city} ${edge.measurementType}: ${(edge.edge * 100).toFixed(1)}% edge (${edge.direction})`);
        }
      }
    } catch (error) {
      logger.warn(`  City weather analysis failed: ${error}`);
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

    // 6.5.7: Entertainment Edge Detection (RT scores, box office)
    logger.info('  Checking entertainment edges...');
    try {
      // Fetch RT markets specifically (they may not be in the first 200 general markets)
      const { fetchKalshiRTMarkets } = await import('./exchanges/index.js');
      const rtMarkets = await fetchKalshiRTMarkets();

      // Combine with general markets for entertainment detection
      const allMarketsForEntertainment = [...kalshiMarkets, ...rtMarkets];
      // Deduplicate by ticker
      const seenTickers = new Set<string>();
      const uniqueMarkets = allMarketsForEntertainment.filter(m => {
        if (seenTickers.has(m.ticker ?? m.id)) return false;
        seenTickers.add(m.ticker ?? m.id);
        return true;
      });

      const { detectEntertainmentEdges } = await import('./edge/entertainment-edge.js');
      const entertainmentEdges = await detectEntertainmentEdges(uniqueMarkets);

      if (entertainmentEdges.length > 0) {
        logger.success(`  ${entertainmentEdges.length} entertainment edges found`);

        for (const edge of entertainmentEdges.slice(0, 5)) {
          const opp: EdgeOpportunity = {
            market: edge.market,
            source: 'combined',
            edge: edge.edge,
            confidence: edge.confidence,
            urgency: edge.edge > 0.15 ? 'critical' : edge.edge > 0.08 ? 'standard' : 'fyi',
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {},
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Entertainment edge detection failed: ${error}`);
    }

    // 6.5.8: Polling Edge Detection (538, RCP, Silver Bulletin)
    logger.info('  Checking polling edges...');
    try {
      const { detectPollingEdges } = await import('./edge/polling-edge.js');
      const pollingEdges = await detectPollingEdges(kalshiMarkets);

      if (pollingEdges.length > 0) {
        logger.success(`  ${pollingEdges.length} polling edges found`);

        for (const edge of pollingEdges.slice(0, 3)) {
          const opp: EdgeOpportunity = {
            market: edge.market,
            source: 'combined',
            edge: edge.edge,
            confidence: edge.confidence,
            urgency: edge.edge > 0.10 ? 'critical' : edge.edge > 0.05 ? 'standard' : 'fyi',
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {},
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Polling edge detection failed: ${error}`);
    }

    // 6.5.9: Fed Speech Keyword Analysis (historical transcript word frequency)
    logger.info('  Checking Fed speech keyword edges...');
    try {
      const { fetchFedMentionMarkets, findFedSpeechEdges } = await import('./edge/fed-speech-edge.js');
      const fedMentionMarkets = await fetchFedMentionMarkets();

      if (fedMentionMarkets.length > 0) {
        // Extract headlines for context adjustment
        const headlines = articles.map(a => a.title ?? '').filter(t => t.length > 0);
        const fedSpeechEdges = await findFedSpeechEdges(fedMentionMarkets, headlines);

        if (fedSpeechEdges.length > 0) {
          logger.success(`  ${fedSpeechEdges.length} Fed speech keyword edges found`);

          for (const edge of fedSpeechEdges.slice(0, 5)) {
            const opp: EdgeOpportunity = {
              market: edge.market,
              source: 'combined',
              edge: Math.abs(edge.edge),
              confidence: edge.confidence,
              urgency: edge.signalStrength === 'critical' ? 'critical' : edge.signalStrength === 'actionable' ? 'standard' : 'fyi',
              direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
              signals: {
                fedSpeech: {
                  keyword: edge.keyword,
                  historicalFrequency: edge.impliedProbability,
                  reasoning: edge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      }
    } catch (error) {
      logger.warn(`  Fed speech keyword detection failed: ${error}`);
    }

    // 6.5.10: CDC Measles Edge Detection
    logger.info('  Checking CDC measles edges...');
    try {
      const { detectMeaslesEdges, formatMeaslesEdge } = await import('./edge/measles-edge.js');
      const measlesEdges = await detectMeaslesEdges();

      if (measlesEdges.length > 0) {
        logger.success(`  ${measlesEdges.length} measles edges found`);

        for (const edge of measlesEdges.slice(0, 5)) {
          logger.info(`    🦠 ${edge.ticker}: ${edge.direction} (${(edge.edge * 100).toFixed(1)}% edge)`);

          // Add to opportunities
          opportunities.push({
            market: edge.market,
            source: 'measles',
            edge: Math.abs(edge.edge),
            confidence: edge.confidence,
            urgency: edge.signalStrength === 'critical' ? 'critical' :
                     edge.signalStrength === 'actionable' ? 'standard' : 'fyi',
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {
              measles: {
                currentCases: edge.currentCases,
                threshold: edge.threshold,
                projectedYearEnd: edge.projectedYearEnd,
              },
            },
          });
        }
      }
    } catch (error) {
      logger.warn(`  CDC measles edge detection failed: ${error}`);
    }

    // 6.5.11: Earnings Call Keyword Edge Detection
    logger.info('  Checking earnings call keyword edges...');
    try {
      const { findEarningsEdges } = await import('./edge/earnings-edge.js');
      // Pass headlines for context adjustment
      const headlines = articles.map(a => a.title ?? '').filter(t => t.length > 0);
      const earningsEdges = await findEarningsEdges(headlines);

      if (earningsEdges.length > 0) {
        logger.success(`  ${earningsEdges.length} earnings call keyword edges found`);

        for (const edge of earningsEdges.slice(0, 5)) {
          logger.info(`    📊 ${edge.company} "${edge.keyword}": ${edge.direction} (${(edge.edge * 100).toFixed(1)}% edge)`);

          // Add to opportunities
          opportunities.push({
            market: edge.market,
            source: 'earnings',
            edge: Math.abs(edge.edge),
            confidence: edge.confidence,
            urgency: edge.signalStrength === 'critical' ? 'critical' :
                     edge.signalStrength === 'actionable' ? 'standard' : 'fyi',
            direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {
              earnings: {
                company: edge.company,
                keyword: edge.keyword,
                impliedProbability: edge.impliedProbability,
                reasoning: edge.reasoning,
              },
            },
          });
        }
      }
    } catch (error) {
      logger.warn(`  Earnings call edge detection failed: ${error}`);
    }

    // 6.5.12: Macro Economic Edge Detection (CPI, Jobs, GDP nowcasts)
    logger.info('  Checking macro economic edges...');
    try {
      const { analyzeMacroEdge } = await import('./edge/macro-edge.js');
      const { fetchAllEconomicData } = await import('./fetchers/economic/index.js');

      // Fetch economic data (CPI nowcast, Jobs leading indicators, GDP nowcast)
      const economicData = await fetchAllEconomicData();

      // Also fetch FedWatch for Fed rate edge detection
      const fedWatchForMacro = await fetchFedWatch();

      // Run macro edge analysis
      const macroEdgeReport = analyzeMacroEdge(kalshiMarkets, {
        fedWatch: fedWatchForMacro,
        inflation: economicData.inflation,
        jobs: economicData.jobs,
        gdp: economicData.gdp,
      });

      stats.macroEdgeSignals = macroEdgeReport.signals.length;

      if (macroEdgeReport.signals.length > 0) {
        logger.success(`  ${macroEdgeReport.signals.length} macro economic edges found`);
        logger.info(`    Fed: ${macroEdgeReport.byCategory.fed.length}, CPI: ${macroEdgeReport.byCategory.cpi.length}, Jobs: ${macroEdgeReport.byCategory.jobs.length}, GDP: ${macroEdgeReport.byCategory.gdp.length}`);

        // Convert to opportunities
        for (const signal of macroEdgeReport.signals.slice(0, 5)) {
          // Find the original market object for full properties
          const originalMarket = kalshiMarkets.find(m => m.id === signal.marketId);

          const opp: EdgeOpportunity = {
            market: originalMarket ?? {
              platform: signal.marketPlatform,
              id: signal.marketId,
              title: signal.marketTitle,
              category: 'macro',
              price: signal.marketPrice,
              volume: 0,
              url: signal.marketUrl ?? '',
            },
            source: 'macro',
            edge: Math.abs(signal.edge),
            confidence: signal.confidence,
            urgency: signal.signalStrength === 'strong' ? 'critical' : signal.signalStrength === 'moderate' ? 'standard' : 'fyi',
            direction: signal.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {
              macroEdge: {
                indicatorType: signal.indicatorType,
                indicatorName: signal.indicatorName,
                indicatorValue: signal.indicatorValue,
                indicatorSource: signal.indicatorSource,
                impliedProbability: signal.impliedProbability,
                reasoning: signal.reasoning,
              },
            },
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);

          // Also add to macroSignals for the macro channel
          macroSignals.push(signal);
        }
      }
    } catch (error) {
      logger.warn(`  Macro economic edge detection failed: ${error}`);
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

    // Filter out invalid opportunities before sorting
    const validOpportunities = opportunities.filter(opp => {
      const price = opp.market.price ?? 0;
      const edge = opp.edge ?? 0;

      // Must have valid price (not 0, not extreme)
      if (price <= 0 || price >= 1) return false;

      // Must have reasonable edge (<50%)
      if (edge > 0.50) return false;

      // Must have minimum confidence
      if (opp.confidence < 0.40) return false;

      return true;
    });

    const filtered = opportunities.length - validOpportunities.length;
    if (filtered > 0) {
      logger.debug(`Filtered ${filtered} invalid opportunities (bad price/edge/confidence)`);
    }

    // Sort by edge magnitude and urgency (basic sort before ML)
    validOpportunities.sort((a, b) => {
      if (a.urgency !== b.urgency) {
        const urgencyOrder = { critical: 0, standard: 1, fyi: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }
      return b.edge - a.edge;
    });

    stats.opportunitiesFound = validOpportunities.length;

    logger.success(`${validOpportunities.length} total opportunities`);

    // ========== STEP 7.5: ML SCORING ==========
    logger.step(7.5, 'Applying ML scoring...');

    const modelStatus = getModelStatus();
    let scoredOpportunities: ScoredOpportunity[] = [];

    if (modelStatus.available) {
      logger.info(`Using ML model v${modelStatus.version} (${modelStatus.trainingSamples} samples, ${(modelStatus.accuracy * 100).toFixed(0)}% acc)`);
      scoredOpportunities = enhanceOpportunities(validOpportunities, 20);

      // Log top ML-ranked opportunities
      for (const opp of scoredOpportunities.slice(0, 3)) {
        logger.info(`  ML: ${opp.market.title.slice(0, 40)}... score=${(opp.mlScore * 100).toFixed(0)}%`);
      }
    } else {
      logger.info('No ML model available, using raw ranking');
      // Convert to ScoredOpportunity format without ML scoring
      scoredOpportunities = validOpportunities.slice(0, 20).map(opp => ({
        ...opp,
        mlScore: 0.5,
        adjustedConfidence: opp.confidence,
        expectedValue: opp.edge * opp.confidence,
        rankScore: opp.edge * opp.confidence,
      }));
    }

    // ========== STEP 8: SEND ALERTS ==========
    logger.step(8, 'Sending alerts...');

    // Send top 5 ML-ranked opportunities to appropriate channels
    for (const opp of scoredOpportunities.slice(0, 5)) {
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
    fetchPolymarketMarketsWithPrices(200),
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
