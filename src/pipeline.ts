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
import { logger, delay, recordPrices, findMovingMarkets, formatPriceHistoryReport, getHistoryStats, forceSave as saveHistoryData } from './utils/index.js';
import { BANKROLL, CATEGORY_PRIORITIES, MIN_EDGE_THRESHOLD, ODDS_API_KEY } from './config.js';

// Exchanges
import { fetchKalshiMarkets, fetchPolymarketMarkets, fetchKalshiSportsMarkets, fetchAllKalshiMarkets, fetchKalshiWeatherMarkets, fetchMatchableKalshiMarkets } from './exchanges/index.js';

// Fetchers
import { fetchAllNews, checkWhaleActivity, fetchAllSportsOdds, findSportsEdges, fetchAllPlayerProps, findPlayerPropEdges } from './fetchers/index.js';
import { fetchFedWatch } from './fetchers/economic/fed-watch.js';
import { fetchPolymarketMarketsWithPrices } from './fetchers/polymarket-onchain.js';

// P0 Data Sources (no API keys required)
import { fetchAllSportsOddsESPN, findESPNEdge } from './fetchers/espn-odds.js';
import { fetchWastewaterData, fetchFluData as fetchCDCFluData, analyzeWastewaterEdge } from './fetchers/cdc-surveillance.js';
import { fetchFundingRates, fetchFearGreedIndex, analyzeFundingEdge, analyzeFearGreedEdge } from './fetchers/crypto-funding.js';
import { fetchGDPNow, fetchInflationNowcast, analyzeGDPEdge, analyzeInflationEdge } from './fetchers/fed-nowcasts.js';

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
  sendGroupedMultiOutcomeAlerts,
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
    optionsImpliedSignals: number;
    enhancedSportsEdges: number;
    newMarketsDetected: number;
    playerPropEdges: number;
    lineMoveEdges: number;
    // P0 sources
    espnOddsGames: number;
    espnEdges: number;
    cdcWastewaterSignals: number;
    cryptoFundingSignals: number;
    fedNowcastSignals: number;
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
    optionsImpliedSignals: 0,
    enhancedSportsEdges: 0,
    newMarketsDetected: 0,
    playerPropEdges: 0,
    lineMoveEdges: 0,
    // P0 sources
    espnOddsGames: 0,
    espnEdges: 0,
    cdcWastewaterSignals: 0,
    cryptoFundingSignals: 0,
    fedNowcastSignals: 0,
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

    // ========== STEP 1.5: RECORD PRICE HISTORY ==========
    logger.step(1.5, 'Recording price history...');

    // Record prices for all markets
    const priceRecords = [
      ...kalshiMarkets.map(m => ({
        id: m.id,
        platform: 'kalshi' as const,
        title: m.title,
        price: m.price,
        volume: m.volume24h,
      })),
      ...polymarketMarkets.map(m => ({
        id: m.id,
        platform: 'polymarket' as const,
        title: m.title,
        price: m.price,
        volume: m.volume24h,
      })),
    ];

    recordPrices(priceRecords);
    const historyStats = getHistoryStats();
    logger.success(`Recorded ${priceRecords.length} prices (${historyStats.totalMarkets} markets tracked)`);

    // Check for significant price movements
    const movingMarkets = findMovingMarkets(0.08, 6); // 8%+ moves in last 6 hours
    if (movingMarkets.length > 0) {
      logger.info(`  📊 ${movingMarkets.length} markets with significant movement`);
    }

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

    // Fetch matchable single-outcome markets from key series (not parlays)
    const matchableKalshi = await fetchMatchableKalshiMarkets();
    logger.info(`Fetched ${matchableKalshi.length} matchable Kalshi markets for cross-platform`);

    const matches = matchMarketsCrossPlatform(matchableKalshi, polymarketMarkets);
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
    // Declare sportsOdds at higher scope for use in line move detection
    let sportsOdds: Map<string, import('./fetchers/sports-odds.js').SportOdds[]> = new Map();

    if (ODDS_API_KEY) {
      logger.info('  Fetching sports odds...');
      try {
        sportsOdds = await fetchAllSportsOdds();
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

      // 6.5.3a: Player Props Edge Detection
      logger.info('  Fetching player props...');
      try {
        const playerPropsMap = await fetchAllPlayerProps();
        let totalProps = 0;
        for (const [sport, props] of playerPropsMap) {
          totalProps += props.length;
          if (props.length > 0) {
            logger.info(`    ${sport.toUpperCase()}: ${props.length} player props`);
          }
        }

        if (totalProps > 0) {
          logger.success(`  ${totalProps} player props fetched`);

          // Find edges between Kalshi player prop markets and sportsbook consensus
          const playerPropEdges = findPlayerPropEdges(kalshiMarkets, playerPropsMap);
          stats.playerPropEdges = playerPropEdges.length;

          if (playerPropEdges.length > 0) {
            logger.success(`  ${playerPropEdges.length} player prop edges found`);

            // Log top edges for visibility
            for (const edge of playerPropEdges.slice(0, 5)) {
              const edgePct = (Math.abs(edge.edge) * 100).toFixed(1);
              const dir = edge.direction === 'buy_yes' ? 'OVER' : 'UNDER';
              logger.info(`    🎯 ${edge.playerProp.playerName} ${edge.playerProp.propLabel} ${dir} ${edge.playerProp.line}: ${edgePct}% edge`);
            }

            // Convert to opportunities
            for (const edge of playerPropEdges.slice(0, 10)) {
              const opp: EdgeOpportunity = {
                market: edge.kalshiMarket,
                source: 'sports',
                edge: Math.abs(edge.edge),
                confidence: edge.confidence,
                urgency: Math.abs(edge.edge) > 0.10 ? 'critical' : Math.abs(edge.edge) > 0.05 ? 'standard' : 'fyi',
                direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
                signals: {
                  playerProp: {
                    playerName: edge.playerProp.playerName,
                    propType: edge.playerProp.propLabel,
                    line: edge.playerProp.line,
                    isOver: edge.direction === 'buy_yes',
                    consensusProb: edge.consensusProb,
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
        logger.warn(`  Player props fetch failed: ${error}`);
      }

      // 6.5.3c: Line Movement Detection (steam moves, opening value)
      logger.info('  Checking line movements...');
      try {
        const { recordAllLines, findLineMoveEdges, getLineTrackingStats } = await import('./edge/line-move-detector.js');

        // Record current lines for future comparison
        recordAllLines(sportsOdds);

        // Detect line moves and find edges
        const lineMoveEdges = findLineMoveEdges(kalshiMarkets, 0.03);
        stats.lineMoveEdges = lineMoveEdges.length;

        // Log tracking stats
        const trackingStats = getLineTrackingStats();
        logger.info(`    Tracking ${trackingStats.gamesTracked} games, ${trackingStats.totalSnapshots} snapshots`);

        if (lineMoveEdges.length > 0) {
          logger.success(`  ${lineMoveEdges.length} line move edges found`);

          // Log top edges for visibility
          for (const edge of lineMoveEdges.slice(0, 3)) {
            const emoji = edge.lineMove.moveType === 'steam' ? '🔥' : '📊';
            logger.info(`    ${emoji} ${edge.lineMove.awayTeam} @ ${edge.lineMove.homeTeam}: ${(edge.edge * 100).toFixed(1)}% edge`);
          }

          // Convert to opportunities
          for (const edge of lineMoveEdges.slice(0, 5)) {
            const opp: EdgeOpportunity = {
              market: edge.kalshiMarket,
              source: 'sports',
              edge: Math.abs(edge.edge),
              confidence: edge.confidence,
              urgency: edge.lineMove.moveType === 'steam' ? 'critical' : edge.edge > 0.06 ? 'standard' : 'fyi',
              direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
              signals: {
                lineMove: {
                  moveType: edge.lineMove.moveType,
                  direction: edge.lineMove.direction,
                  magnitude: edge.lineMove.magnitude,
                  timeframeMinutes: edge.lineMove.timeframeMinutes,
                  previousProb: edge.lineMove.previousProb,
                  currentProb: edge.lineMove.currentProb,
                  openingProb: edge.lineMove.openingProb,
                  reasoning: edge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      } catch (error) {
        logger.warn(`  Line move detection failed: ${error}`);
      }
    }

    // 6.5.3d: ESPN Sports Odds (no API key required - always runs)
    logger.info('  Fetching ESPN sports odds...');
    try {
      const espnOdds = await fetchAllSportsOddsESPN();
      let totalESPNGames = 0;
      let espnEdgesFound = 0;

      for (const [sport, games] of espnOdds) {
        totalESPNGames += games.length;
        if (games.length > 0) {
          logger.info(`    ESPN ${sport.toUpperCase()}: ${games.length} games`);
        }

        // Find edges between Kalshi and ESPN odds
        for (const game of games) {
          // Find matching Kalshi market
          const matchingMarket = kalshiMarkets.find(m => {
            const title = m.title?.toLowerCase() ?? '';
            const homeTeam = game.homeTeam.toLowerCase();
            const awayTeam = game.awayTeam.toLowerCase();
            return title.includes(homeTeam) || title.includes(awayTeam);
          });

          if (matchingMarket && game.odds) {
            // Determine if this market is for the home team
            const title = matchingMarket.title?.toLowerCase() ?? '';
            const isHomeTeam = title.includes(game.homeTeam.toLowerCase());

            const edge = findESPNEdge(matchingMarket.price, game.odds, isHomeTeam);
            if (edge && edge.edge >= 0.03) {
              espnEdgesFound++;
              const reasoning = `ESPN odds imply ${(edge.impliedProb * 100).toFixed(0)}% vs Kalshi ${(matchingMarket.price * 100).toFixed(0)}%`;
              const opp: EdgeOpportunity = {
                market: matchingMarket,
                source: 'sports',
                edge: edge.edge,
                confidence: Math.min(edge.edge * 5, 0.8),
                urgency: edge.edge > 0.08 ? 'critical' : edge.edge > 0.05 ? 'standard' : 'fyi',
                direction: edge.direction,
                signals: {
                  espnOdds: {
                    homeTeam: game.homeTeam,
                    awayTeam: game.awayTeam,
                    homeSpread: game.odds.homeSpread,
                    homeMoneyline: game.odds.homeMoneyline,
                    awayMoneyline: game.odds.awayMoneyline,
                    espnImpliedProb: edge.impliedProb,
                    reasoning,
                  },
                },
              };
              opp.sizing = calculateAdaptivePosition(bankroll, opp);
              opportunities.push(opp);
            }
          }
        }
      }

      stats.espnOddsGames = totalESPNGames;
      stats.espnEdges = espnEdgesFound;
      logger.success(`  ESPN: ${totalESPNGames} games, ${espnEdgesFound} edges found`);
    } catch (error) {
      logger.warn(`  ESPN odds fetch failed: ${error}`);
    }

    // 6.5.3b: Enhanced Sports Edge Detection (sharp/square + injuries + weather)
    logger.info('  Checking enhanced sports edges...');
    try {
      const { detectEnhancedSportsEdges } = await import('./edge/enhanced-sports-edge.js');

      // Check each major sport
      const sports: Array<'nfl' | 'nba' | 'mlb' | 'nhl'> = ['nfl', 'nba', 'mlb', 'nhl'];
      let totalEnhancedEdges = 0;

      for (const sport of sports) {
        const sportMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          const category = m.category?.toLowerCase() ?? '';
          return category === 'sports' || title.includes(sport) ||
                 (sport === 'nfl' && (title.includes('football') || title.includes('super bowl'))) ||
                 (sport === 'nba' && title.includes('basketball')) ||
                 (sport === 'mlb' && title.includes('baseball')) ||
                 (sport === 'nhl' && title.includes('hockey'));
        });

        if (sportMarkets.length === 0) continue;

        const enhancedEdges = await detectEnhancedSportsEdges(sportMarkets, sport);

        if (enhancedEdges.length > 0) {
          logger.info(`    ${sport.toUpperCase()}: ${enhancedEdges.length} enhanced edges`);
          totalEnhancedEdges += enhancedEdges.length;

          // Convert to opportunities
          for (const edge of enhancedEdges.slice(0, 3)) {
            const opp: EdgeOpportunity = {
              market: edge.market,
              source: 'sports',
              edge: edge.compositeEdge,
              confidence: edge.confidence,
              urgency: edge.compositeEdge > 0.08 ? 'critical' : edge.compositeEdge > 0.04 ? 'standard' : 'fyi',
              direction: edge.direction === 'home' ? 'BUY YES' : 'BUY NO',
              signals: {
                enhancedSports: {
                  sport,
                  homeTeam: edge.homeTeam,
                  awayTeam: edge.awayTeam,
                  compositeEdge: edge.compositeEdge,
                  sharpEdge: edge.sharpEdge?.edge,
                  injuryAdvantage: edge.injuryEdge?.healthAdvantage,
                  weatherImpact: edge.weatherEdge?.impactScore,
                  signals: edge.signals,
                  primaryReason: edge.primaryReason,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      }

      stats.enhancedSportsEdges = totalEnhancedEdges;
      if (totalEnhancedEdges > 0) {
        logger.success(`  ${totalEnhancedEdges} enhanced sports edges found`);
      }
    } catch (error) {
      logger.warn(`  Enhanced sports edge detection failed: ${error}`);
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

        // Convert to opportunities only (NOT macro signals - recency bias is not macro)
        for (const sig of recencySignals.slice(0, 3)) {
          const opp: EdgeOpportunity = {
            market: sig.market,
            source: 'combined',
            edge: Math.abs(sig.edge),
            confidence: sig.confidence,
            urgency: sig.overreactionFactor > 2.5 ? 'critical' : sig.overreactionFactor > 2.0 ? 'standard' : 'fyi',
            direction: sig.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
            signals: {
              recencyBias: true,
            },
          };
          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);
        }
      }
    } catch (error) {
      logger.warn(`  Recency bias analysis failed: ${error}`);
    }

    // 6.5.5b: Whale Auto-Discovery (find profitable Polymarket traders)
    logger.info('  Discovering profitable wallets...');
    try {
      const { discoverProfitableWallets, getWhaleDiscoveryStats } = await import('./fetchers/whale-discovery.js');

      // Discover wallets with $50k+ profit
      const discoveryResult = await discoverProfitableWallets(50000, 50);

      if (discoveryResult.newWhales.length > 0) {
        logger.success(`  Discovered ${discoveryResult.newWhales.length} new profitable wallets`);
      }

      // Log discovery stats
      const stats = getWhaleDiscoveryStats();
      logger.info(`    Tracking ${stats.totalTracked} wallets (${stats.highConfidenceCount} high-confidence)`);
      logger.info(`    Total PnL tracked: $${(stats.totalPnlTracked / 1000000).toFixed(1)}M | Avg win rate: ${(stats.avgWinRate * 100).toFixed(0)}%`);
    } catch (error) {
      logger.warn(`  Whale discovery failed: ${error}`);
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
            signals: {
              entertainment: {
                movieTitle: edge.movieTitle,
                currentScore: edge.currentScore ?? 0,
                threshold: edge.threshold ?? 0,
                scoreType: edge.scoreType ?? 'tomatometer',
                reviewCount: edge.reviewCount,
                buffer: (edge.currentScore ?? 0) - (edge.threshold ?? 0),
                sources: edge.movieData?.sources ?? [],
              },
            },
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
                weekNumber: edge.weekNumber,
                reasoning: edge.reasoning,
              },
            },
          });
        }
      }
    } catch (error) {
      logger.warn(`  CDC measles edge detection failed: ${error}`);
    }

    // 6.5.10b: Health Trackers (Flu, COVID, Mpox)
    logger.info('  Checking health market edges (flu/COVID/mpox)...');
    try {
      const { fetchAllHealthData, calculateDiseaseThresholdProbability } = await import('./fetchers/health-trackers.js');

      // Fetch health data
      const healthData = await fetchAllHealthData();
      let healthEdgesFound = 0;

      if (healthData.size > 0) {
        logger.info(`    Tracking ${healthData.size} diseases`);

        // Find health-related markets
        const healthMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('flu') || title.includes('covid') ||
                 title.includes('mpox') || title.includes('hospitalization') ||
                 title.includes('pandemic') || title.includes('outbreak');
        });

        for (const market of healthMarkets) {
          const title = market.title?.toLowerCase() ?? '';

          // Determine which disease this market is about
          let disease: 'flu' | 'covid' | 'mpox' | null = null;
          if (title.includes('flu') || title.includes('influenza')) {
            disease = 'flu';
          } else if (title.includes('covid') || title.includes('coronavirus')) {
            disease = 'covid';
          } else if (title.includes('mpox') || title.includes('monkeypox')) {
            disease = 'mpox';
          }

          if (!disease || !healthData.has(disease)) continue;

          const data = healthData.get(disease)!;

          // Extract threshold from market title
          const thresholdMatch = title.match(/([\d,]+)\s*(cases|hospitalizations|deaths)?/);
          if (!thresholdMatch) continue;

          const threshold = parseInt(thresholdMatch[1].replace(/,/g, ''));
          const thresholdType = (thresholdMatch[2] ?? 'cases') as 'cases' | 'hospitalizations';

          // Calculate edge
          const edgeResult = calculateDiseaseThresholdProbability(data, threshold, thresholdType);

          const marketPrice = market.price ?? 0.5;
          const edge = edgeResult.probability - marketPrice;

          if (Math.abs(edge) >= 0.05) {
            healthEdgesFound++;

            opportunities.push({
              market,
              source: 'combined',
              edge: Math.abs(edge),
              confidence: edgeResult.confidence,
              urgency: Math.abs(edge) > 0.15 ? 'critical' : Math.abs(edge) > 0.08 ? 'standard' : 'fyi',
              direction: edge > 0 ? 'BUY YES' : 'BUY NO',
              signals: {},
            });

            logger.info(`    ${disease.toUpperCase()}: ${(edge * 100).toFixed(1)}% edge on ${threshold.toLocaleString()} ${thresholdType}`);
          }
        }
      }

      if (healthEdgesFound > 0) {
        logger.success(`  ${healthEdgesFound} health market edges found`);
      }
    } catch (error) {
      logger.warn(`  Health tracker failed: ${error}`);
    }

    // 6.5.10c: CDC Wastewater Surveillance (leading indicator for case counts)
    logger.info('  Checking CDC wastewater surveillance...');
    try {
      const wastewater = await fetchWastewaterData();
      const cdcFlu = await fetchCDCFluData();

      if (wastewater.length > 0) {
        logger.info(`    Wastewater: ${wastewater.length} jurisdictions monitored`);

        // Find health markets that could benefit from wastewater leading indicator
        const healthMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('covid') || title.includes('hospitalization') ||
                 title.includes('case') || title.includes('pandemic');
        });

        for (const market of healthMarkets) {
          const title = market.title?.toLowerCase() ?? '';

          // Extract threshold from market title
          const thresholdMatch = title.match(/([\d,]+)\s*(cases|hospitalizations)?/);
          if (!thresholdMatch) continue;

          const threshold = parseInt(thresholdMatch[1].replace(/,/g, ''));

          // Estimate current case count (would need real data)
          const estimatedCurrentCases = 50000; // Placeholder - would come from CDC API

          const wastewaterEdge = analyzeWastewaterEdge(wastewater, threshold, estimatedCurrentCases);

          if (wastewaterEdge) {
            stats.cdcWastewaterSignals++;
            const opp: EdgeOpportunity = {
              market,
              source: 'combined',
              edge: wastewaterEdge.confidence * 0.15, // Scale confidence to edge
              confidence: wastewaterEdge.confidence,
              urgency: wastewaterEdge.confidence > 0.7 ? 'critical' : wastewaterEdge.confidence > 0.5 ? 'standard' : 'fyi',
              direction: wastewaterEdge.direction,
              signals: {
                wastewater: {
                  currentLevel: wastewaterEdge.currentLevel,
                  projectedLevel: wastewaterEdge.projectedLevel,
                  leadDays: wastewaterEdge.leadDays,
                  reasoning: wastewaterEdge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);

            logger.info(`    🧪 Wastewater ${wastewaterEdge.direction}: ${wastewaterEdge.reasoning}`);
          }
        }
      }

      if (cdcFlu.length > 0) {
        logger.info(`    Flu surveillance: ${cdcFlu.length} data points`);
      }

      if (stats.cdcWastewaterSignals > 0) {
        logger.success(`  ${stats.cdcWastewaterSignals} CDC wastewater signals`);
      }
    } catch (error) {
      logger.warn(`  CDC wastewater surveillance failed: ${error}`);
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

    // 6.5.13: Options-Implied Edge Detection (Fed Funds, SPX, Treasury)
    logger.info('  Checking options-implied edges...');
    try {
      const { fetchAllOptionsImplied, findOptionsEdge } = await import('./fetchers/options-implied.js');

      // Fetch options-implied data
      const optionsData = await fetchAllOptionsImplied();

      let optionsEdgesFound = 0;

      // Match Fed rate markets to Fed Funds implied
      if (optionsData.fedFunds) {
        const fedMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return (title.includes('fed') || title.includes('fomc') || title.includes('rate')) &&
                 (title.includes('cut') || title.includes('hike') || title.includes('hold'));
        });

        for (const market of fedMarkets) {
          const title = market.title?.toLowerCase() ?? '';
          let impliedProb: number | null = null;
          let marketType = '';

          if (title.includes('cut')) {
            impliedProb = optionsData.fedFunds.probCut25 + optionsData.fedFunds.probCut50;
            marketType = 'Fed cut';
          } else if (title.includes('hike') || title.includes('raise')) {
            impliedProb = optionsData.fedFunds.probHike25 + optionsData.fedFunds.probHike50;
            marketType = 'Fed hike';
          } else if (title.includes('hold') || title.includes('unchanged')) {
            impliedProb = optionsData.fedFunds.probHold;
            marketType = 'Fed hold';
          }

          if (impliedProb !== null) {
            const edgeResult = findOptionsEdge(market.price, impliedProb, optionsData.fedFunds.source);
            if (edgeResult && Math.abs(edgeResult.edge) >= 0.03) {
              optionsEdgesFound++;
              const opp: EdgeOpportunity = {
                market,
                source: 'options',
                edge: Math.abs(edgeResult.edge),
                confidence: edgeResult.confidence,
                urgency: Math.abs(edgeResult.edge) > 0.10 ? 'critical' : Math.abs(edgeResult.edge) > 0.05 ? 'standard' : 'fyi',
                direction: edgeResult.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
                signals: {
                  optionsImplied: {
                    source: optionsData.fedFunds.source,
                    impliedProb,
                    marketPrice: market.price,
                    dataType: 'fed',
                    reasoning: `${marketType}: Options imply ${(impliedProb * 100).toFixed(0)}% vs market ${(market.price * 100).toFixed(0)}%`,
                  },
                },
              };
              opp.sizing = calculateAdaptivePosition(bankroll, opp);
              opportunities.push(opp);
            }
          }
        }
      }

      // Match recession markets to Treasury curve
      if (optionsData.treasury) {
        const recessionMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('recession');
        });

        for (const market of recessionMarkets) {
          const impliedProb = optionsData.treasury.recessionProb12m;
          const edgeResult = findOptionsEdge(market.price, impliedProb, 'treasury');

          if (edgeResult && Math.abs(edgeResult.edge) >= 0.03) {
            optionsEdgesFound++;
            const opp: EdgeOpportunity = {
              market,
              source: 'options',
              edge: Math.abs(edgeResult.edge),
              confidence: edgeResult.confidence,
              urgency: Math.abs(edgeResult.edge) > 0.10 ? 'critical' : Math.abs(edgeResult.edge) > 0.05 ? 'standard' : 'fyi',
              direction: edgeResult.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
              signals: {
                optionsImplied: {
                  source: 'treasury_curve',
                  impliedProb,
                  marketPrice: market.price,
                  dataType: 'recession',
                  reasoning: `Yield curve implies ${(impliedProb * 100).toFixed(0)}% recession prob vs market ${(market.price * 100).toFixed(0)}%`,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      }

      // Match SPX level markets to options implied
      if (optionsData.spx) {
        const spxMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('s&p') || title.includes('sp500') || title.includes('spx') ||
                 (title.includes('stock') && title.includes('market'));
        });

        for (const market of spxMarkets) {
          const title = market.title?.toLowerCase() ?? '';

          // Check for "down X%" or "crash" markets
          let impliedProb: number | null = null;
          let marketType = '';

          if (title.includes('down 10') || title.includes('drop 10') || title.includes('fall 10')) {
            impliedProb = optionsData.spx.probDown10;
            marketType = 'SPX down 10%';
          } else if (title.includes('down 20') || title.includes('drop 20') || title.includes('crash')) {
            impliedProb = optionsData.spx.probDown20;
            marketType = 'SPX down 20%';
          }

          if (impliedProb !== null) {
            const edgeResult = findOptionsEdge(market.price, impliedProb, 'spx');
            if (edgeResult && Math.abs(edgeResult.edge) >= 0.02) {
              optionsEdgesFound++;
              const opp: EdgeOpportunity = {
                market,
                source: 'options',
                edge: Math.abs(edgeResult.edge),
                confidence: edgeResult.confidence,
                urgency: Math.abs(edgeResult.edge) > 0.10 ? 'critical' : Math.abs(edgeResult.edge) > 0.05 ? 'standard' : 'fyi',
                direction: edgeResult.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
                signals: {
                  optionsImplied: {
                    source: 'spx_options',
                    impliedProb,
                    marketPrice: market.price,
                    dataType: 'spx',
                    reasoning: `${marketType}: VIX implies ${(impliedProb * 100).toFixed(1)}% prob vs market ${(market.price * 100).toFixed(0)}%`,
                  },
                },
              };
              opp.sizing = calculateAdaptivePosition(bankroll, opp);
              opportunities.push(opp);
            }
          }
        }
      }

      stats.optionsImpliedSignals = optionsEdgesFound;
      if (optionsEdgesFound > 0) {
        logger.success(`  ${optionsEdgesFound} options-implied edges found`);
      }
    } catch (error) {
      logger.warn(`  Options-implied edge detection failed: ${error}`);
    }

    // 6.5.13b: Crypto Funding Rates (contrarian signals from Hyperliquid)
    logger.info('  Checking crypto funding rates...');
    try {
      const [fundingRates, fearGreed] = await Promise.all([
        fetchFundingRates(),
        fetchFearGreedIndex(),
      ]);

      if (fundingRates.length > 0) {
        logger.info(`    Funding rates: ${fundingRates.length} symbols from Hyperliquid`);

        // Log extreme funding conditions
        const extremeFunding = fundingRates.filter(f => f.contrarian !== null);
        for (const f of extremeFunding) {
          logger.info(`    ⚠️ ${f.symbol}: ${f.weightedFundingRate.toFixed(4)}% funding (${f.extremeLevel}) - ${f.contrarian} signal`);
        }

        // Find crypto markets and apply funding rate signals
        const cryptoMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('bitcoin') || title.includes('btc') ||
                 title.includes('ethereum') || title.includes('eth') ||
                 title.includes('solana') || title.includes('sol') ||
                 title.includes('crypto') || title.includes('doge');
        });

        for (const market of cryptoMarkets) {
          const title = market.title?.toLowerCase() ?? '';

          // Determine if this is an "up" or "down" market
          const isUpMarket = title.includes('above') || title.includes('over') ||
                            title.includes('reach') || title.includes('hit') ||
                            (title.includes('price') && !title.includes('below'));

          // Find matching symbol
          let symbol = 'BTC';
          if (title.includes('ethereum') || title.includes('eth')) symbol = 'ETH';
          else if (title.includes('solana') || title.includes('sol')) symbol = 'SOL';
          else if (title.includes('doge')) symbol = 'DOGE';

          const fundingEdge = analyzeFundingEdge(fundingRates, symbol, market.price, isUpMarket);

          if (fundingEdge) {
            stats.cryptoFundingSignals++;
            const opp: EdgeOpportunity = {
              market,
              source: 'combined',
              edge: fundingEdge.strength * 0.12, // Scale strength to edge
              confidence: 0.5 + fundingEdge.strength * 0.3,
              urgency: fundingEdge.strength > 0.7 ? 'critical' : fundingEdge.strength > 0.4 ? 'standard' : 'fyi',
              direction: fundingEdge.direction,
              signals: {
                cryptoFunding: {
                  symbol: fundingEdge.symbol,
                  fundingRate: fundingEdge.data.fundingRate,
                  openInterest: fundingEdge.data.openInterest,
                  signalType: fundingEdge.signalType,
                  reasoning: fundingEdge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);

            logger.info(`    💰 ${symbol} ${fundingEdge.direction}: ${fundingEdge.reasoning}`);
          }
        }
      }

      // Fear & Greed Index as additional signal
      if (fearGreed) {
        logger.info(`    Fear & Greed: ${fearGreed.value} (${fearGreed.classification})`);

        // Apply Fear & Greed to BTC markets specifically
        const btcMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('bitcoin') || title.includes('btc');
        });

        for (const market of btcMarkets) {
          const title = market.title?.toLowerCase() ?? '';
          const isUpMarket = title.includes('above') || title.includes('over') || title.includes('reach');

          const fgEdge = analyzeFearGreedEdge(fearGreed, market.price, isUpMarket);

          if (fgEdge) {
            stats.cryptoFundingSignals++;
            const opp: EdgeOpportunity = {
              market,
              source: 'combined',
              edge: fgEdge.strength * 0.10,
              confidence: 0.5 + fgEdge.strength * 0.25,
              urgency: fgEdge.strength > 0.6 ? 'standard' : 'fyi',
              direction: fgEdge.direction,
              signals: {
                fearGreed: {
                  value: fearGreed.value,
                  classification: fearGreed.classification,
                  reasoning: fgEdge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);
          }
        }
      }

      if (stats.cryptoFundingSignals > 0) {
        logger.success(`  ${stats.cryptoFundingSignals} crypto funding/sentiment signals`);
      }
    } catch (error) {
      logger.warn(`  Crypto funding rate check failed: ${error}`);
    }

    // 6.5.13c: Fed Nowcasts (GDPNow, Inflation estimates)
    logger.info('  Checking Fed nowcasts...');
    try {
      const [gdpNow, inflationNow] = await Promise.all([
        fetchGDPNow(),
        fetchInflationNowcast(),
      ]);

      if (gdpNow) {
        logger.info(`    GDPNow ${gdpNow.quarter}: ${gdpNow.estimate.toFixed(2)}%`);

        // Find GDP markets
        const gdpMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('gdp') || title.includes('growth') ||
                 (title.includes('recession') && !title.includes('yield'));
        });

        for (const market of gdpMarkets) {
          // Extract threshold from market title (e.g., "GDP above 2%")
          const thresholdMatch = market.title?.match(/(\d+\.?\d*)%/);
          const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 2.0;

          const gdpEdge = analyzeGDPEdge(gdpNow, threshold, market.price);

          if (gdpEdge) {
            stats.fedNowcastSignals++;
            const opp: EdgeOpportunity = {
              market,
              source: 'macro',
              edge: gdpEdge.edge,
              confidence: gdpEdge.confidence,
              urgency: gdpEdge.edge > 0.10 ? 'critical' : gdpEdge.edge > 0.05 ? 'standard' : 'fyi',
              direction: gdpEdge.direction,
              signals: {
                gdpNow: {
                  estimate: gdpNow.estimate,
                  quarter: gdpNow.quarter,
                  impliedProb: gdpEdge.marketImplied,
                  reasoning: gdpEdge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);

            logger.info(`    📈 GDP ${gdpEdge.direction}: ${gdpEdge.reasoning}`);
          }
        }
      }

      if (inflationNow) {
        logger.info(`    Inflation nowcast: ${inflationNow.headline.toFixed(2)}%`);

        // Find inflation/CPI markets
        const inflationMarkets = kalshiMarkets.filter(m => {
          const title = m.title?.toLowerCase() ?? '';
          return title.includes('cpi') || title.includes('inflation') ||
                 title.includes('pce') || title.includes('price');
        });

        for (const market of inflationMarkets) {
          // Extract threshold from market title (e.g., "CPI above 3%")
          const thresholdMatch = market.title?.match(/(\d+\.?\d*)%/);
          const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 2.5;

          const inflationEdge = analyzeInflationEdge(inflationNow, threshold, market.price);

          if (inflationEdge) {
            stats.fedNowcastSignals++;
            const opp: EdgeOpportunity = {
              market,
              source: 'macro',
              edge: inflationEdge.edge,
              confidence: inflationEdge.confidence,
              urgency: inflationEdge.edge > 0.08 ? 'critical' : inflationEdge.edge > 0.04 ? 'standard' : 'fyi',
              direction: inflationEdge.direction,
              signals: {
                inflationNow: {
                  headline: inflationNow.headline,
                  month: inflationNow.month,
                  impliedProb: inflationEdge.marketImplied,
                  reasoning: inflationEdge.reasoning,
                },
              },
            };
            opp.sizing = calculateAdaptivePosition(bankroll, opp);
            opportunities.push(opp);

            logger.info(`    📊 Inflation ${inflationEdge.direction}: ${inflationEdge.reasoning}`);
          }
        }
      }

      if (stats.fedNowcastSignals > 0) {
        logger.success(`  ${stats.fedNowcastSignals} Fed nowcast signals`);
      }
    } catch (error) {
      logger.warn(`  Fed nowcast check failed: ${error}`);
    }

    // 6.5.14: New Market Scanner (early mover advantage on fresh markets)
    logger.info('  Scanning for new markets...');
    try {
      const { scanNewMarkets } = await import('./edge/new-market-scanner.js');
      const scanResult = await scanNewMarkets();

      // Count all markets with high or medium early mover advantage
      const actionableNewMarkets = [
        ...scanResult.newMarkets.filter(m => m.earlyMoverAdvantage !== 'low'),
        ...scanResult.recentMarkets.filter(m => m.earlyMoverAdvantage === 'high'),
      ];

      stats.newMarketsDetected = actionableNewMarkets.length;

      if (actionableNewMarkets.length > 0) {
        logger.success(`  ${actionableNewMarkets.length} new markets with early mover advantage`);

        // Convert to opportunities (top 5 with best advantage)
        for (const newMarket of actionableNewMarkets.slice(0, 5)) {
          // Determine edge - use potential edge from similar markets or a baseline
          const edge = newMarket.potentialEdge ?? (newMarket.earlyMoverAdvantage === 'high' ? 0.08 : 0.05);

          // Skip if edge is too small
          if (edge < 0.03) continue;

          // Determine direction based on external reference or similar markets
          // Default to BUY YES if we have an external reference suggesting underpricing
          let direction: 'BUY YES' | 'BUY NO' = 'BUY YES';
          if (newMarket.similarMarkets && newMarket.similarMarkets.length > 0) {
            const avgSimilarPrice = newMarket.similarMarkets.reduce((s, m) => s + m.price, 0) / newMarket.similarMarkets.length;
            direction = avgSimilarPrice > newMarket.market.price ? 'BUY YES' : 'BUY NO';
          }

          const opp: EdgeOpportunity = {
            market: {
              platform: newMarket.market.platform,
              id: newMarket.market.id,
              title: newMarket.market.title,
              category: (newMarket.market.category || 'other') as Market['category'],
              price: newMarket.market.price,
              volume: newMarket.market.volume,
              url: newMarket.market.url,
            },
            source: 'new-market',
            edge,
            confidence: newMarket.earlyMoverAdvantage === 'high' ? 0.6 : 0.5,
            urgency: newMarket.earlyMoverAdvantage === 'high' ? 'critical' : 'standard',
            direction,
            signals: {
              newMarket: {
                ageMinutes: newMarket.ageMinutes,
                earlyMoverAdvantage: newMarket.earlyMoverAdvantage,
                potentialEdge: newMarket.potentialEdge,
                liquidityTrend: newMarket.liquidityTrend,
                hasExternalReference: newMarket.hasExternalReference,
                similarMarkets: newMarket.similarMarkets?.length,
              },
            },
          };

          opp.sizing = calculateAdaptivePosition(bankroll, opp);
          opportunities.push(opp);

          // Log for visibility
          const emoji = newMarket.earlyMoverAdvantage === 'high' ? '🚀' : '⚡';
          logger.info(`    ${emoji} ${newMarket.market.title.slice(0, 40)}... (${newMarket.ageMinutes}min old)`);
        }
      }
    } catch (error) {
      logger.warn(`  New market scanner failed: ${error}`);
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
    let filteredByPrice = 0;
    let filteredByEdge = 0;
    let filteredByConfidence = 0;

    const validOpportunities = opportunities.filter(opp => {
      const price = opp.market.price ?? 0;
      const edge = opp.edge ?? 0;

      // Must have valid price (not 0, not extreme)
      if (price <= 0 || price >= 1) {
        filteredByPrice++;
        return false;
      }

      // Edge cap depends on signal type
      // Some signal types can have larger legitimate edges due to market structure
      const isPlayerProp = opp.signals?.playerProp !== undefined;
      const isSportsOdds = opp.signals?.sportsConsensus !== undefined || opp.signals?.enhancedSports !== undefined;
      const isEarnings = opp.signals?.earnings !== undefined;
      const isFedSpeech = opp.signals?.fedSpeech !== undefined;
      const maxEdge = (isPlayerProp || isSportsOdds || isEarnings || isFedSpeech) ? 0.90 : 0.50;

      if (edge > maxEdge) {
        filteredByEdge++;
        return false;
      }

      // Lower confidence threshold to 35% (was 40%)
      if (opp.confidence < 0.35) {
        filteredByConfidence++;
        return false;
      }

      return true;
    });

    const filtered = opportunities.length - validOpportunities.length;
    if (filtered > 0) {
      logger.debug(`Filtered ${filtered} opportunities: ${filteredByPrice} bad price, ${filteredByEdge} edge too high, ${filteredByConfidence} low confidence`);
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

    // First, send grouped multi-outcome alerts (earnings, fed speech, elections with multiple options)
    // This groups all edges for the same company/market into a single message
    const { sent: groupedIds, grouped: groupedCount } = await sendGroupedMultiOutcomeAlerts(scoredOpportunities);
    if (groupedCount > 0) {
      logger.info(`  Sent ${groupedCount} grouped multi-outcome alerts (${groupedIds.size} individual edges)`);
      stats.alertsSent += groupedCount;
    }

    // Send remaining top opportunities that weren't part of a group
    const ungroupedOpps = scoredOpportunities.filter(opp => {
      const key = `${opp.market.platform}:${opp.market.id}`;
      return !groupedIds.has(key);
    });

    for (const opp of ungroupedOpps.slice(0, 5)) {
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

    // ========== STEP 8.5: RECORD PREDICTIONS FOR CALIBRATION ==========
    logger.step(8.5, 'Recording predictions for calibration tracking...');
    try {
      const {
        recordPrediction,
        getCalibrationReport,
        formatCalibrationReport,
      } = await import('./edge/calibration-tracker.js');

      // Record top opportunities as predictions for future calibration
      let predictionsRecorded = 0;
      for (const opp of scoredOpportunities.slice(0, 10)) {
        try {
          // Determine signal sources from the opportunity
          const signalSources: string[] = [];
          if (opp.signals.crossPlatform) signalSources.push('cross-platform');
          if (opp.signals.sentiment) signalSources.push('sentiment');
          if (opp.signals.whale) signalSources.push('whale');
          if (opp.signals.sportsConsensus) signalSources.push('sports-odds');
          if (opp.signals.whaleConviction) signalSources.push('whale-conviction');
          if (opp.signals.fedSpeech) signalSources.push('fed-speech');
          if (opp.signals.measles) signalSources.push('measles');
          if (opp.signals.earnings) signalSources.push('earnings');
          if (opp.signals.macroEdge) signalSources.push('macro');
          if (opp.signals.optionsImplied) signalSources.push('options');
          if (opp.signals.enhancedSports) signalSources.push('enhanced-sports');
          if (opp.signals.newMarket) signalSources.push('new-market');
          if (opp.signals.playerProp) signalSources.push('player-prop');
          if (opp.signals.lineMove) signalSources.push('line-move');
          if (signalSources.length === 0) signalSources.push(opp.source);

          // Calculate our implied estimate based on direction and edge
          const ourEstimate = opp.direction === 'BUY YES'
            ? opp.market.price + opp.edge
            : opp.market.price - opp.edge;

          recordPrediction({
            marketId: opp.market.id,
            marketTitle: opp.market.title,
            platform: opp.market.platform,
            category: opp.market.category,
            ourEstimate: Math.max(0.01, Math.min(0.99, ourEstimate)),
            marketPrice: opp.market.price,
            confidence: opp.adjustedConfidence ?? opp.confidence,
            signalSources,
          });

          predictionsRecorded++;
        } catch (err) {
          // Skip individual prediction errors
        }
      }

      if (predictionsRecorded > 0) {
        logger.info(`  Recorded ${predictionsRecorded} predictions for calibration`);
      }

      // Get calibration report for logging
      const calibrationReport = getCalibrationReport();
      if (calibrationReport.resolvedPredictions >= 10) {
        logger.info(`  Calibration: ${(calibrationReport.accuracy * 100).toFixed(0)}% accuracy, ${calibrationReport.brierScore.toFixed(3)} Brier (${calibrationReport.resolvedPredictions} resolved)`);

        if (calibrationReport.isOverconfident) {
          logger.warn('  ⚠️ Historical data suggests overconfidence - consider reducing position sizes');
        }
      }
    } catch (error) {
      logger.warn(`  Calibration tracking failed: ${error}`);
    }

    // ========== COMPLETE ==========
    const duration = (Date.now() - startTime) / 1000;

    // Save price history
    saveHistoryData();

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
