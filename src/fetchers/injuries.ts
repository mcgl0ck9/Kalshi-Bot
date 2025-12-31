/**
 * Sports Injury Feed Fetcher
 *
 * Aggregates injury reports from multiple authoritative sources:
 * - ESPN Injury Reports (official team injury designations)
 * - Rotowire (detailed analysis, fantasy-focused)
 * - CBS Sports Injuries
 * - Official team injury reports (where available)
 *
 * This complements the sentiment-based injury detection in injury-overreaction.ts
 * by providing structured, authoritative injury data.
 */

import { logger } from '../utils/index.js';
import { fetchWithFallback, createSource, type FetchResult } from '../utils/resilient-fetch.js';
import {
  NFL_TEAMS,
  NBA_TEAMS,
  MLB_TEAMS,
  NHL_TEAMS,
  getTeamByAlias,
} from '../data/teams.js';

// =============================================================================
// TYPES
// =============================================================================

export type InjuryStatus =
  | 'out'           // Confirmed out
  | 'doubtful'      // Very unlikely to play
  | 'questionable'  // Uncertain
  | 'probable'      // Likely to play (NFL only)
  | 'day-to-day'    // Short-term, updated daily
  | 'ir'            // Injured reserve
  | 'pup'           // Physically unable to perform
  | 'suspended'     // Not injury but affects availability
  | 'unknown';

export type InjurySeverity = 'season-ending' | 'multi-week' | 'week-to-week' | 'day-to-day' | 'minor';

export interface InjuryReport {
  playerName: string;
  playerId?: string;
  team: string;
  teamAbbr: string;
  position: string;
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl' | 'ncaaf' | 'ncaab';
  injuryType: string;          // e.g., "Knee", "Hamstring", "Concussion"
  injuryDetail?: string;       // e.g., "ACL tear", "Grade 2 strain"
  status: InjuryStatus;
  severity: InjurySeverity;
  reportDate: string;
  expectedReturn?: string;     // Estimated return date if known
  isStarter: boolean;
  isStarPlayer: boolean;       // Pro Bowl/All-Star caliber
  impactRating: number;        // 0-1, how much this affects team
  source: string;
  lastUpdated: string;
}

export interface TeamInjuryReport {
  team: string;
  teamAbbr: string;
  sport: string;
  injuries: InjuryReport[];
  healthScore: number;         // 0-100, team health rating
  keyPlayersOut: number;
  totalPlayersOut: number;
  lastUpdated: string;
}

export interface LeagueInjuryReport {
  sport: string;
  teams: TeamInjuryReport[];
  lastUpdated: string;
  source: string;
}

export interface InjuryUpdate {
  player: InjuryReport;
  changeType: 'new' | 'upgraded' | 'downgraded' | 'returned';
  previousStatus?: InjuryStatus;
  currentStatus: InjuryStatus;
  timestamp: string;
  significance: 'high' | 'medium' | 'low';
}

// =============================================================================
// ESPN INJURY SCRAPING
// =============================================================================

const ESPN_INJURY_URLS = {
  nfl: 'https://www.espn.com/nfl/injuries',
  nba: 'https://www.espn.com/nba/injuries',
  mlb: 'https://www.espn.com/mlb/injuries',
  nhl: 'https://www.espn.com/nhl/injuries',
  ncaaf: 'https://www.espn.com/college-football/injuries',
  ncaab: 'https://www.espn.com/mens-college-basketball/injuries',
};

// ESPN API endpoints (more reliable than scraping)
const ESPN_API_URLS = {
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

/**
 * Fetch injuries from ESPN API
 */
async function fetchESPNInjuries(sport: keyof typeof ESPN_API_URLS): Promise<InjuryReport[]> {
  try {
    const url = ESPN_API_URLS[sport];
    if (!url) {
      logger.debug(`No ESPN API URL for sport: ${sport}`);
      return [];
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`ESPN API failed for ${sport}: ${response.status}`);
      return [];
    }

    const data = await response.json() as ESPNInjuryResponse;
    const injuries: InjuryReport[] = [];

    if (!data.injuries) {
      return [];
    }

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
          isStarter: false,  // Would need roster data to determine
          isStarPlayer: false,  // Would need stats data to determine
          impactRating: calculateImpactRating(injury.athlete.position?.abbreviation, status, severity, sport),
          source: 'ESPN',
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    logger.debug(`ESPN: Found ${injuries.length} injuries for ${sport}`);
    return injuries;
  } catch (error) {
    logger.debug(`ESPN API error for ${sport}: ${error}`);
    return [];
  }
}

/**
 * Map ESPN status strings to our status type
 */
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

/**
 * Estimate injury severity from type and details
 */
function estimateSeverity(injuryType: string, detail?: string): InjurySeverity {
  const text = `${injuryType} ${detail ?? ''}`.toLowerCase();

  // Season-ending injuries
  if (text.includes('acl') || text.includes('achilles') || text.includes('surgery') ||
      text.includes('season-ending') || text.includes('torn')) {
    return 'season-ending';
  }

  // Multi-week injuries
  if (text.includes('fracture') || text.includes('broken') || text.includes('mcl') ||
      text.includes('high ankle') || text.includes('grade 2') || text.includes('grade 3')) {
    return 'multi-week';
  }

  // Week-to-week
  if (text.includes('concussion') || text.includes('sprain') || text.includes('strain') ||
      text.includes('contusion') || text.includes('grade 1')) {
    return 'week-to-week';
  }

  // Day-to-day
  if (text.includes('rest') || text.includes('management') || text.includes('soreness') ||
      text.includes('illness') || text.includes('personal')) {
    return 'day-to-day';
  }

  return 'minor';
}

/**
 * Calculate impact rating based on position, status, severity
 */
function calculateImpactRating(
  position: string | undefined,
  status: InjuryStatus,
  severity: InjurySeverity,
  sport: string
): number {
  let baseImpact = 0.5;

  // Position importance varies by sport
  const positionImpact = getPositionImportance(position, sport);
  baseImpact *= positionImpact;

  // Adjust by status
  const statusMultiplier: Record<InjuryStatus, number> = {
    'out': 1.0,
    'ir': 1.0,
    'pup': 1.0,
    'doubtful': 0.85,
    'questionable': 0.6,
    'day-to-day': 0.5,
    'probable': 0.2,
    'suspended': 0.9,
    'unknown': 0.5,
  };
  baseImpact *= statusMultiplier[status];

  // Adjust by severity
  const severityMultiplier: Record<InjurySeverity, number> = {
    'season-ending': 1.0,
    'multi-week': 0.8,
    'week-to-week': 0.6,
    'day-to-day': 0.4,
    'minor': 0.2,
  };
  baseImpact *= severityMultiplier[severity];

  return Math.min(1.0, baseImpact);
}

/**
 * Get position importance by sport
 */
function getPositionImportance(position: string | undefined, sport: string): number {
  if (!position) return 1.0;

  const pos = position.toUpperCase();

  if (sport === 'nfl') {
    if (pos === 'QB') return 2.0;  // QBs are most important
    if (['RB', 'WR', 'TE', 'LT', 'RT'].includes(pos)) return 1.3;
    if (['DE', 'DT', 'LB', 'CB', 'S'].includes(pos)) return 1.1;
    return 1.0;
  }

  if (sport === 'nba') {
    if (['PG', 'SG', 'SF'].includes(pos)) return 1.4;  // Perimeter players slightly more important
    if (['PF', 'C'].includes(pos)) return 1.2;
    return 1.0;
  }

  if (sport === 'mlb') {
    if (['SP', 'P'].includes(pos)) return 1.5;  // Starting pitchers crucial
    if (['C', 'SS'].includes(pos)) return 1.3;
    return 1.0;
  }

  if (sport === 'nhl') {
    if (pos === 'G') return 1.8;  // Goalies very important
    if (['C', 'RW', 'LW'].includes(pos)) return 1.2;
    if (pos === 'D') return 1.1;
    return 1.0;
  }

  return 1.0;
}

// =============================================================================
// ROTOWIRE INTEGRATION (via RSS/scraping)
// =============================================================================

const ROTOWIRE_RSS = {
  nfl: 'https://www.rotowire.com/rss/news.php?sport=NFL',
  nba: 'https://www.rotowire.com/rss/news.php?sport=NBA',
  mlb: 'https://www.rotowire.com/rss/news.php?sport=MLB',
  nhl: 'https://www.rotowire.com/rss/news.php?sport=NHL',
};

/**
 * Fetch injury news from Rotowire RSS
 * Note: Rotowire provides news updates, not structured injury reports
 */
async function fetchRotowireInjuryNews(sport: keyof typeof ROTOWIRE_RSS): Promise<InjuryUpdate[]> {
  try {
    const url = ROTOWIRE_RSS[sport];
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)',
      },
    });

    if (!response.ok) {
      logger.debug(`Rotowire RSS failed for ${sport}: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const updates: InjuryUpdate[] = [];

    // Parse RSS items for injury-related content
    const itemPattern = /<item>([\s\S]*?)<\/item>/g;
    const titlePattern = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
    const descPattern = /<description><!\[CDATA\[(.*?)\]\]><\/description>/;
    const datePattern = /<pubDate>(.*?)<\/pubDate>/;

    let match;
    while ((match = itemPattern.exec(xml)) !== null) {
      const item = match[1];

      const titleMatch = item.match(titlePattern);
      const descMatch = item.match(descPattern);
      const dateMatch = item.match(datePattern);

      if (!titleMatch) continue;

      const title = titleMatch[1];
      const desc = descMatch?.[1] ?? '';
      const date = dateMatch?.[1] ?? new Date().toISOString();

      // Check if this is injury-related
      const injuryKeywords = ['injury', 'injured', 'out', 'questionable', 'doubtful',
        'return', 'cleared', 'sidelined', 'miss', 'fracture', 'concussion', 'surgery'];

      const isInjuryRelated = injuryKeywords.some(kw =>
        title.toLowerCase().includes(kw) || desc.toLowerCase().includes(kw)
      );

      if (!isInjuryRelated) continue;

      // Extract player name (usually at start of title)
      const playerMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
      const playerName = playerMatch?.[1] ?? 'Unknown';

      // Determine change type
      let changeType: InjuryUpdate['changeType'] = 'new';
      if (title.toLowerCase().includes('return') || title.toLowerCase().includes('cleared')) {
        changeType = 'returned';
      } else if (title.toLowerCase().includes('upgraded')) {
        changeType = 'upgraded';
      } else if (title.toLowerCase().includes('downgraded')) {
        changeType = 'downgraded';
      }

      // Determine current status
      let currentStatus: InjuryStatus = 'unknown';
      if (title.toLowerCase().includes('out')) currentStatus = 'out';
      else if (title.toLowerCase().includes('questionable')) currentStatus = 'questionable';
      else if (title.toLowerCase().includes('doubtful')) currentStatus = 'doubtful';
      else if (title.toLowerCase().includes('probable') || title.toLowerCase().includes('cleared')) currentStatus = 'probable';

      updates.push({
        player: {
          playerName,
          team: 'Unknown',  // Would need to parse from desc
          teamAbbr: '',
          position: 'Unknown',
          sport,
          injuryType: 'Unknown',
          status: currentStatus,
          severity: 'unknown' as InjurySeverity,
          reportDate: new Date(date).toISOString().split('T')[0],
          isStarter: false,
          isStarPlayer: false,
          impactRating: 0.5,
          source: 'Rotowire',
          lastUpdated: new Date().toISOString(),
        },
        changeType,
        currentStatus,
        timestamp: new Date(date).toISOString(),
        significance: currentStatus === 'out' ? 'high' :
                      currentStatus === 'questionable' ? 'medium' : 'low',
      });
    }

    logger.debug(`Rotowire: Found ${updates.length} injury updates for ${sport}`);
    return updates;
  } catch (error) {
    logger.debug(`Rotowire RSS error for ${sport}: ${error}`);
    return [];
  }
}

// =============================================================================
// AGGREGATED FETCH
// =============================================================================

/**
 * Fetch all injuries for a sport from multiple sources
 */
export async function fetchSportInjuries(
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl'
): Promise<FetchResult<InjuryReport[]> | null> {
  const sources = [
    createSource(`ESPN-${sport}`, async () => {
      const injuries = await fetchESPNInjuries(sport);
      return injuries.length > 0 ? injuries : null;
    }, 1),
  ];

  return fetchWithFallback<InjuryReport[]>(
    `injuries:${sport}`,
    sources,
    {
      cacheTTL: 15 * 60 * 1000,  // 15 minutes
      useStaleOnError: true,
      staleTTL: 2 * 60 * 60 * 1000,  // 2 hours
    }
  );
}

/**
 * Fetch injuries for all major sports
 */
export async function fetchAllSportsInjuries(): Promise<Map<string, InjuryReport[]>> {
  const sports: Array<'nfl' | 'nba' | 'mlb' | 'nhl'> = ['nfl', 'nba', 'mlb', 'nhl'];
  const results = new Map<string, InjuryReport[]>();

  await Promise.all(
    sports.map(async (sport) => {
      const result = await fetchSportInjuries(sport);
      if (result?.data) {
        results.set(sport, result.data);
      }
    })
  );

  return results;
}

/**
 * Fetch injury updates (news) for real-time monitoring
 */
export async function fetchInjuryUpdates(
  sport: 'nfl' | 'nba' | 'mlb' | 'nhl'
): Promise<InjuryUpdate[]> {
  return fetchRotowireInjuryNews(sport);
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Get team injury summary
 */
export function getTeamInjurySummary(
  teamName: string,
  injuries: InjuryReport[]
): TeamInjuryReport | null {
  const teamInfo = getTeamByAlias(teamName);
  if (!teamInfo) return null;

  const teamInjuries = injuries.filter(i =>
    i.team.toLowerCase().includes(teamName.toLowerCase()) ||
    i.teamAbbr.toLowerCase() === teamName.toLowerCase()
  );

  if (teamInjuries.length === 0) return null;

  const keyPlayersOut = teamInjuries.filter(i =>
    i.isStarPlayer && (i.status === 'out' || i.status === 'ir' || i.status === 'doubtful')
  ).length;

  const totalPlayersOut = teamInjuries.filter(i =>
    i.status === 'out' || i.status === 'ir'
  ).length;

  // Calculate health score (100 = fully healthy)
  const totalImpact = teamInjuries.reduce((sum, i) => sum + i.impactRating, 0);
  const healthScore = Math.max(0, 100 - (totalImpact * 20));

  return {
    team: teamInfo.info.canonical,
    teamAbbr: teamInfo.info.abbreviations[0] ?? '',
    sport: teamInjuries[0]?.sport ?? 'unknown',
    injuries: teamInjuries,
    healthScore,
    keyPlayersOut,
    totalPlayersOut,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Compare team health for a matchup
 */
export function compareTeamHealth(
  homeTeam: string,
  awayTeam: string,
  injuries: InjuryReport[]
): {
  homeHealth: number;
  awayHealth: number;
  healthAdvantage: 'home' | 'away' | 'even';
  healthDiff: number;
  keyInjuries: InjuryReport[];
} {
  const homeSummary = getTeamInjurySummary(homeTeam, injuries);
  const awaySummary = getTeamInjurySummary(awayTeam, injuries);

  const homeHealth = homeSummary?.healthScore ?? 100;
  const awayHealth = awaySummary?.healthScore ?? 100;
  const healthDiff = homeHealth - awayHealth;

  // Key injuries are those with high impact rating
  const keyInjuries = injuries.filter(i =>
    i.impactRating >= 0.6 &&
    (i.team.toLowerCase().includes(homeTeam.toLowerCase()) ||
     i.team.toLowerCase().includes(awayTeam.toLowerCase()))
  );

  return {
    homeHealth,
    awayHealth,
    healthAdvantage: healthDiff > 5 ? 'home' : healthDiff < -5 ? 'away' : 'even',
    healthDiff: Math.abs(healthDiff),
    keyInjuries,
  };
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format injury report for display
 */
export function formatInjuryReport(injury: InjuryReport): string {
  const statusIcon: Record<InjuryStatus, string> = {
    'out': '🔴',
    'ir': '🔴',
    'pup': '🔴',
    'doubtful': '🟠',
    'questionable': '🟡',
    'day-to-day': '🟡',
    'probable': '🟢',
    'suspended': '⚫',
    'unknown': '⚪',
  };

  const icon = statusIcon[injury.status] ?? '⚪';
  return `${icon} **${injury.playerName}** (${injury.position}) - ${injury.injuryType}: ${injury.status.toUpperCase()}`;
}

/**
 * Format team injury summary
 */
export function formatTeamInjurySummary(summary: TeamInjuryReport): string {
  const lines: string[] = [
    `**${summary.team}** Injury Report`,
    `🏥 Health Score: ${summary.healthScore.toFixed(0)}/100`,
    `❌ Players Out: ${summary.totalPlayersOut}`,
  ];

  if (summary.keyPlayersOut > 0) {
    lines.push(`⭐ Key Players Out: ${summary.keyPlayersOut}`);
  }

  lines.push('');
  lines.push('**Injuries:**');

  for (const injury of summary.injuries.slice(0, 5)) {
    lines.push(formatInjuryReport(injury));
  }

  if (summary.injuries.length > 5) {
    lines.push(`_...and ${summary.injuries.length - 5} more_`);
  }

  return lines.join('\n');
}
