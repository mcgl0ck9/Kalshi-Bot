/**
 * ESPN Sports Data Source
 *
 * Fetches sports odds and games from ESPN's free public API.
 * No API key required.
 */

import { defineSource, type Category } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface SportsGame {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: 'pre' | 'in' | 'post' | 'unknown';
  homeSpread?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
  overUnder?: number;
  provider?: string;
}

export interface SportsData {
  games: SportsGame[];
  lastUpdated: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const ESPN_SPORTS = {
  nfl: { sport: 'football', league: 'nfl' },
  nba: { sport: 'basketball', league: 'nba' },
  mlb: { sport: 'baseball', league: 'mlb' },
  nhl: { sport: 'hockey', league: 'nhl' },
} as const;

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<SportsData>({
  name: 'espn-sports',
  category: 'sports' as Category,
  cacheTTL: 300,  // 5 minute cache

  async fetch(): Promise<SportsData> {
    const allGames: SportsGame[] = [];

    const sportKeys = Object.keys(ESPN_SPORTS) as (keyof typeof ESPN_SPORTS)[];

    await Promise.all(
      sportKeys.map(async (sportKey) => {
        const games = await fetchSportGames(sportKey);
        allGames.push(...games);
      })
    );

    logger.info(`Fetched ${allGames.length} games from ESPN`);

    return {
      games: allGames,
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchSportGames(sportKey: keyof typeof ESPN_SPORTS): Promise<SportsGame[]> {
  const { sport, league } = ESPN_SPORTS[sportKey];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`ESPN ${sportKey}: ${response.status}`);
      return [];
    }

    const data = await response.json() as ESPNResponse;
    return parseESPNEvents(data.events ?? [], sportKey);
  } catch (error) {
    logger.error(`ESPN fetch error (${sportKey}): ${error}`);
    return [];
  }
}

interface ESPNResponse {
  events?: ESPNEvent[];
}

interface ESPNEvent {
  id: string;
  date: string;
  status?: { type?: { state?: string } };
  competitions?: ESPNCompetition[];
}

interface ESPNCompetition {
  competitors?: ESPNCompetitor[];
  odds?: ESPNOdds[];
}

interface ESPNCompetitor {
  homeAway?: string;
  team?: { displayName?: string; abbreviation?: string };
}

interface ESPNOdds {
  provider?: { name?: string };
  spread?: number;
  overUnder?: number;
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
}

function parseESPNEvents(events: ESPNEvent[], sport: string): SportsGame[] {
  const games: SportsGame[] = [];

  for (const event of events) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const home = competition.competitors?.find(c => c.homeAway === 'home');
    const away = competition.competitors?.find(c => c.homeAway === 'away');
    if (!home?.team || !away?.team) continue;

    const status = mapStatus(event.status?.type?.state);
    if (status === 'post') continue;  // Skip finished games

    const odds = competition.odds?.[0];

    games.push({
      id: event.id,
      sport,
      homeTeam: home.team.displayName ?? home.team.abbreviation ?? 'Unknown',
      awayTeam: away.team.displayName ?? away.team.abbreviation ?? 'Unknown',
      startTime: event.date,
      status,
      homeSpread: odds?.spread,
      homeMoneyline: odds?.homeTeamOdds?.moneyLine,
      awayMoneyline: odds?.awayTeamOdds?.moneyLine,
      overUnder: odds?.overUnder,
      provider: odds?.provider?.name,
    });
  }

  return games;
}

function mapStatus(state?: string): SportsGame['status'] {
  switch (state) {
    case 'pre': return 'pre';
    case 'in': return 'in';
    case 'post': return 'post';
    default: return 'unknown';
  }
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Convert American odds to implied probability.
 */
export function oddsToProb(americanOdds: number): number {
  if (americanOdds === 0) return 0.5;
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  }
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

/**
 * Convert spread to implied win probability.
 * Each point ≈ 3% win probability.
 */
export function spreadToWinProb(spread: number): number {
  const prob = 0.5 - (spread * 0.03);
  return Math.max(0.05, Math.min(0.95, prob));
}
