/**
 * Enhanced Sports Edge Detection
 *
 * Combines multiple sports data sources for comprehensive edge detection:
 * - Injury data (ESPN, Rotowire)
 * - Weather conditions (game-day impact)
 * - Sharp/square sportsbook divergence
 * - Line movement analysis
 *
 * Creates composite sports edges by stacking multiple signals.
 */

import { logger } from '../utils/index.js';
import type { Market } from '../types/index.js';
import { fetchSportOdds, type SportOdds } from '../fetchers/sports-odds.js';
import {
  fetchSportInjuries,
  compareTeamHealth,
  type InjuryReport,
} from '../fetchers/injuries.js';
import {
  getMatchupWeather,
  type GameWeather,
} from '../fetchers/weather.js';
import {
  calculateConsensus,
  findSharpSquareDivergence,
  compareToKalshiPrice,
  type ConsensusLine,
  type SharpEdge,
} from '../fetchers/sports-consensus.js';

// =============================================================================
// TYPES
// =============================================================================

export interface EnhancedSportsEdge {
  market: Market;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;

  // Edge components
  sharpEdge?: SharpEdge;
  injuryEdge?: InjuryEdge;
  weatherEdge?: WeatherEdgeComponent;

  // Composite edge
  compositeEdge: number;
  direction: 'home' | 'away';
  confidence: number;

  // Context
  consensus?: ConsensusLine;
  weather?: GameWeather;
  keyInjuries?: InjuryReport[];

  // Reasoning
  signals: string[];
  primaryReason: string;
}

export interface InjuryEdge {
  healthAdvantage: 'home' | 'away' | 'even';
  healthDiff: number;
  keyPlayersOut: { home: number; away: number };
  impactEstimate: number;  // Points of expected edge
  confidence: number;
}

export interface WeatherEdgeComponent {
  impactScore: number;
  favoredStyle: 'passing' | 'running' | 'balanced';
  alerts: string[];
  scoringImpact: 'higher' | 'lower' | 'neutral';
}

// =============================================================================
// MAIN EDGE DETECTION
// =============================================================================

/**
 * Detect enhanced sports edges for markets
 */
export async function detectEnhancedSportsEdges(
  markets: Market[],
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl' = 'nfl'
): Promise<EnhancedSportsEdge[]> {
  const edges: EnhancedSportsEdge[] = [];

  // Fetch odds from sportsbooks
  const odds = await fetchSportOdds(sport);
  if (odds.length === 0) {
    logger.debug('No odds data available');
    return edges;
  }

  // Fetch injury data
  const injuriesResult = await fetchSportInjuries(sport);
  const injuries = injuriesResult?.data ?? [];

  // Process each game
  for (const gameOdds of odds) {
    try {
      const edge = await analyzeGame(gameOdds, injuries, markets, sport);
      if (edge && edge.compositeEdge >= 0.03) {  // 3% minimum edge
        edges.push(edge);
      }
    } catch (error) {
      logger.debug(`Error analyzing game ${gameOdds.gameId}: ${error}`);
    }
  }

  // Sort by composite edge
  edges.sort((a, b) => b.compositeEdge - a.compositeEdge);

  logger.info(`Found ${edges.length} enhanced sports edges for ${sport}`);
  return edges;
}

/**
 * Analyze a single game for edges
 */
async function analyzeGame(
  odds: SportOdds,
  injuries: InjuryReport[],
  markets: Market[],
  sport: string
): Promise<EnhancedSportsEdge | null> {
  // Calculate consensus
  const consensus = calculateConsensus(odds);

  // Find sharp/square divergence
  const sharpEdges = findSharpSquareDivergence(consensus);

  // Analyze injuries
  const injuryAnalysis = analyzeInjuryEdge(odds.homeTeam, odds.awayTeam, injuries);

  // Get weather (for outdoor sports)
  let weather: GameWeather | null = null;
  let weatherEdge: WeatherEdgeComponent | undefined;

  if (sport === 'nfl' || sport === 'mlb') {
    const gameTime = new Date(odds.commenceTime);
    weather = await getMatchupWeather(odds.homeTeam, odds.awayTeam, sport as 'nfl' | 'mlb', gameTime);

    if (weather && weather.impact.overallScore >= 15) {
      weatherEdge = {
        impactScore: weather.impact.overallScore,
        favoredStyle: weather.impact.favoredStyle,
        alerts: weather.impact.alerts,
        scoringImpact: weather.impact.scoringImpact,
      };
    }
  }

  // Find matching Kalshi market
  const kalshiMarket = findMatchingKalshiMarket(markets, odds);

  if (!kalshiMarket) {
    return null;  // No corresponding Kalshi market
  }

  // Calculate composite edge
  const {
    compositeEdge,
    direction,
    confidence,
    signals,
    primaryReason,
  } = calculateCompositeEdge(
    consensus,
    sharpEdges[0],
    injuryAnalysis,
    weatherEdge,
    kalshiMarket
  );

  if (compositeEdge < 0.03) {
    return null;
  }

  return {
    market: kalshiMarket,
    gameId: odds.gameId,
    homeTeam: odds.homeTeam,
    awayTeam: odds.awayTeam,
    commenceTime: odds.commenceTime,
    sharpEdge: sharpEdges[0],
    injuryEdge: injuryAnalysis,
    weatherEdge,
    compositeEdge,
    direction,
    confidence,
    consensus,
    weather: weather ?? undefined,
    keyInjuries: injuries.filter(i =>
      i.impactRating >= 0.5 &&
      (i.team.toLowerCase().includes(odds.homeTeam.toLowerCase()) ||
       i.team.toLowerCase().includes(odds.awayTeam.toLowerCase()))
    ),
    signals,
    primaryReason,
  };
}

/**
 * Analyze injury edge between teams
 */
function analyzeInjuryEdge(
  homeTeam: string,
  awayTeam: string,
  injuries: InjuryReport[]
): InjuryEdge | undefined {
  const comparison = compareTeamHealth(homeTeam, awayTeam, injuries);

  if (comparison.healthAdvantage === 'even') {
    return undefined;
  }

  // Each point of health advantage ≈ 0.5-1 points of spread impact
  const impactEstimate = comparison.healthDiff * 0.03;  // Roughly 3% per 10 health points

  return {
    healthAdvantage: comparison.healthAdvantage,
    healthDiff: comparison.healthDiff,
    keyPlayersOut: {
      home: comparison.keyInjuries.filter(i => i.team.toLowerCase().includes(homeTeam.toLowerCase())).length,
      away: comparison.keyInjuries.filter(i => i.team.toLowerCase().includes(awayTeam.toLowerCase())).length,
    },
    impactEstimate,
    confidence: Math.min(0.8, 0.5 + (comparison.healthDiff / 50)),
  };
}

/**
 * Calculate composite edge from all signals
 */
function calculateCompositeEdge(
  consensus: ConsensusLine,
  sharpEdge: SharpEdge | undefined,
  injuryEdge: InjuryEdge | undefined,
  weatherEdge: WeatherEdgeComponent | undefined,
  market: Market
): {
  compositeEdge: number;
  direction: 'home' | 'away';
  confidence: number;
  signals: string[];
  primaryReason: string;
} {
  let totalEdge = 0;
  let totalWeight = 0;
  const signals: string[] = [];
  let primaryReason = '';
  let direction: 'home' | 'away' = 'home';

  // Sharp/square divergence (weight: 40%)
  if (sharpEdge && sharpEdge.edge >= 0.5) {
    const edgeContribution = sharpEdge.edge * 0.02;  // Convert points to probability
    totalEdge += edgeContribution * 0.4;
    totalWeight += 0.4;

    direction = sharpEdge.sharpSide.toLowerCase().includes(consensus.homeTeam.toLowerCase())
      ? 'home' : 'away';

    signals.push(`Sharp consensus: ${sharpEdge.sharpSide} +${sharpEdge.edge.toFixed(1)}pts`);
    primaryReason = sharpEdge.reason;
  }

  // Injury edge (weight: 30%)
  if (injuryEdge && injuryEdge.healthDiff >= 10) {
    totalEdge += injuryEdge.impactEstimate * 0.3;
    totalWeight += 0.3;

    // Injury advantage aligns with or overrides direction
    const injuryDirection = injuryEdge.healthAdvantage;
    if (injuryDirection !== 'even' && (!sharpEdge || injuryEdge.healthDiff >= 20)) {
      direction = injuryDirection;
    }

    signals.push(`Health advantage: ${injuryDirection} +${injuryEdge.healthDiff.toFixed(0)} health pts`);

    if (!primaryReason) {
      primaryReason = `${injuryDirection.charAt(0).toUpperCase() + injuryDirection.slice(1)} team significantly healthier`;
    }
  }

  // Weather edge (weight: 15%)
  if (weatherEdge && weatherEdge.impactScore >= 20) {
    // Weather doesn't directly favor a side, but affects game style
    const weatherContribution = weatherEdge.impactScore * 0.001;
    totalEdge += weatherContribution * 0.15;
    totalWeight += 0.15;

    signals.push(`Weather impact: ${weatherEdge.impactScore}/100 (${weatherEdge.favoredStyle} game)`);
    for (const alert of weatherEdge.alerts.slice(0, 2)) {
      signals.push(`  ⚠️ ${alert}`);
    }
  }

  // Compare to Kalshi market price (weight: 15%)
  if (consensus.sharpSide && market.price) {
    const kalshiComparison = compareToKalshiPrice(
      consensus,
      market.price,
      consensus.sharpSide
    );

    if (kalshiComparison.edge >= 0.03) {
      totalEdge += kalshiComparison.edge * 0.15;
      totalWeight += 0.15;
      signals.push(`vs Kalshi: ${kalshiComparison.direction.toUpperCase()} (${(kalshiComparison.edge * 100).toFixed(1)}% edge)`);
    }
  }

  // Normalize edge if we have weights
  const compositeEdge = totalWeight > 0 ? totalEdge / totalWeight : 0;

  // Confidence is average of component confidences
  const confidences: number[] = [];
  if (sharpEdge) confidences.push(consensus.confidence);
  if (injuryEdge) confidences.push(injuryEdge.confidence);
  confidences.push(0.6);  // Base confidence

  const confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

  // Boost confidence if signals align
  const boostedConfidence = signals.length >= 3
    ? Math.min(0.9, confidence * 1.15)
    : confidence;

  return {
    compositeEdge,
    direction,
    confidence: boostedConfidence,
    signals,
    primaryReason: primaryReason || 'Multiple signals align',
  };
}

/**
 * Find matching Kalshi market for a game
 */
function findMatchingKalshiMarket(markets: Market[], odds: SportOdds): Market | undefined {
  const homeTeamLower = odds.homeTeam.toLowerCase();
  const awayTeamLower = odds.awayTeam.toLowerCase();

  // Extract key words from team names (last word is usually nickname)
  const homeNickname = homeTeamLower.split(' ').pop() ?? homeTeamLower;
  const awayNickname = awayTeamLower.split(' ').pop() ?? awayTeamLower;

  for (const market of markets) {
    const title = market.title.toLowerCase();

    // Check if market mentions both teams
    const hasHome = title.includes(homeTeamLower) ||
                    title.includes(homeNickname) ||
                    homeTeamLower.includes(title.split(' ').find(w => w.length > 3) ?? '');

    const hasAway = title.includes(awayTeamLower) ||
                    title.includes(awayNickname) ||
                    awayTeamLower.includes(title.split(' ').find(w => w.length > 3) ?? '');

    if (hasHome && hasAway) {
      return market;
    }

    // Check for "X vs Y" or "X @ Y" patterns
    if ((title.includes(' vs ') || title.includes(' @ ')) &&
        (title.includes(homeNickname) || title.includes(awayNickname))) {
      return market;
    }
  }

  return undefined;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format enhanced sports edge for Discord
 */
export function formatEnhancedSportsEdge(edge: EnhancedSportsEdge): string {
  const actionIcon = edge.direction === 'home' ? '🏠' : '✈️';
  const team = edge.direction === 'home' ? edge.homeTeam : edge.awayTeam;

  const lines: string[] = [
    `🏈 **ENHANCED SPORTS EDGE**`,
    '',
    `**${edge.awayTeam} @ ${edge.homeTeam}**`,
    `📅 ${new Date(edge.commenceTime).toLocaleString()}`,
    '',
    '```',
    `${actionIcon} BET ${team.toUpperCase()}`,
    '```',
    '',
    `📊 **Composite Edge:** ${(edge.compositeEdge * 100).toFixed(1)}%`,
    `🎯 **Confidence:** ${(edge.confidence * 100).toFixed(0)}%`,
    '',
    `**Signals:**`,
  ];

  for (const signal of edge.signals) {
    lines.push(`• ${signal}`);
  }

  if (edge.keyInjuries && edge.keyInjuries.length > 0) {
    lines.push('');
    lines.push('**🏥 Key Injuries:**');
    for (const injury of edge.keyInjuries.slice(0, 3)) {
      const icon = injury.status === 'out' ? '🔴' : '🟡';
      lines.push(`${icon} ${injury.playerName} (${injury.team}) - ${injury.status}`);
    }
  }

  if (edge.weather && edge.weather.impact.overallScore >= 15) {
    lines.push('');
    lines.push('**🌤️ Weather:**');
    lines.push(`${edge.weather.conditions.temperature}°F, ${edge.weather.conditions.windSpeed}mph wind`);
    for (const alert of edge.weather.impact.alerts.slice(0, 2)) {
      lines.push(`⚠️ ${alert}`);
    }
  }

  lines.push('');
  lines.push(`_${edge.primaryReason}_`);

  if (edge.market.url) {
    lines.push('');
    lines.push(`[>>> TRADE NOW <<<](${edge.market.url})`);
  }

  return lines.join('\n');
}

/**
 * Generate daily sports edge summary
 */
export async function generateSportsEdgeSummary(
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl' = 'nfl'
): Promise<string> {
  const markets: Market[] = [];  // Would be passed from pipeline
  const edges = await detectEnhancedSportsEdges(markets, sport);

  if (edges.length === 0) {
    return `No ${sport.toUpperCase()} edges detected today.`;
  }

  const lines: string[] = [
    `**🏈 ${sport.toUpperCase()} Edge Summary**`,
    '',
    `Found ${edges.length} opportunities:`,
    '',
  ];

  for (const edge of edges.slice(0, 5)) {
    const team = edge.direction === 'home' ? edge.homeTeam : edge.awayTeam;
    lines.push(`• **${team}** vs ${edge.direction === 'home' ? edge.awayTeam : edge.homeTeam} (+${(edge.compositeEdge * 100).toFixed(1)}%)`);
  }

  return lines.join('\n');
}
