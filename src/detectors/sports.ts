/**
 * Comprehensive Sports Edge Detector (v4)
 *
 * Unified sports edge detection that consolidates:
 * 1. Cross-platform odds edges (ESPN vs Kalshi)
 * 2. Injury overreaction edges (public panic fade)
 * 3. Line movement edges (steam moves, opening value)
 *
 * QUANT FOUNDATION:
 * - Sports betting markets are among the most efficient
 * - Edges exist in:
 *   a) Cross-platform arbitrage (Kalshi vs sportsbooks)
 *   b) Injury overreaction (public panic creates value)
 *   c) Line movement signals (sharp money flow)
 *
 * Uses context.sources['espn-sports'] and context.sources['injuries']
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import {
  type SportsData,
  type SportsGame,
  oddsToProb,
  spreadToWinProb,
} from '../sources/espn-sports.js';
import {
  type InjuryData,
  type InjuryReport,
  compareTeamHealth,
} from '../sources/injuries.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.05;           // Require 5% edge for sports
const MIN_CONFIDENCE = 0.55;
const INJURY_OVERREACTION_THRESHOLD = 0.03;  // 3% overreaction
const LINE_MOVE_THRESHOLD = 0.03;            // 3% move significant

// Team name normalization for matching
const TEAM_ALIASES: Record<string, string[]> = {
  'chiefs': ['kansas city chiefs', 'kc chiefs', 'kansas city'],
  'eagles': ['philadelphia eagles', 'philly eagles', 'philadelphia'],
  '49ers': ['san francisco 49ers', 'sf 49ers', 'san francisco', 'niners'],
  'bills': ['buffalo bills', 'buffalo'],
  'ravens': ['baltimore ravens', 'baltimore'],
  'lions': ['detroit lions', 'detroit'],
  'cowboys': ['dallas cowboys', 'dallas'],
  'packers': ['green bay packers', 'green bay'],
  'lakers': ['los angeles lakers', 'la lakers'],
  'celtics': ['boston celtics', 'boston'],
  'warriors': ['golden state warriors', 'golden state', 'gsw'],
  'yankees': ['new york yankees', 'ny yankees'],
  'dodgers': ['los angeles dodgers', 'la dodgers'],
};

// Expected sentiment magnitude by injury severity (for overreaction detection)
const EXPECTED_SENTIMENT_BY_SEVERITY: Record<string, number> = {
  'season-ending': -0.6,
  'multi-week': -0.35,
  'week-to-week': -0.25,
  'day-to-day': -0.15,
  'minor': -0.1,
};

// Line movement history (in-memory for session)
interface LineSnapshot {
  gameId: string;
  homeProb: number;
  awayProb: number;
  timestamp: number;
}
const lineHistory: Map<string, LineSnapshot[]> = new Map();

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'sports',
  description: 'Comprehensive sports edge detection: odds divergence, injury overreaction, line moves',
  sources: ['kalshi', 'espn-sports', 'injuries'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Get source data
    const sportsData = data['espn-sports'] as SportsData | undefined;
    const injuryData = data['injuries'] as InjuryData | undefined;

    if (!sportsData?.games.length) {
      logger.debug('Sports detector: No ESPN data available');
      return edges;
    }

    // Find sports markets
    const sportsMarkets = markets.filter(m =>
      m.category === 'sports' || isSportsTitle(m.title)
    );

    logger.info(`Sports detector: Analyzing ${sportsMarkets.length} markets against ${sportsData.games.length} games`);

    // 1. Cross-platform odds edges
    for (const market of sportsMarkets) {
      const oddsEdge = detectOddsEdge(market, sportsData.games);
      if (oddsEdge) {
        edges.push(oddsEdge);
      }
    }

    // 2. Injury overreaction edges
    if (injuryData) {
      const injuryEdges = detectInjuryOverreactionEdges(sportsMarkets, sportsData.games, injuryData);
      edges.push(...injuryEdges);
    }

    // 3. Line movement edges
    const lineMoveEdges = detectLineMoveEdges(sportsMarkets, sportsData.games);
    edges.push(...lineMoveEdges);

    // Update line history for future detection
    updateLineHistory(sportsData.games);

    // Deduplicate by market (keep highest edge)
    const deduped = deduplicateEdges(edges);

    logger.info(`Sports detector: Found ${deduped.length} edges`);
    return deduped;
  },
});

// =============================================================================
// 1. CROSS-PLATFORM ODDS DETECTION
// =============================================================================

function detectOddsEdge(market: Market, games: SportsGame[]): Edge | null {
  // Try to match market to a game
  const match = findMatchingGame(market.title, games);
  if (!match) {
    return null;
  }

  const { game, team, isHomeTeam } = match;

  // Get implied probability from ESPN odds
  let espnProb: number;
  if (isHomeTeam && game.homeMoneyline) {
    espnProb = oddsToProb(game.homeMoneyline);
  } else if (!isHomeTeam && game.awayMoneyline) {
    espnProb = oddsToProb(game.awayMoneyline);
  } else if (game.homeSpread !== undefined) {
    // Use spread if moneyline not available
    const spread = isHomeTeam ? game.homeSpread : -game.homeSpread;
    espnProb = spreadToWinProb(spread);
  } else {
    return null;
  }

  // Calculate edge
  const marketPrice = market.price;
  const edge = Math.abs(espnProb - marketPrice);

  if (edge < MIN_EDGE) {
    return null;
  }

  // Determine direction
  const direction = espnProb > marketPrice ? 'YES' : 'NO';
  const confidence = calculateOddsConfidence(game, edge);

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build reason
  const reason = buildOddsReason(team, espnProb, marketPrice, direction, game);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'sports-odds',
      edgeType: 'cross-platform',
      espnGameId: game.id,
      team,
      espnProb,
      marketPrice,
      homeSpread: game.homeSpread,
      provider: game.provider,
    }
  );
}

// =============================================================================
// 2. INJURY OVERREACTION DETECTION
// =============================================================================

function detectInjuryOverreactionEdges(
  markets: Market[],
  games: SportsGame[],
  injuryData: InjuryData
): Edge[] {
  const edges: Edge[] = [];

  for (const game of games) {
    // Get injury comparison for this matchup
    const healthComparison = compareTeamHealth(injuryData, game.homeTeam, game.awayTeam);

    // Skip if teams are evenly healthy
    if (healthComparison.advantage === 'even' || healthComparison.diff < 10) {
      continue;
    }

    // Find key injuries that might cause overreaction
    const keyInjuries = findKeyInjuries(game, injuryData);
    if (keyInjuries.length === 0) {
      continue;
    }

    // Calculate expected market impact vs actual
    const expectedImpact = calculateExpectedInjuryImpact(keyInjuries);
    const observedImpact = estimateObservedImpact(game, healthComparison);

    // Check for overreaction
    const overreactionScore = Math.abs(observedImpact) - Math.abs(expectedImpact);

    if (overreactionScore < INJURY_OVERREACTION_THRESHOLD) {
      continue;
    }

    // Find matching market
    const matchingMarket = markets.find(m => {
      const title = m.title.toLowerCase();
      return matchesTeam(title, game.homeTeam) || matchesTeam(title, game.awayTeam);
    });

    if (!matchingMarket) continue;

    // Determine direction: fade the overreaction
    const injuredTeam = healthComparison.advantage === 'home' ? game.awayTeam : game.homeTeam;
    const direction = healthComparison.advantage === 'home' ? 'NO' : 'YES';  // Fade panic on injured team

    const confidence = calculateInjuryConfidence(overreactionScore, keyInjuries);

    edges.push(createEdge(
      matchingMarket,
      direction,
      overreactionScore,
      confidence,
      buildInjuryReason(injuredTeam, keyInjuries, overreactionScore),
      {
        type: 'sports-injury',
        edgeType: 'injury-overreaction',
        homeHealth: healthComparison.homeHealth,
        awayHealth: healthComparison.awayHealth,
        healthDiff: healthComparison.diff,
        injuredTeam,
        keyInjuries: keyInjuries.map(i => ({
          player: i.playerName,
          status: i.status,
          severity: i.severity,
        })),
        overreactionScore,
      }
    ));
  }

  return edges;
}

function findKeyInjuries(game: SportsGame, injuryData: InjuryData): InjuryReport[] {
  const sportInjuries = injuryData.bySport[game.sport] ?? [];

  return sportInjuries.filter(injury => {
    const teamMatch =
      injury.team.toLowerCase().includes(game.homeTeam.toLowerCase().split(' ').pop() ?? '') ||
      injury.team.toLowerCase().includes(game.awayTeam.toLowerCase().split(' ').pop() ?? '');

    const isSignificant = injury.impactRating >= 0.5 &&
      (injury.status === 'out' || injury.status === 'doubtful' || injury.status === 'ir');

    return teamMatch && isSignificant;
  });
}

function calculateExpectedInjuryImpact(injuries: InjuryReport[]): number {
  let totalImpact = 0;

  for (const injury of injuries) {
    const baseImpact = EXPECTED_SENTIMENT_BY_SEVERITY[injury.severity] ?? -0.2;
    const positionWeight = injury.impactRating;
    totalImpact += Math.abs(baseImpact) * positionWeight * 0.5;  // Conservative estimate
  }

  return Math.min(0.15, totalImpact);  // Cap at 15%
}

function estimateObservedImpact(
  game: SportsGame,
  healthComparison: { homeHealth: number; awayHealth: number; diff: number }
): number {
  // Use health score difference to estimate market overreaction
  // Larger health difference suggests bigger market move
  return healthComparison.diff * 0.003;  // 10 health pts ~= 3% impact
}

function calculateInjuryConfidence(overreactionScore: number, injuries: InjuryReport[]): number {
  let confidence = 0.50;

  // Higher confidence with more data
  if (injuries.length >= 2) confidence += 0.10;
  if (injuries.length >= 3) confidence += 0.05;

  // Higher confidence with larger overreaction
  if (overreactionScore >= 0.06) confidence += 0.10;
  if (overreactionScore >= 0.10) confidence += 0.05;

  // Check for star player injuries (high impact)
  const hasStarInjury = injuries.some(i => i.impactRating >= 0.8);
  if (hasStarInjury) confidence += 0.05;

  return Math.min(0.85, confidence);
}

function buildInjuryReason(
  injuredTeam: string,
  injuries: InjuryReport[],
  overreactionScore: number
): string {
  const topInjury = injuries[0];
  const pct = (overreactionScore * 100).toFixed(1);

  return `Injury overreaction: ${topInjury.playerName} (${topInjury.status}) for ${injuredTeam}. ` +
    `Market overreacted by ${pct}%. Fade the panic.`;
}

// =============================================================================
// 3. LINE MOVEMENT DETECTION
// =============================================================================

function detectLineMoveEdges(markets: Market[], games: SportsGame[]): Edge[] {
  const edges: Edge[] = [];

  for (const game of games) {
    const gameId = generateGameId(game);
    const history = lineHistory.get(gameId);

    if (!history || history.length < 2) {
      continue;  // Need history to detect moves
    }

    // Calculate line movement
    const current = history[history.length - 1];
    const oldest = history[0];
    const timeDiffMinutes = (current.timestamp - oldest.timestamp) / 60000;

    const homeMove = current.homeProb - oldest.homeProb;
    const moveMagnitude = Math.abs(homeMove);

    if (moveMagnitude < LINE_MOVE_THRESHOLD) {
      continue;  // Not significant enough
    }

    // Determine move type
    const moveType = classifyMove(moveMagnitude, timeDiffMinutes);

    // Find matching market
    const matchingMarket = markets.find(m => {
      const title = m.title.toLowerCase();
      return matchesTeam(title, game.homeTeam) || matchesTeam(title, game.awayTeam);
    });

    if (!matchingMarket) continue;

    // For steam moves, follow the money
    // For value moves, the line has moved in our favor
    const direction = homeMove > 0 ? 'YES' : 'NO';
    const confidence = calculateLineMoveConfidence(moveMagnitude, timeDiffMinutes, moveType);

    if (confidence < MIN_CONFIDENCE) continue;

    edges.push(createEdge(
      matchingMarket,
      direction,
      moveMagnitude,
      confidence,
      buildLineMoveReason(game, homeMove, timeDiffMinutes, moveType),
      {
        type: 'sports-line-move',
        edgeType: moveType,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        previousProb: oldest.homeProb,
        currentProb: current.homeProb,
        moveMagnitude,
        timeframeMinutes: timeDiffMinutes,
      }
    ));
  }

  return edges;
}

function classifyMove(magnitude: number, timeMinutes: number): string {
  if (magnitude >= 0.05 && timeMinutes <= 30) {
    return 'steam';  // Sharp money moving fast
  }
  if (magnitude >= 0.08) {
    return 'opening-value';  // Significant move from open
  }
  return 'drift';  // Gradual move
}

function calculateLineMoveConfidence(
  magnitude: number,
  timeMinutes: number,
  moveType: string
): number {
  let confidence = 0.50;

  // Steam moves are most reliable
  if (moveType === 'steam') {
    confidence += 0.15;
  } else if (moveType === 'opening-value') {
    confidence += 0.10;
  }

  // Larger moves = higher confidence
  if (magnitude >= 0.06) confidence += 0.10;
  if (magnitude >= 0.10) confidence += 0.05;

  return Math.min(0.85, confidence);
}

function buildLineMoveReason(
  game: SportsGame,
  homeMove: number,
  timeMinutes: number,
  moveType: string
): string {
  const direction = homeMove > 0 ? 'toward' : 'away from';
  const team = homeMove > 0 ? game.homeTeam : game.awayTeam;
  const pct = (Math.abs(homeMove) * 100).toFixed(1);

  const typeLabel = moveType === 'steam' ? 'STEAM MOVE' :
    moveType === 'opening-value' ? 'Opening line value' : 'Line drift';

  return `${typeLabel}: Line moved ${pct}% ${direction} ${team} in ${Math.round(timeMinutes)} min. Follow sharp money.`;
}

function updateLineHistory(games: SportsGame[]): void {
  const now = Date.now();

  for (const game of games) {
    const gameId = generateGameId(game);

    // Calculate current probabilities
    let homeProb = 0.5;
    let awayProb = 0.5;

    if (game.homeMoneyline && game.awayMoneyline) {
      homeProb = oddsToProb(game.homeMoneyline);
      awayProb = oddsToProb(game.awayMoneyline);
    } else if (game.homeSpread !== undefined) {
      homeProb = spreadToWinProb(game.homeSpread);
      awayProb = 1 - homeProb;
    }

    const snapshot: LineSnapshot = {
      gameId,
      homeProb,
      awayProb,
      timestamp: now,
    };

    const existing = lineHistory.get(gameId) ?? [];

    // Only add if different from last snapshot
    const last = existing[existing.length - 1];
    if (!last || Math.abs(last.homeProb - homeProb) > 0.001) {
      existing.push(snapshot);

      // Keep only last 50 snapshots
      if (existing.length > 50) {
        existing.shift();
      }

      lineHistory.set(gameId, existing);
    }
  }
}

function generateGameId(game: SportsGame): string {
  return `${game.sport}_${game.homeTeam}_${game.awayTeam}`.toLowerCase().replace(/\s+/g, '_');
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface GameMatch {
  game: SportsGame;
  team: string;
  isHomeTeam: boolean;
}

function findMatchingGame(title: string, games: SportsGame[]): GameMatch | null {
  const titleLower = title.toLowerCase();

  for (const game of games) {
    // Check home team
    if (matchesTeam(titleLower, game.homeTeam)) {
      return { game, team: game.homeTeam, isHomeTeam: true };
    }

    // Check away team
    if (matchesTeam(titleLower, game.awayTeam)) {
      return { game, team: game.awayTeam, isHomeTeam: false };
    }
  }

  return null;
}

function matchesTeam(title: string, teamName: string): boolean {
  const teamLower = teamName.toLowerCase();

  // Direct match
  if (title.includes(teamLower)) return true;

  // Check aliases
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => teamLower.includes(a) || a.includes(teamLower))) {
      if (title.includes(key)) return true;
    }
  }

  // Check for team city/name parts
  const parts = teamLower.split(' ');
  for (const part of parts) {
    if (part.length >= 4 && title.includes(part)) {
      return true;
    }
  }

  return false;
}

function isSportsTitle(title: string): boolean {
  const keywords = ['win', 'championship', 'super bowl', 'playoffs', 'finals', 'game', 'match', 'nfl', 'nba', 'mlb', 'nhl'];
  const lower = title.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function calculateOddsConfidence(game: SportsGame, edge: number): number {
  let confidence = 0.55;

  // Higher confidence if we have moneyline
  if (game.homeMoneyline && game.awayMoneyline) {
    confidence += 0.10;
  }

  // Higher confidence for larger edges
  if (edge >= 0.15) confidence += 0.10;
  else if (edge >= 0.10) confidence += 0.05;

  // Lower confidence for games far in future
  const gameDate = new Date(game.startTime);
  const daysAway = (gameDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysAway > 7) confidence -= 0.10;
  if (daysAway > 30) confidence -= 0.10;

  return Math.max(0.40, Math.min(0.90, confidence));
}

function buildOddsReason(
  team: string,
  espnProb: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  game: SportsGame
): string {
  const espnPct = (espnProb * 100).toFixed(0);
  const mktPct = (marketPrice * 100).toFixed(0);
  const spread = game.homeSpread !== undefined ? ` (spread: ${game.homeSpread > 0 ? '+' : ''}${game.homeSpread})` : '';

  if (direction === 'YES') {
    return `ESPN odds imply ${espnPct}% for ${team}${spread}, Kalshi at ${mktPct}%. Undervalued.`;
  } else {
    return `ESPN odds imply ${espnPct}% for ${team}${spread}, Kalshi at ${mktPct}%. Overvalued.`;
  }
}

function deduplicateEdges(edges: Edge[]): Edge[] {
  const byMarket = new Map<string, Edge>();

  for (const edge of edges) {
    const existing = byMarket.get(edge.market.id);
    if (!existing || edge.edge > existing.edge) {
      byMarket.set(edge.market.id, edge);
    }
  }

  return Array.from(byMarket.values());
}
