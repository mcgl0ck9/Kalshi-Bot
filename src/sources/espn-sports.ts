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
  ncaam: { sport: 'basketball', league: 'mens-college-basketball' },
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

  // NCAAM needs date params + group=50 (D1) + higher limit for full coverage
  let url: string;
  if (sportKey === 'ncaam') {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${today}&groups=50&limit=200`;
  } else {
    url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  }

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
 * Convert spread to implied win probability using normal CDF.
 *
 * The expected scoring margin = -spread (negative spread = favored).
 * Standard deviations by sport (empirical):
 *   NFL: σ = 13.5
 *   NBA: σ = 12.0
 *   NCAAM (college basketball): σ = 11.0
 *   NHL: σ = 1.6 (goals)
 *
 * P(home wins) = Φ(-spread / σ) where Φ is the standard normal CDF.
 */
export function spreadToWinProb(spread: number, sport?: string): number {
  // Sport-specific scoring margin standard deviations
  const stdDevBySport: Record<string, number> = {
    nfl: 13.5,
    nba: 12.0,
    ncaam: 11.0,
    nhl: 1.6,
    mlb: 1.4,
  };

  const stdDev = stdDevBySport[sport ?? 'nfl'] ?? 13.0;

  // P(home wins) = P(margin > 0) = Φ(-spread / σ)
  const z = -spread / stdDev;
  const prob = normalCDF(z);
  return Math.max(0.05, Math.min(0.95, prob));
}

/**
 * Approximate the standard normal CDF using Abramowitz & Stegun formula.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}
