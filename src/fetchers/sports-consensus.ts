/**
 * Sports Betting Consensus & Sharp Action Detection
 *
 * Enhances sports-odds.ts with:
 * - Sharp vs Square sportsbook classification
 * - Reverse line movement detection (RLM)
 * - Steam move identification
 * - Consensus line with sharp weighting
 *
 * EDGE THESIS:
 * Sharp sportsbooks (Pinnacle, Circa, Bookmaker) set efficient lines.
 * Square sportsbooks (DraftKings, FanDuel, etc.) shade to public.
 * When sharps and squares diverge, bet with the sharps.
 *
 * ADVERSARIAL TEST:
 * - Who's on other side? Recreational bettors, public money
 * - Why do they lose? Bet favorites, overs, popular teams
 * - Our edge: Follow sharp money, fade public
 */

import { logger } from '../utils/index.js';
import type { SportOdds, BookmakerOdds } from './sports-odds.js';

// =============================================================================
// TYPES
// =============================================================================

export type BookmakerTier = 'sharp' | 'market-maker' | 'square';

export interface BookmakerProfile {
  name: string;
  tier: BookmakerTier;
  weight: number;         // Weight in consensus calculation
  holdPercentage: number; // Typical vig (lower = sharper)
  moveFirst: boolean;     // Does this book lead line moves?
}

export interface ConsensusLine {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;

  // Sharp consensus (Pinnacle-weighted)
  sharpSpread: number;
  sharpMoneyline: { home: number; away: number };
  sharpTotal: number;

  // Square consensus (recreational books)
  squareSpread: number;
  squareMoneyline: { home: number; away: number };
  squareTotal: number;

  // Overall consensus (weighted)
  consensusSpread: number;
  consensusMoneyline: { home: number; away: number };
  consensusTotal: number;

  // Divergence signals
  spreadDivergence: number;     // Sharp - Square spread
  totalDivergence: number;      // Sharp - Square total
  sharpSide?: 'home' | 'away';  // Which side sharps favor
  steamDetected: boolean;
  rlmDetected: boolean;         // Reverse line movement

  // Betting percentages (if available)
  publicBetPct?: { home: number; away: number };
  publicMoneyPct?: { home: number; away: number };

  confidence: number;
}

export interface SteamMove {
  gameId: string;
  teams: string;
  market: 'spread' | 'total' | 'moneyline';
  direction: 'home' | 'away' | 'over' | 'under';
  magnitude: number;
  triggeredBy: string;        // Which book moved first
  booksFollowed: string[];
  timestamp: string;
  significance: 'major' | 'moderate' | 'minor';
}

export interface ReverseLineMovement {
  gameId: string;
  teams: string;
  market: 'spread' | 'total';
  publicSide: 'home' | 'away' | 'over' | 'under';
  publicPct: number;
  lineMovement: number;
  movedAgainstPublic: boolean;
  sharpIndicator: boolean;
}

// =============================================================================
// SPORTSBOOK CLASSIFICATION
// =============================================================================

/**
 * Sportsbook profiles with tier classification
 * Sharp books: Set market, lowest vig, professionals allowed
 * Market-makers: Large volume, efficient but shade to public
 * Square: Recreational focused, higher vig, limit sharps
 */
const SPORTSBOOK_PROFILES: Record<string, BookmakerProfile> = {
  // Sharp books (follow these)
  'pinnacle': { name: 'Pinnacle', tier: 'sharp', weight: 2.0, holdPercentage: 2.0, moveFirst: true },
  'bookmaker': { name: 'Bookmaker', tier: 'sharp', weight: 1.8, holdPercentage: 2.5, moveFirst: true },
  'betonlineag': { name: 'BetOnline', tier: 'sharp', weight: 1.5, holdPercentage: 3.0, moveFirst: false },
  'bovada': { name: 'Bovada', tier: 'sharp', weight: 1.4, holdPercentage: 3.5, moveFirst: false },

  // Market makers (moderate weight)
  'betmgm': { name: 'BetMGM', tier: 'market-maker', weight: 1.2, holdPercentage: 4.5, moveFirst: false },
  'williamhill_us': { name: 'Caesars', tier: 'market-maker', weight: 1.2, holdPercentage: 4.5, moveFirst: false },
  'betrivers': { name: 'BetRivers', tier: 'market-maker', weight: 1.0, holdPercentage: 5.0, moveFirst: false },

  // Square books (fade or use for best price)
  'draftkings': { name: 'DraftKings', tier: 'square', weight: 0.8, holdPercentage: 5.0, moveFirst: false },
  'fanduel': { name: 'FanDuel', tier: 'square', weight: 0.8, holdPercentage: 5.0, moveFirst: false },
  'pointsbetus': { name: 'PointsBet', tier: 'square', weight: 0.7, holdPercentage: 5.5, moveFirst: false },
  'barstool': { name: 'Barstool', tier: 'square', weight: 0.6, holdPercentage: 6.0, moveFirst: false },
  'superbook': { name: 'SuperBook', tier: 'market-maker', weight: 1.3, holdPercentage: 3.5, moveFirst: true },
  'circasports': { name: 'Circa', tier: 'sharp', weight: 1.9, holdPercentage: 2.0, moveFirst: true },

  // Default for unknown books
  'default': { name: 'Unknown', tier: 'square', weight: 0.5, holdPercentage: 6.0, moveFirst: false },
};

/**
 * Get sportsbook profile
 */
export function getBookmakerProfile(bookmakerKey: string): BookmakerProfile {
  return SPORTSBOOK_PROFILES[bookmakerKey.toLowerCase()] ?? SPORTSBOOK_PROFILES['default'];
}

/**
 * Classify bookmaker tier
 */
export function classifyBookmaker(bookmakerKey: string): BookmakerTier {
  return getBookmakerProfile(bookmakerKey).tier;
}

// =============================================================================
// CONSENSUS CALCULATION
// =============================================================================

/**
 * Calculate weighted consensus from odds data
 */
export function calculateConsensus(odds: SportOdds): ConsensusLine {
  const sharpBooks = odds.bookmakers.filter(b =>
    getBookmakerProfile(b.bookmaker).tier === 'sharp'
  );

  const squareBooks = odds.bookmakers.filter(b =>
    getBookmakerProfile(b.bookmaker).tier === 'square'
  );

  const marketMakers = odds.bookmakers.filter(b =>
    getBookmakerProfile(b.bookmaker).tier === 'market-maker'
  );

  // Calculate sharp consensus
  const sharpSpread = calculateWeightedSpread(sharpBooks.length > 0 ? sharpBooks : marketMakers);
  const sharpTotal = calculateWeightedTotal(sharpBooks.length > 0 ? sharpBooks : marketMakers);
  const sharpML = calculateWeightedMoneyline(sharpBooks.length > 0 ? sharpBooks : marketMakers, odds.homeTeam);

  // Calculate square consensus
  const squareSpread = calculateWeightedSpread(squareBooks.length > 0 ? squareBooks : odds.bookmakers);
  const squareTotal = calculateWeightedTotal(squareBooks.length > 0 ? squareBooks : odds.bookmakers);
  const squareML = calculateWeightedMoneyline(squareBooks.length > 0 ? squareBooks : odds.bookmakers, odds.homeTeam);

  // Calculate overall weighted consensus
  const allBooks = odds.bookmakers;
  const consensusSpread = calculateWeightedSpread(allBooks);
  const consensusTotal = calculateWeightedTotal(allBooks);
  const consensusML = calculateWeightedMoneyline(allBooks, odds.homeTeam);

  // Calculate divergences
  const spreadDivergence = sharpSpread - squareSpread;
  const totalDivergence = sharpTotal - squareTotal;

  // Determine which side sharps favor
  let sharpSide: 'home' | 'away' | undefined;
  if (Math.abs(spreadDivergence) >= 0.5) {
    // Sharps have lower spread on home = they like home
    sharpSide = spreadDivergence < 0 ? 'home' : 'away';
  }

  // Detect steam moves (sharp books moved first and others followed)
  const steamDetected = detectSteamMove(odds);

  // RLM detection would need historical data - placeholder
  const rlmDetected = false;

  // Confidence based on book agreement
  const confidence = calculateConsensusConfidence(odds.bookmakers);

  return {
    gameId: odds.gameId,
    homeTeam: odds.homeTeam,
    awayTeam: odds.awayTeam,
    commenceTime: odds.commenceTime,
    sharpSpread,
    sharpMoneyline: sharpML,
    sharpTotal,
    squareSpread,
    squareMoneyline: squareML,
    squareTotal,
    consensusSpread,
    consensusMoneyline: consensusML,
    consensusTotal,
    spreadDivergence,
    totalDivergence,
    sharpSide,
    steamDetected,
    rlmDetected,
    confidence,
  };
}

/**
 * Calculate weighted spread from bookmakers
 */
function calculateWeightedSpread(bookmakers: BookmakerOdds[]): number {
  const spreadsWithWeights = bookmakers
    .filter(b => b.markets.spreads)
    .map(b => ({
      spread: b.markets.spreads!.homeSpread,
      weight: getBookmakerProfile(b.bookmaker).weight,
    }));

  if (spreadsWithWeights.length === 0) return 0;

  const totalWeight = spreadsWithWeights.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = spreadsWithWeights.reduce((sum, s) => sum + s.spread * s.weight, 0);

  return weightedSum / totalWeight;
}

/**
 * Calculate weighted total from bookmakers
 */
function calculateWeightedTotal(bookmakers: BookmakerOdds[]): number {
  const totalsWithWeights = bookmakers
    .filter(b => b.markets.totals)
    .map(b => ({
      total: b.markets.totals!.point,
      weight: getBookmakerProfile(b.bookmaker).weight,
    }));

  if (totalsWithWeights.length === 0) return 0;

  const totalWeight = totalsWithWeights.reduce((sum, t) => sum + t.weight, 0);
  const weightedSum = totalsWithWeights.reduce((sum, t) => sum + t.total * t.weight, 0);

  return weightedSum / totalWeight;
}

/**
 * Calculate weighted moneyline from bookmakers
 */
function calculateWeightedMoneyline(
  bookmakers: BookmakerOdds[],
  homeTeam: string
): { home: number; away: number } {
  const mlWithWeights = bookmakers
    .filter(b => b.markets.h2h)
    .map(b => ({
      home: b.markets.h2h!.home,
      away: b.markets.h2h!.away,
      weight: getBookmakerProfile(b.bookmaker).weight,
    }));

  if (mlWithWeights.length === 0) return { home: 0, away: 0 };

  const totalWeight = mlWithWeights.reduce((sum, m) => sum + m.weight, 0);

  return {
    home: mlWithWeights.reduce((sum, m) => sum + m.home * m.weight, 0) / totalWeight,
    away: mlWithWeights.reduce((sum, m) => sum + m.away * m.weight, 0) / totalWeight,
  };
}

/**
 * Calculate consensus confidence based on book agreement
 */
function calculateConsensusConfidence(bookmakers: BookmakerOdds[]): number {
  const spreads = bookmakers
    .filter(b => b.markets.spreads)
    .map(b => b.markets.spreads!.homeSpread);

  if (spreads.length < 2) return 0.5;

  // Calculate standard deviation
  const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const variance = spreads.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / spreads.length;
  const stdDev = Math.sqrt(variance);

  // Lower stdDev = higher confidence (more agreement)
  // stdDev of 0.5 is typical, 1.0+ is high disagreement
  const confidence = Math.max(0.3, Math.min(0.95, 1 - (stdDev / 2)));

  return confidence;
}

/**
 * Detect potential steam move based on book timing and movement
 */
function detectSteamMove(odds: SportOdds): boolean {
  const sharpBooks = odds.bookmakers.filter(b =>
    getBookmakerProfile(b.bookmaker).moveFirst
  );

  const squareBooks = odds.bookmakers.filter(b =>
    !getBookmakerProfile(b.bookmaker).moveFirst
  );

  if (sharpBooks.length === 0 || squareBooks.length === 0) return false;

  // Check if sharp books have different line than squares
  const sharpSpreads = sharpBooks
    .filter(b => b.markets.spreads)
    .map(b => b.markets.spreads!.homeSpread);

  const squareSpreads = squareBooks
    .filter(b => b.markets.spreads)
    .map(b => b.markets.spreads!.homeSpread);

  if (sharpSpreads.length === 0 || squareSpreads.length === 0) return false;

  const sharpAvg = sharpSpreads.reduce((a, b) => a + b, 0) / sharpSpreads.length;
  const squareAvg = squareSpreads.reduce((a, b) => a + b, 0) / squareSpreads.length;

  // Steam detected if sharps have moved more than 1 point from squares
  return Math.abs(sharpAvg - squareAvg) >= 1.0;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

export interface SharpEdge {
  gameId: string;
  teams: string;
  market: 'spread' | 'moneyline' | 'total';
  sharpSide: string;
  edge: number;
  sharpPrice: number;
  squarePrice: number;
  bestPrice?: { book: string; price: number };
  confidence: number;
  reason: string;
}

/**
 * Find edges where sharp and square books diverge
 */
export function findSharpSquareDivergence(consensus: ConsensusLine): SharpEdge[] {
  const edges: SharpEdge[] = [];

  // Spread divergence
  if (Math.abs(consensus.spreadDivergence) >= 0.5) {
    const sharpSide = consensus.spreadDivergence < 0 ? 'home' : 'away';
    const sharpTeam = sharpSide === 'home' ? consensus.homeTeam : consensus.awayTeam;

    edges.push({
      gameId: consensus.gameId,
      teams: `${consensus.awayTeam} @ ${consensus.homeTeam}`,
      market: 'spread',
      sharpSide: sharpTeam,
      edge: Math.abs(consensus.spreadDivergence),
      sharpPrice: consensus.sharpSpread,
      squarePrice: consensus.squareSpread,
      confidence: consensus.confidence,
      reason: `Sharps favor ${sharpTeam} by ${Math.abs(consensus.spreadDivergence).toFixed(1)} points vs squares`,
    });
  }

  // Total divergence
  if (Math.abs(consensus.totalDivergence) >= 1.0) {
    const sharpSide = consensus.totalDivergence > 0 ? 'over' : 'under';

    edges.push({
      gameId: consensus.gameId,
      teams: `${consensus.awayTeam} @ ${consensus.homeTeam}`,
      market: 'total',
      sharpSide,
      edge: Math.abs(consensus.totalDivergence),
      sharpPrice: consensus.sharpTotal,
      squarePrice: consensus.squareTotal,
      confidence: consensus.confidence,
      reason: `Sharps favor ${sharpSide} (${consensus.sharpTotal.toFixed(1)} vs ${consensus.squareTotal.toFixed(1)})`,
    });
  }

  return edges;
}

/**
 * Compare sportsbook consensus to Kalshi market price
 */
export function compareToKalshiPrice(
  consensus: ConsensusLine,
  kalshiPrice: number,
  kalshiSide: 'home' | 'away'
): {
  edge: number;
  direction: 'buy' | 'sell';
  sharpAligned: boolean;
  confidence: number;
  reason: string;
} {
  // Convert sharp consensus to implied probability
  const sharpHomeProb = spreadToWinProbability(consensus.sharpSpread);
  const sharpAwayProb = 1 - sharpHomeProb;

  const sharpImplied = kalshiSide === 'home' ? sharpHomeProb : sharpAwayProb;
  const edge = sharpImplied - kalshiPrice;

  const sharpAligned = consensus.sharpSide === kalshiSide;

  return {
    edge: Math.abs(edge),
    direction: edge > 0 ? 'buy' : 'sell',
    sharpAligned,
    confidence: consensus.confidence * (sharpAligned ? 1.1 : 0.9),
    reason: edge > 0
      ? `Sharp consensus ${(sharpImplied * 100).toFixed(0)}% vs Kalshi ${(kalshiPrice * 100).toFixed(0)}%`
      : `Kalshi overpriced: ${(kalshiPrice * 100).toFixed(0)}% vs sharp ${(sharpImplied * 100).toFixed(0)}%`,
  };
}

/**
 * Convert point spread to win probability
 * Uses standard conversion: each point ≈ 3% win probability
 */
function spreadToWinProbability(homeSpread: number): number {
  // Negative spread = favorite (higher win prob)
  // Each point of spread ≈ 3% probability shift from 50%
  const probShift = -homeSpread * 0.03;
  const winProb = 0.5 + probShift;

  return Math.max(0.05, Math.min(0.95, winProb));
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format consensus line for display
 */
export function formatConsensusLine(consensus: ConsensusLine): string {
  const lines: string[] = [
    `**${consensus.awayTeam} @ ${consensus.homeTeam}**`,
    '',
    `**Spread Consensus:**`,
    `  🎯 Sharp: ${consensus.homeTeam} ${formatSpread(consensus.sharpSpread)}`,
    `  📊 Square: ${consensus.homeTeam} ${formatSpread(consensus.squareSpread)}`,
    `  📐 Overall: ${consensus.homeTeam} ${formatSpread(consensus.consensusSpread)}`,
  ];

  if (Math.abs(consensus.spreadDivergence) >= 0.5) {
    const favored = consensus.spreadDivergence < 0 ? consensus.homeTeam : consensus.awayTeam;
    lines.push(`  ⚡ Sharps favor: **${favored}** (+${Math.abs(consensus.spreadDivergence).toFixed(1)})`);
  }

  lines.push('');
  lines.push(`**Total Consensus:**`);
  lines.push(`  🎯 Sharp: ${consensus.sharpTotal.toFixed(1)}`);
  lines.push(`  📊 Square: ${consensus.squareTotal.toFixed(1)}`);

  if (Math.abs(consensus.totalDivergence) >= 1.0) {
    const side = consensus.totalDivergence > 0 ? 'OVER' : 'UNDER';
    lines.push(`  ⚡ Sharps favor: **${side}**`);
  }

  if (consensus.steamDetected) {
    lines.push('');
    lines.push('🔥 **STEAM MOVE DETECTED**');
  }

  lines.push('');
  lines.push(`_Confidence: ${(consensus.confidence * 100).toFixed(0)}%_`);

  return lines.join('\n');
}

function formatSpread(spread: number): string {
  if (spread === 0) return 'PK';
  return spread > 0 ? `+${spread.toFixed(1)}` : spread.toFixed(1);
}

/**
 * Format sharp edge for alert
 */
export function formatSharpEdge(edge: SharpEdge): string {
  return [
    `🎯 **Sharp vs Square Edge**`,
    '',
    `**${edge.teams}**`,
    `Market: ${edge.market.toUpperCase()}`,
    `Sharp Side: **${edge.sharpSide}**`,
    `Edge: ${edge.edge.toFixed(1)} points`,
    '',
    edge.reason,
    '',
    `_Confidence: ${(edge.confidence * 100).toFixed(0)}%_`,
  ].join('\n');
}
