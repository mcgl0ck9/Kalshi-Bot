/**
 * Sports Injuries Data Source (v4)
 *
 * Fetches injury reports from ESPN's free API.
 * Provides structured injury data for edge detection.
 *
 * Migrated from src/fetchers/injuries.ts
 */

import { defineSource, type Category } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type InjuryStatus =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'probable'
  | 'day-to-day'
  | 'ir'
  | 'pup'
  | 'suspended'
  | 'unknown';

export type InjurySeverity =
  | 'season-ending'
  | 'multi-week'
  | 'week-to-week'
  | 'day-to-day'
  | 'minor';

export interface InjuryReport {
  playerName: string;
  playerId?: string;
  team: string;
  teamAbbr: string;
  position: string;
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl';
  injuryType: string;
  injuryDetail?: string;
  status: InjuryStatus;
  severity: InjurySeverity;
  reportDate: string;
  impactRating: number;        // 0-1, how much this affects team
  source: string;
}

export interface TeamInjurySummary {
  team: string;
  teamAbbr: string;
  sport: string;
  healthScore: number;         // 0-100, higher = healthier
  totalOut: number;
  keyPlayersOut: number;
  injuries: InjuryReport[];
}

export interface InjuryData {
  injuries: InjuryReport[];
  bySport: Record<string, InjuryReport[]>;
  lastUpdated: string;
}

// =============================================================================
// ESPN API
// =============================================================================

const ESPN_API_URLS: Record<string, string> = {
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries',
};

interface ESPNInjuryResponse {
  injuries?: Array<{
    team: {
      id: string;
      name: string;
      abbreviation: string;
    };
    injuries: Array<{
      athlete: {
        id: string;
        displayName: string;
        position: { abbreviation: string };
      };
      status: string;
      type: { name: string; description: string };
      details?: { detail: string };
      date?: string;
    }>;
  }>;
}

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<InjuryData>({
  name: 'injuries',
  category: 'sports' as Category,
  cacheTTL: 900,  // 15 minute cache

  async fetch(): Promise<InjuryData> {
    const allInjuries: InjuryReport[] = [];
    const bySport: Record<string, InjuryReport[]> = {};

    const sports = Object.keys(ESPN_API_URLS) as Array<'nfl' | 'nba' | 'mlb' | 'nhl'>;

    await Promise.all(
      sports.map(async (sport) => {
        const injuries = await fetchSportInjuries(sport);
        allInjuries.push(...injuries);
        bySport[sport] = injuries;
      })
    );

    logger.info(`Fetched ${allInjuries.length} injuries across ${sports.length} sports`);

    return {
      injuries: allInjuries,
      bySport,
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchSportInjuries(sport: 'nfl' | 'nba' | 'mlb' | 'nhl'): Promise<InjuryReport[]> {
  try {
    const url = ESPN_API_URLS[sport];
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`ESPN injuries ${sport}: ${response.status}`);
      return [];
    }

    const data = await response.json() as ESPNInjuryResponse;
    if (!data.injuries) return [];

    const injuries: InjuryReport[] = [];

    for (const teamData of data.injuries) {
      for (const injury of teamData.injuries) {
        const status = mapESPNStatus(injury.status);
        const severity = estimateSeverity(injury.type?.name ?? '', injury.details?.detail);

        injuries.push({
          playerName: injury.athlete.displayName,
          playerId: injury.athlete.id,
          team: teamData.team.name,
          teamAbbr: teamData.team.abbreviation,
          position: injury.athlete.position?.abbreviation ?? 'Unknown',
          sport,
          injuryType: injury.type?.name ?? 'Unknown',
          injuryDetail: injury.details?.detail,
          status,
          severity,
          reportDate: injury.date ?? new Date().toISOString().split('T')[0],
          impactRating: calculateImpactRating(injury.athlete.position?.abbreviation, status, severity, sport),
          source: 'ESPN',
        });
      }
    }

    return injuries;
  } catch (error) {
    logger.debug(`ESPN injuries error (${sport}): ${error}`);
    return [];
  }
}

function mapESPNStatus(espnStatus: string): InjuryStatus {
  const status = espnStatus.toLowerCase();
  if (status.includes('out') || status.includes('inactive')) return 'out';
  if (status.includes('doubtful')) return 'doubtful';
  if (status.includes('questionable')) return 'questionable';
  if (status.includes('probable')) return 'probable';
  if (status.includes('day-to-day') || status.includes('dtd')) return 'day-to-day';
  if (status.includes('ir') || status.includes('injured reserve')) return 'ir';
  if (status.includes('pup')) return 'pup';
  if (status.includes('suspended')) return 'suspended';
  return 'unknown';
}

function estimateSeverity(injuryType: string, detail?: string): InjurySeverity {
  const text = `${injuryType} ${detail ?? ''}`.toLowerCase();

  if (text.includes('acl') || text.includes('achilles') || text.includes('surgery') || text.includes('torn')) {
    return 'season-ending';
  }
  if (text.includes('fracture') || text.includes('broken') || text.includes('mcl') || text.includes('grade 2')) {
    return 'multi-week';
  }
  if (text.includes('concussion') || text.includes('sprain') || text.includes('strain')) {
    return 'week-to-week';
  }
  if (text.includes('rest') || text.includes('soreness') || text.includes('illness')) {
    return 'day-to-day';
  }
  return 'minor';
}

function calculateImpactRating(
  position: string | undefined,
  status: InjuryStatus,
  severity: InjurySeverity,
  sport: string
): number {
  let base = 0.5;

  // Position importance
  base *= getPositionWeight(position, sport);

  // Status weight
  const statusWeight: Record<InjuryStatus, number> = {
    'out': 1.0, 'ir': 1.0, 'pup': 1.0,
    'doubtful': 0.85, 'questionable': 0.6,
    'day-to-day': 0.5, 'probable': 0.2,
    'suspended': 0.9, 'unknown': 0.5,
  };
  base *= statusWeight[status];

  // Severity weight
  const severityWeight: Record<InjurySeverity, number> = {
    'season-ending': 1.0, 'multi-week': 0.8,
    'week-to-week': 0.6, 'day-to-day': 0.4,
    'minor': 0.2,
  };
  base *= severityWeight[severity];

  return Math.min(1.0, base);
}

function getPositionWeight(position: string | undefined, sport: string): number {
  if (!position) return 1.0;
  const pos = position.toUpperCase();

  if (sport === 'nfl') {
    if (pos === 'QB') return 2.0;
    if (['RB', 'WR', 'TE', 'LT', 'RT'].includes(pos)) return 1.3;
    return 1.0;
  }
  if (sport === 'nba') {
    if (['PG', 'SG', 'SF'].includes(pos)) return 1.4;
    if (['PF', 'C'].includes(pos)) return 1.2;
    return 1.0;
  }
  if (sport === 'mlb') {
    if (['SP', 'P'].includes(pos)) return 1.5;
    if (['C', 'SS'].includes(pos)) return 1.3;
    return 1.0;
  }
  if (sport === 'nhl') {
    if (pos === 'G') return 1.8;
    if (['C', 'RW', 'LW'].includes(pos)) return 1.2;
    return 1.0;
  }
  return 1.0;
}

// =============================================================================
// EXPORTS FOR EDGE ANALYSIS
// =============================================================================

/**
 * Get injury summary for a team.
 */
export function getTeamInjurySummary(
  data: InjuryData,
  teamName: string
): TeamInjurySummary | null {
  const teamLower = teamName.toLowerCase();
  const injuries = data.injuries.filter(i =>
    i.team.toLowerCase().includes(teamLower) ||
    i.teamAbbr.toLowerCase() === teamLower
  );

  if (injuries.length === 0) return null;

  const totalOut = injuries.filter(i =>
    i.status === 'out' || i.status === 'ir'
  ).length;

  const keyPlayersOut = injuries.filter(i =>
    i.impactRating >= 0.7 && (i.status === 'out' || i.status === 'ir')
  ).length;

  const totalImpact = injuries.reduce((sum, i) => sum + i.impactRating, 0);
  const healthScore = Math.max(0, 100 - (totalImpact * 20));

  return {
    team: injuries[0].team,
    teamAbbr: injuries[0].teamAbbr,
    sport: injuries[0].sport,
    healthScore,
    totalOut,
    keyPlayersOut,
    injuries,
  };
}

/**
 * Compare health between two teams.
 */
export function compareTeamHealth(
  data: InjuryData,
  homeTeam: string,
  awayTeam: string
): { homeHealth: number; awayHealth: number; advantage: 'home' | 'away' | 'even'; diff: number } {
  const home = getTeamInjurySummary(data, homeTeam);
  const away = getTeamInjurySummary(data, awayTeam);

  const homeHealth = home?.healthScore ?? 100;
  const awayHealth = away?.healthScore ?? 100;
  const diff = Math.abs(homeHealth - awayHealth);

  return {
    homeHealth,
    awayHealth,
    advantage: diff < 5 ? 'even' : homeHealth > awayHealth ? 'home' : 'away',
    diff,
  };
}

/**
 * Calculate injury edge for a matchup.
 */
export function calculateInjuryEdge(
  data: InjuryData,
  favoredTeam: string,
  underdogTeam: string
): { edge: number; reason: string } | null {
  const comparison = compareTeamHealth(data, favoredTeam, underdogTeam);

  if (comparison.advantage === 'even') return null;

  // Health advantage translates to edge
  const edge = comparison.diff * 0.002;  // ~2% edge per 10 health diff

  if (edge < 0.02) return null;  // Not significant enough

  const healthier = comparison.advantage === 'home' ? favoredTeam : underdogTeam;
  const reason = `${healthier} has health advantage (${comparison.diff.toFixed(0)} pt diff)`;

  return { edge, reason };
}

/**
 * Format injury report for display.
 */
export function formatInjuryReport(injury: InjuryReport): string {
  const statusIcon: Record<InjuryStatus, string> = {
    'out': 'X', 'ir': 'X', 'pup': 'X',
    'doubtful': '?!', 'questionable': '?',
    'day-to-day': 'DTD', 'probable': '+',
    'suspended': 'SUS', 'unknown': '?',
  };
  return `${statusIcon[injury.status]} ${injury.playerName} (${injury.position}) - ${injury.injuryType}: ${injury.status.toUpperCase()}`;
}
