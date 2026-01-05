/**
 * Sports Edge Detector
 *
 * Detects edges in sports markets by comparing Kalshi prices
 * against ESPN odds consensus.
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import { type SportsData, type SportsGame, oddsToProb, spreadToWinProb } from '../sources/espn-sports.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.06;  // Require 6% edge for sports
const MIN_CONFIDENCE = 0.60;

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

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'sports',
  description: 'Detects edges in sports markets using ESPN odds consensus',
  sources: ['kalshi', 'espn-sports'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const sportsData = data['espn-sports'] as SportsData | undefined;
    if (!sportsData || !sportsData.games.length) {
      logger.debug('Sports detector: No ESPN data available');
      return edges;
    }

    // Find sports markets
    const sportsMarkets = markets.filter(m =>
      m.category === 'sports' ||
      isSportsTitle(m.title)
    );

    logger.info(`Sports detector: Analyzing ${sportsMarkets.length} sports markets against ${sportsData.games.length} ESPN games`);

    for (const market of sportsMarkets) {
      const edge = analyzeSportsMarket(market, sportsData.games);
      if (edge) {
        edges.push(edge);
      }
    }

    return edges;
  },
});

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

function analyzeSportsMarket(market: Market, games: SportsGame[]): Edge | null {
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
  const confidence = calculateConfidence(game, edge);

  if (confidence < MIN_CONFIDENCE) {
    return null;
  }

  // Build reason
  const reason = buildReason(team, espnProb, marketPrice, direction, game);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'sports',
      espnGameId: game.id,
      team,
      espnProb,
      marketPrice,
      homeSpread: game.homeSpread,
      provider: game.provider,
    }
  );
}

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
  const keywords = ['win', 'championship', 'super bowl', 'playoffs', 'finals', 'game', 'match'];
  const lower = title.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function calculateConfidence(game: SportsGame, edge: number): number {
  let confidence = 0.60;

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

function buildReason(
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
    return `ESPN odds imply ${espnPct}% for ${team}${spread}, but Kalshi prices at ${mktPct}%. Undervalued.`;
  } else {
    return `ESPN odds imply only ${espnPct}% for ${team}${spread}, but Kalshi prices at ${mktPct}%. Overvalued.`;
  }
}
