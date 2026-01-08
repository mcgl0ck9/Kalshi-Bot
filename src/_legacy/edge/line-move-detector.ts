/**
 * @deprecated This module has been merged into src/detectors/sports.ts
 * The unified sports detector now handles line movement detection.
 * This file is kept for reference but should not be used directly.
 *
 * Line Movement Detector
 *
 * Tracks odds changes between scans to detect:
 * - Steam moves (sharp money moving lines quickly)
 * - Reverse line movement (line moving opposite public betting)
 * - Opening line value (significant deviation from opener)
 *
 * Uses persistent storage to track line history across scans.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Market } from '../types/index.js';
import type { SportOdds } from '../fetchers/sports-odds.js'; // NOT legacy - still used
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LineSnapshot {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  awayOdds: number;
  homeProb: number;
  awayProb: number;
  timestamp: number;
  source: string;
}

export interface LineHistory {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  snapshots: LineSnapshot[];
  openingLine?: LineSnapshot;
  currentLine?: LineSnapshot;
}

export interface LineMove {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  moveType: 'steam' | 'reverse' | 'drift' | 'opening_value';
  direction: 'home' | 'away';
  magnitude: number;         // Probability change (e.g., 0.05 = 5%)
  timeframeMinutes: number;
  previousProb: number;
  currentProb: number;
  openingProb?: number;
  confidence: number;
  reasoning: string;
}

export interface LineMoveEdge {
  kalshiMarket: Market;
  lineMove: LineMove;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
}

// =============================================================================
// STORAGE
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const LINE_HISTORY_FILE = join(DATA_DIR, 'line-history.json');

// In-memory cache
let lineHistoryCache: Map<string, LineHistory> = new Map();
let lastSaveTime = 0;
const SAVE_INTERVAL_MS = 60000; // Save at most every minute

/**
 * Load line history from disk
 */
function loadLineHistory(): Map<string, LineHistory> {
  try {
    if (existsSync(LINE_HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(LINE_HISTORY_FILE, 'utf-8'));
      const map = new Map<string, LineHistory>();

      // Only keep history from last 7 days
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

      for (const [gameId, history] of Object.entries(data)) {
        const h = history as LineHistory;
        // Filter out old snapshots
        h.snapshots = h.snapshots.filter(s => s.timestamp > cutoff);
        if (h.snapshots.length > 0) {
          map.set(gameId, h);
        }
      }

      return map;
    }
  } catch (error) {
    logger.warn(`Failed to load line history: ${error}`);
  }
  return new Map();
}

/**
 * Save line history to disk
 */
function saveLineHistory(): void {
  const now = Date.now();
  if (now - lastSaveTime < SAVE_INTERVAL_MS) {
    return; // Rate limit saves
  }

  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    const data: Record<string, LineHistory> = {};
    for (const [gameId, history] of lineHistoryCache) {
      data[gameId] = history;
    }

    writeFileSync(LINE_HISTORY_FILE, JSON.stringify(data, null, 2));
    lastSaveTime = now;
  } catch (error) {
    logger.warn(`Failed to save line history: ${error}`);
  }
}

/**
 * Initialize line history cache
 */
export function initLineHistory(): void {
  if (lineHistoryCache.size === 0) {
    lineHistoryCache = loadLineHistory();
    logger.info(`Loaded line history: ${lineHistoryCache.size} games tracked`);
  }
}

// =============================================================================
// LINE TRACKING
// =============================================================================

/**
 * Convert American odds to probability
 */
function americanToProb(odds: number): number {
  if (odds >= 100) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Record a new line snapshot for a game
 */
export function recordLineSnapshot(game: SportOdds): void {
  initLineHistory();

  const gameId = `${game.sport}_${game.homeTeam}_${game.awayTeam}`.toLowerCase().replace(/\s+/g, '_');

  // Get or create history
  let history = lineHistoryCache.get(gameId);
  if (!history) {
    history = {
      gameId,
      sport: game.sport,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      snapshots: [],
    };
    lineHistoryCache.set(gameId, history);
  }

  // Get home/away odds from first bookmaker's h2h market
  const h2h = game.bookmakers?.[0]?.markets?.h2h;
  const homeOdds = h2h?.home ?? 0;
  const awayOdds = h2h?.away ?? 0;

  // Create snapshot from consensus (use consensus probs directly if available)
  const snapshot: LineSnapshot = {
    gameId,
    sport: game.sport,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeOdds,
    awayOdds,
    homeProb: game.consensusHomeWinProb ?? (homeOdds !== 0 ? americanToProb(homeOdds) : 0.5),
    awayProb: game.consensusAwayWinProb ?? (awayOdds !== 0 ? americanToProb(awayOdds) : 0.5),
    timestamp: Date.now(),
    source: game.bookmakers?.[0]?.bookmaker ?? 'consensus',
  };

  // Add to history
  history.snapshots.push(snapshot);

  // Update opening/current
  if (!history.openingLine) {
    history.openingLine = snapshot;
  }
  history.currentLine = snapshot;

  // Keep only last 100 snapshots per game
  if (history.snapshots.length > 100) {
    history.snapshots = history.snapshots.slice(-100);
  }

  saveLineHistory();
}

/**
 * Record all games from a sports odds fetch
 */
export function recordAllLines(sportsOdds: Map<string, SportOdds[]>): void {
  for (const [sport, games] of sportsOdds) {
    for (const game of games) {
      recordLineSnapshot(game);
    }
  }
}

// =============================================================================
// LINE MOVE DETECTION
// =============================================================================

/**
 * Detect line movements for a game
 */
export function detectLineMoves(gameId: string): LineMove[] {
  initLineHistory();

  const history = lineHistoryCache.get(gameId);
  if (!history || history.snapshots.length < 2) {
    return [];
  }

  const moves: LineMove[] = [];
  const current = history.currentLine!;
  const snapshots = history.snapshots;

  // Check for moves in different timeframes
  const timeframes = [
    { minutes: 15, threshold: 0.02 },  // 2% move in 15 min = steam
    { minutes: 60, threshold: 0.03 },  // 3% move in 1 hour
    { minutes: 240, threshold: 0.05 }, // 5% move in 4 hours
  ];

  for (const { minutes, threshold } of timeframes) {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const oldSnapshot = snapshots.find(s => s.timestamp <= cutoff);

    if (oldSnapshot) {
      const homeChange = current.homeProb - oldSnapshot.homeProb;
      const magnitude = Math.abs(homeChange);

      if (magnitude >= threshold) {
        const direction = homeChange > 0 ? 'home' : 'away';

        // Determine move type
        let moveType: LineMove['moveType'] = 'drift';
        if (minutes <= 30 && magnitude >= 0.03) {
          moveType = 'steam';
        }

        moves.push({
          gameId: history.gameId,
          sport: history.sport,
          homeTeam: history.homeTeam,
          awayTeam: history.awayTeam,
          moveType,
          direction,
          magnitude,
          timeframeMinutes: minutes,
          previousProb: direction === 'home' ? oldSnapshot.homeProb : oldSnapshot.awayProb,
          currentProb: direction === 'home' ? current.homeProb : current.awayProb,
          openingProb: history.openingLine ? (direction === 'home' ? history.openingLine.homeProb : history.openingLine.awayProb) : undefined,
          confidence: Math.min(0.9, 0.5 + magnitude * 2),
          reasoning: `${history.awayTeam} @ ${history.homeTeam}: Line moved ${(magnitude * 100).toFixed(1)}% toward ${direction} in ${minutes} min`,
        });
      }
    }
  }

  // Check for opening line value
  if (history.openingLine) {
    const openingChange = Math.abs(current.homeProb - history.openingLine.homeProb);
    if (openingChange >= 0.05) {
      const direction = current.homeProb > history.openingLine.homeProb ? 'home' : 'away';

      moves.push({
        gameId: history.gameId,
        sport: history.sport,
        homeTeam: history.homeTeam,
        awayTeam: history.awayTeam,
        moveType: 'opening_value',
        direction,
        magnitude: openingChange,
        timeframeMinutes: (current.timestamp - history.openingLine.timestamp) / 60000,
        previousProb: direction === 'home' ? history.openingLine.homeProb : history.openingLine.awayProb,
        currentProb: direction === 'home' ? current.homeProb : current.awayProb,
        openingProb: direction === 'home' ? history.openingLine.homeProb : history.openingLine.awayProb,
        confidence: Math.min(0.85, 0.5 + openingChange * 1.5),
        reasoning: `${history.awayTeam} @ ${history.homeTeam}: Opened at ${(history.openingLine.homeProb * 100).toFixed(0)}%, now ${(current.homeProb * 100).toFixed(0)}%`,
      });
    }
  }

  return moves;
}

/**
 * Detect line moves across all tracked games
 */
export function detectAllLineMoves(): LineMove[] {
  initLineHistory();

  const allMoves: LineMove[] = [];

  for (const gameId of lineHistoryCache.keys()) {
    const moves = detectLineMoves(gameId);
    allMoves.push(...moves);
  }

  // Sort by magnitude (biggest moves first)
  allMoves.sort((a, b) => b.magnitude - a.magnitude);

  return allMoves;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Match line moves to Kalshi markets and find edges
 */
export function findLineMoveEdges(
  kalshiMarkets: Market[],
  minEdge: number = 0.03
): LineMoveEdge[] {
  const lineMoves = detectAllLineMoves();
  const edges: LineMoveEdge[] = [];

  // Filter to actionable moves (steam or large opening value)
  const actionableMoves = lineMoves.filter(
    m => m.moveType === 'steam' || (m.moveType === 'opening_value' && m.magnitude >= 0.06)
  );

  for (const move of actionableMoves) {
    // Find matching Kalshi market
    const sportsMarkets = kalshiMarkets.filter(m =>
      m.category === 'sports' || m.title?.toLowerCase().includes(move.sport)
    );

    for (const market of sportsMarkets) {
      const title = market.title?.toLowerCase() ?? '';

      // Check if this market is about the same game
      const homeMatch = title.includes(move.homeTeam.toLowerCase()) ||
                       title.includes(move.homeTeam.split(' ').pop()?.toLowerCase() ?? '');
      const awayMatch = title.includes(move.awayTeam.toLowerCase()) ||
                       title.includes(move.awayTeam.split(' ').pop()?.toLowerCase() ?? '');

      if (homeMatch && awayMatch) {
        // Calculate edge: if line moved toward team X, and Kalshi hasn't adjusted, there's an edge
        const kalshiPrice = market.price;

        // Determine if Kalshi market is for home or away team
        const isHomeMarket = title.includes(move.homeTeam.toLowerCase()) ||
                            title.includes(move.homeTeam.split(' ').pop()?.toLowerCase() ?? 'zzz');

        let edge: number;
        let direction: 'buy_yes' | 'buy_no';

        if (isHomeMarket) {
          // Market is for home team
          if (move.direction === 'home') {
            // Line moved toward home, if Kalshi is lower, buy yes
            edge = move.currentProb - kalshiPrice;
            direction = edge > 0 ? 'buy_yes' : 'buy_no';
          } else {
            // Line moved toward away, if Kalshi is higher, buy no
            edge = kalshiPrice - move.currentProb;
            direction = edge > 0 ? 'buy_no' : 'buy_yes';
          }
        } else {
          // Market is for away team
          if (move.direction === 'away') {
            edge = move.currentProb - kalshiPrice;
            direction = edge > 0 ? 'buy_yes' : 'buy_no';
          } else {
            edge = kalshiPrice - move.currentProb;
            direction = edge > 0 ? 'buy_no' : 'buy_yes';
          }
        }

        edge = Math.abs(edge);

        if (edge >= minEdge) {
          edges.push({
            kalshiMarket: market,
            lineMove: move,
            edge,
            direction,
            confidence: move.confidence,
            reasoning: `${move.moveType.toUpperCase()}: ${move.reasoning}. Kalshi at ${(kalshiPrice * 100).toFixed(0)}¢, sportsbooks at ${(move.currentProb * 100).toFixed(0)}¢`,
          });
        }
      }
    }
  }

  // Sort by edge magnitude
  edges.sort((a, b) => b.edge - a.edge);

  return edges;
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Get statistics about tracked lines
 */
export function getLineTrackingStats(): {
  gamesTracked: number;
  totalSnapshots: number;
  recentMoves: number;
} {
  initLineHistory();

  let totalSnapshots = 0;
  for (const history of lineHistoryCache.values()) {
    totalSnapshots += history.snapshots.length;
  }

  const recentMoves = detectAllLineMoves().filter(
    m => m.timeframeMinutes <= 60
  ).length;

  return {
    gamesTracked: lineHistoryCache.size,
    totalSnapshots,
    recentMoves,
  };
}

/**
 * Format line move for Discord
 */
export function formatLineMove(move: LineMove): string {
  const emoji = move.moveType === 'steam' ? '🔥' : move.moveType === 'opening_value' ? '📊' : '📈';
  const dirEmoji = move.direction === 'home' ? '🏠' : '✈️';

  return [
    `${emoji} **${move.moveType.toUpperCase()} MOVE** ${dirEmoji}`,
    `${move.awayTeam} @ ${move.homeTeam}`,
    `Line: ${(move.previousProb * 100).toFixed(0)}% → ${(move.currentProb * 100).toFixed(0)}% (${move.timeframeMinutes} min)`,
    move.openingProb ? `Opener: ${(move.openingProb * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('\n');
}
