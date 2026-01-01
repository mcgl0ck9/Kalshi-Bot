/**
 * ESPN Odds Fetcher - No API Key Required
 *
 * Uses ESPN's public API endpoints to fetch betting odds without needing
 * any authentication. This is a sustainable alternative to paid APIs.
 *
 * Sources:
 * - ESPN Core API: sports.core.api.espn.com
 * - ESPN CDN scoreboard: cdn.espn.com
 * - Covers.com consensus (backup)
 */

import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ESPNOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeSpread: number;
  awaySpread: number;
  homeMoneyline: number;
  awayMoneyline: number;
  overUnder: number;
  provider: string;
  homeSpreadOdds?: number;
  awaySpreadOdds?: number;
  startTime: string;
}

export interface ESPNGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  odds?: ESPNOdds;
}

export interface ConsensusData {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  publicSpreadPct: number;  // % on home spread
  publicMLPct: number;      // % on home ML
  publicOverPct: number;    // % on over
}

// =============================================================================
// ESPN PUBLIC API - NO AUTH REQUIRED
// =============================================================================

const ESPN_SPORTS = {
  nfl: { sport: 'football', league: 'nfl' },
  nba: { sport: 'basketball', league: 'nba' },
  mlb: { sport: 'baseball', league: 'mlb' },
  nhl: { sport: 'hockey', league: 'nhl' },
  ncaaf: { sport: 'football', league: 'college-football' },
  ncaab: { sport: 'basketball', league: 'mens-college-basketball' },
};

/**
 * Fetch scoreboard with embedded odds from ESPN CDN
 */
async function fetchESPNScoreboard(sportKey: keyof typeof ESPN_SPORTS): Promise<ESPNGame[]> {
  const { sport, league } = ESPN_SPORTS[sportKey];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`ESPN scoreboard ${sportKey}: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      events?: Array<{
        id: string;
        date: string;
        status?: { type?: { state?: string } };
        competitions?: Array<{
          competitors?: Array<{
            homeAway?: string;
            team?: { displayName?: string; abbreviation?: string };
          }>;
          odds?: Array<{
            provider?: { name?: string };
            details?: string;
            overUnder?: number;
            spread?: number;
            homeTeamOdds?: { spreadOdds?: number; moneyLine?: number };
            awayTeamOdds?: { spreadOdds?: number; moneyLine?: number };
          }>;
        }>;
      }>;
    };

    const games: ESPNGame[] = [];

    for (const event of data.events ?? []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const homeTeam = competition.competitors?.find(c => c.homeAway === 'home');
      const awayTeam = competition.competitors?.find(c => c.homeAway === 'away');

      if (!homeTeam?.team || !awayTeam?.team) continue;

      const game: ESPNGame = {
        id: event.id,
        homeTeam: homeTeam.team.displayName ?? homeTeam.team.abbreviation ?? 'Unknown',
        awayTeam: awayTeam.team.displayName ?? awayTeam.team.abbreviation ?? 'Unknown',
        startTime: event.date,
        status: event.status?.type?.state ?? 'unknown',
      };

      // Extract odds if available
      const odds = competition.odds?.[0];
      if (odds) {
        game.odds = {
          gameId: event.id,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeSpread: odds.spread ?? 0,
          awaySpread: -(odds.spread ?? 0),
          homeMoneyline: odds.homeTeamOdds?.moneyLine ?? 0,
          awayMoneyline: odds.awayTeamOdds?.moneyLine ?? 0,
          overUnder: odds.overUnder ?? 0,
          provider: odds.provider?.name ?? 'ESPN',
          homeSpreadOdds: odds.homeTeamOdds?.spreadOdds,
          awaySpreadOdds: odds.awayTeamOdds?.spreadOdds,
          startTime: event.date,
        };
      }

      games.push(game);
    }

    return games;
  } catch (error) {
    logger.error(`ESPN scoreboard fetch error (${sportKey}): ${error}`);
    return [];
  }
}

/**
 * Fetch detailed odds for a specific event using ESPN Core API
 */
async function fetchESPNEventOdds(
  sportKey: keyof typeof ESPN_SPORTS,
  eventId: string
): Promise<ESPNOdds | null> {
  const { sport, league } = ESPN_SPORTS[sportKey];
  const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/odds`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      items?: Array<{
        provider?: { name?: string };
        spread?: number;
        overUnder?: number;
        homeTeamOdds?: { moneyLine?: number; spreadOdds?: number };
        awayTeamOdds?: { moneyLine?: number; spreadOdds?: number };
      }>;
    };

    const oddsItem = data.items?.[0];
    if (!oddsItem) return null;

    return {
      gameId: eventId,
      homeTeam: '',  // Filled in by caller
      awayTeam: '',
      homeSpread: oddsItem.spread ?? 0,
      awaySpread: -(oddsItem.spread ?? 0),
      homeMoneyline: oddsItem.homeTeamOdds?.moneyLine ?? 0,
      awayMoneyline: oddsItem.awayTeamOdds?.moneyLine ?? 0,
      overUnder: oddsItem.overUnder ?? 0,
      provider: oddsItem.provider?.name ?? 'ESPN',
      homeSpreadOdds: oddsItem.homeTeamOdds?.spreadOdds,
      awaySpreadOdds: oddsItem.awayTeamOdds?.spreadOdds,
      startTime: '',
    };
  } catch {
    return null;
  }
}

// =============================================================================
// CONSENSUS DATA (PUBLIC BETTING PERCENTAGES)
// =============================================================================

/**
 * Fetch public betting percentages from Action Network-style sources
 * This helps identify sharp vs square money divergence
 */
async function fetchPublicBettingPct(sport: string): Promise<Map<string, ConsensusData>> {
  const consensusMap = new Map<string, ConsensusData>();

  // Action Network public betting data (embedded in their pages)
  // This is a simplified version - in production you'd parse their page
  try {
    const sportPath = sport === 'ncaaf' ? 'ncaaf' : sport;
    const url = `https://www.actionnetwork.com/${sportPath}/public-betting`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) return consensusMap;

    // In production, parse the HTML for __NEXT_DATA__ JSON
    // For now, return empty map - ESPN odds are the primary source
    return consensusMap;
  } catch {
    return consensusMap;
  }
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Fetch all upcoming games with odds for a sport
 * Returns games with embedded odds from ESPN's free API
 */
export async function fetchSportsOddsESPN(
  sport: keyof typeof ESPN_SPORTS
): Promise<ESPNGame[]> {
  const games = await fetchESPNScoreboard(sport);

  // Filter to upcoming/in-progress games
  const relevantGames = games.filter(g =>
    g.status === 'pre' || g.status === 'in' || g.status === 'scheduled'
  );

  logger.info(`ESPN ${sport}: ${relevantGames.length} games with odds`);
  return relevantGames;
}

/**
 * Fetch odds for all major sports
 */
export async function fetchAllSportsOddsESPN(): Promise<Map<string, ESPNGame[]>> {
  const allOdds = new Map<string, ESPNGame[]>();

  const sports: (keyof typeof ESPN_SPORTS)[] = ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab'];

  await Promise.all(
    sports.map(async (sport) => {
      const games = await fetchSportsOddsESPN(sport);
      if (games.length > 0) {
        allOdds.set(sport, games);
      }
    })
  );

  return allOdds;
}

/**
 * Convert ESPN odds to implied probability
 * American odds to probability conversion
 */
export function oddsToProb(americanOdds: number): number {
  if (americanOdds === 0) return 0.5;
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

/**
 * Calculate implied win probability from spread
 * Uses historical spread-to-win conversion
 */
export function spreadToWinProb(spread: number): number {
  // NFL spread to win probability approximation
  // Based on historical data: each point of spread ≈ 3% win probability
  const baseProb = 0.5;
  const pointValue = 0.03;
  const prob = baseProb - (spread * pointValue);
  return Math.max(0.05, Math.min(0.95, prob));
}

/**
 * Find edge between Kalshi market and ESPN consensus odds
 */
export function findESPNEdge(
  kalshiPrice: number,
  espnOdds: ESPNOdds,
  isHomeTeam: boolean
): { edge: number; direction: 'BUY YES' | 'BUY NO'; impliedProb: number } {
  // Get implied probability from moneyline
  const ml = isHomeTeam ? espnOdds.homeMoneyline : espnOdds.awayMoneyline;
  const impliedProb = ml !== 0 ? oddsToProb(ml) : spreadToWinProb(
    isHomeTeam ? espnOdds.homeSpread : espnOdds.awaySpread
  );

  const edge = impliedProb - kalshiPrice;
  const direction = edge > 0 ? 'BUY YES' : 'BUY NO';

  return {
    edge: Math.abs(edge),
    direction,
    impliedProb,
  };
}

// =============================================================================
// SHARP VS SQUARE DETECTION
// =============================================================================

/**
 * Detect sharp vs square money divergence
 * When line moves opposite to public betting, sharps are on the other side
 */
export interface SharpSquareSignal {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  publicPct: number;        // % of bets on one side
  lineMoveDirection: 'toward' | 'against';  // Did line move toward or against public?
  sharpSide: 'home' | 'away';
  confidence: number;
}

export function detectSharpMoney(
  game: ESPNGame,
  consensus: ConsensusData | undefined,
  openingSpread?: number
): SharpSquareSignal | null {
  if (!game.odds || !consensus || openingSpread === undefined) return null;

  const currentSpread = game.odds.homeSpread;
  const lineMove = currentSpread - openingSpread;
  const publicOnHome = consensus.publicSpreadPct > 50;

  // If public is on home but line moved against them (home spread got worse)
  // That's sharp money on away
  const lineMoveAgainstPublic = (publicOnHome && lineMove > 0) ||
                                 (!publicOnHome && lineMove < 0);

  if (!lineMoveAgainstPublic) return null;

  const publicPct = publicOnHome ? consensus.publicSpreadPct : (100 - consensus.publicSpreadPct);

  // Confidence based on how lopsided public betting is + line move magnitude
  const lopsidedness = Math.abs(publicPct - 50) / 50;
  const moveMagnitude = Math.min(Math.abs(lineMove) / 3, 1);  // Cap at 3 points
  const confidence = (lopsidedness * 0.5 + moveMagnitude * 0.5);

  return {
    gameId: game.id,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    publicPct,
    lineMoveDirection: 'against',
    sharpSide: publicOnHome ? 'away' : 'home',
    confidence,
  };
}
