/**
 * Sports Odds Fetcher
 *
 * Integrates with The Odds API to fetch:
 * - Current odds from multiple sportsbooks
 * - Line movement tracking
 * - Consensus lines for detecting sharp action
 *
 * ADVERSARIAL ANALYSIS:
 * - We do NOT chase steam moves (too slow, need ms execution)
 * - We do NOT arbitrage across books (fees eat profits, arb bots faster)
 * - We DO track injury-related line moves for overreaction detection
 * - We DO compare Kalshi sports markets to sportsbook consensus
 *
 * Edge source: Public overreacts to injury news, moving lines too far.
 * We detect when lines move excessively vs historical injury impact.
 */

import { logger } from '../utils/index.js';
import { ODDS_API_KEY } from '../config.js';
import type { Market } from '../types/index.js';
import {
  NFL_TEAMS,
  NBA_TEAMS,
  MLB_TEAMS,
  NHL_TEAMS,
  type LeagueTeams,
} from '../data/teams.js';

// Track if we've already warned about invalid API key (to avoid spam)
let oddsApiKeyWarned = false;

// =============================================================================
// TYPES
// =============================================================================

export interface SportOdds {
  sport: string;
  sportKey: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookmakerOdds[];
  consensusHomeWinProb: number;
  consensusAwayWinProb: number;
  consensusSpread: number;
  lineMovement?: LineMovement;
}

export interface BookmakerOdds {
  bookmaker: string;
  lastUpdate: string;
  markets: {
    h2h?: { home: number; away: number; draw?: number };
    spreads?: { home: number; away: number; homeSpread: number; awaySpread: number };
    totals?: { over: number; under: number; point: number };
  };
}

export interface LineMovement {
  openingSpread: number;
  currentSpread: number;
  spreadChange: number;
  openingTotal: number;
  currentTotal: number;
  totalChange: number;
  direction: 'home' | 'away' | 'unchanged';
  magnitude: 'significant' | 'moderate' | 'minimal';
  possibleReason?: 'injury' | 'weather' | 'sharp_action' | 'public' | 'unknown';
}

export interface InjuryLineImpact {
  player: string;
  team: string;
  sport: string;
  expectedImpact: number;  // Expected spread impact in points
  actualImpact: number;    // Actual line movement
  overreaction: number;    // actualImpact - expectedImpact
  edge?: number;           // If overreaction is large enough
  direction?: 'fade' | 'follow';
}

// =============================================================================
// SPORTS MAPPING
// =============================================================================

const SPORT_KEYS: Record<string, string> = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  soccer_epl: 'soccer_epl',
  soccer_mls: 'soccer_usa_mls',
  mma: 'mma_mixed_martial_arts',
  golf: 'golf_pga_championship',
  tennis: 'tennis_atp_us_open',
};

// Expected line movement per star player injury (historical averages)
// Used to detect overreaction
const INJURY_IMPACT_ESTIMATES: Record<string, Record<string, number>> = {
  nfl: {
    qb_starter: 3.5,        // Spread moves ~3.5 points for starting QB
    rb_starter: 1.0,
    wr_starter: 0.5,
    default: 0.25,
  },
  nba: {
    star_player: 4.0,       // Top 20 player
    starter: 1.5,
    rotation: 0.5,
    default: 0.25,
  },
  mlb: {
    ace_pitcher: 1.5,       // Starting pitcher
    cleanup_hitter: 0.5,
    default: 0.15,
  },
  nhl: {
    goalie_starter: 1.0,
    star_forward: 0.5,
    default: 0.15,
  },
};

// =============================================================================
// API FETCHING
// =============================================================================

/**
 * Fetch odds for a specific sport
 */
export async function fetchSportOdds(sport: keyof typeof SPORT_KEYS): Promise<SportOdds[]> {
  if (!ODDS_API_KEY) {
    logger.debug('ODDS_API_KEY not configured, skipping sports odds fetch');
    return [];
  }

  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) {
    logger.warn(`Unknown sport: ${sport}`);
    return [];
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?` +
      `apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 401) {
        // Only log once per session to avoid spam
        if (!oddsApiKeyWarned) {
          oddsApiKeyWarned = true;
          logger.warn('ODDS_API_KEY is invalid or expired. Get a new key at: https://the-odds-api.com/');
        }
      } else if (response.status === 429) {
        logger.warn('The Odds API rate limit exceeded (500 requests/month for free tier)');
      } else if (response.status === 404) {
        // Sport might not have any games scheduled - not an error
        logger.debug(`No games found for ${sport}`);
      } else {
        logger.warn(`The Odds API error for ${sport}: ${response.status}`);
      }
      return [];
    }

    const data = await response.json() as Array<{
      id: string;
      sport_key: string;
      home_team: string;
      away_team: string;
      commence_time: string;
      bookmakers: Array<{
        key: string;
        last_update: string;
        markets: Array<{
          key: string;
          outcomes: Array<{ name: string; price: number; point?: number }>;
        }>;
      }>;
    }>;

    // Log remaining API calls
    const remaining = response.headers.get('x-requests-remaining');
    if (remaining) {
      logger.debug(`Odds API requests remaining: ${remaining}`);
    }

    return data.map(game => parseGameOdds(game, sport));
  } catch (error) {
    logger.error(`Sports odds fetch error: ${error}`);
    return [];
  }
}

/**
 * Parse game odds from API response
 */
function parseGameOdds(
  game: {
    id: string;
    sport_key: string;
    home_team: string;
    away_team: string;
    commence_time: string;
    bookmakers: Array<{
      key: string;
      last_update: string;
      markets: Array<{
        key: string;
        outcomes: Array<{ name: string; price: number; point?: number }>;
      }>;
    }>;
  },
  sport: string
): SportOdds {
  const bookmakers: BookmakerOdds[] = game.bookmakers.map(book => {
    const markets: BookmakerOdds['markets'] = {};

    for (const market of book.markets) {
      if (market.key === 'h2h') {
        const home = market.outcomes.find(o => o.name === game.home_team);
        const away = market.outcomes.find(o => o.name === game.away_team);
        const draw = market.outcomes.find(o => o.name === 'Draw');
        if (home && away) {
          markets.h2h = {
            home: home.price,
            away: away.price,
            draw: draw?.price,
          };
        }
      } else if (market.key === 'spreads') {
        const home = market.outcomes.find(o => o.name === game.home_team);
        const away = market.outcomes.find(o => o.name === game.away_team);
        if (home && away) {
          markets.spreads = {
            home: home.price,
            away: away.price,
            homeSpread: home.point ?? 0,
            awaySpread: away.point ?? 0,
          };
        }
      } else if (market.key === 'totals') {
        const over = market.outcomes.find(o => o.name === 'Over');
        const under = market.outcomes.find(o => o.name === 'Under');
        if (over && under) {
          markets.totals = {
            over: over.price,
            under: under.price,
            point: over.point ?? 0,
          };
        }
      }
    }

    return {
      bookmaker: book.key,
      lastUpdate: book.last_update,
      markets,
    };
  });

  // Calculate consensus probabilities from h2h odds
  const h2hOdds = bookmakers
    .filter(b => b.markets.h2h)
    .map(b => b.markets.h2h!);

  let consensusHomeWinProb = 0.5;
  let consensusAwayWinProb = 0.5;

  if (h2hOdds.length > 0) {
    const avgHomeOdds = h2hOdds.reduce((sum, o) => sum + o.home, 0) / h2hOdds.length;
    const avgAwayOdds = h2hOdds.reduce((sum, o) => sum + o.away, 0) / h2hOdds.length;

    consensusHomeWinProb = americanOddsToProb(avgHomeOdds);
    consensusAwayWinProb = americanOddsToProb(avgAwayOdds);

    // Normalize to remove vig
    const totalProb = consensusHomeWinProb + consensusAwayWinProb;
    consensusHomeWinProb /= totalProb;
    consensusAwayWinProb /= totalProb;
  }

  // Calculate consensus spread
  const spreads = bookmakers
    .filter(b => b.markets.spreads)
    .map(b => b.markets.spreads!.homeSpread);

  const consensusSpread = spreads.length > 0
    ? spreads.reduce((a, b) => a + b, 0) / spreads.length
    : 0;

  return {
    sport,
    sportKey: game.sport_key,
    gameId: game.id,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    commenceTime: game.commence_time,
    bookmakers,
    consensusHomeWinProb,
    consensusAwayWinProb,
    consensusSpread,
  };
}

// =============================================================================
// LINE MOVEMENT ANALYSIS
// =============================================================================

/**
 * Detect if line movement suggests overreaction to injury
 *
 * ADVERSARIAL LOGIC:
 * - Sharp bettors know the true impact of injuries
 * - Public overreacts, moving lines beyond fair value
 * - Edge exists when movement exceeds expected impact
 * - We FADE the overreaction (bet opposite direction)
 */
export function analyzeInjuryOverreaction(
  currentSpread: number,
  openingSpread: number,
  sport: keyof typeof INJURY_IMPACT_ESTIMATES,
  playerType: string = 'default'
): InjuryLineImpact | null {
  const spreadChange = Math.abs(currentSpread - openingSpread);
  const impactEstimates = INJURY_IMPACT_ESTIMATES[sport];

  if (!impactEstimates) return null;

  const expectedImpact = impactEstimates[playerType] ?? impactEstimates.default ?? 0.25;
  const overreaction = spreadChange - expectedImpact;

  // Only flag if overreaction is significant (> 1 point)
  if (overreaction < 1.0) return null;

  // Determine if we should fade (bet against the move)
  // Large overreaction = good fade opportunity
  const direction: 'fade' | 'follow' = overreaction > 0 ? 'fade' : 'follow';

  // Calculate edge based on overreaction magnitude
  // 1 point overreaction ≈ 3% edge (rough estimate)
  const edge = Math.min(overreaction * 0.03, 0.15); // Cap at 15%

  return {
    player: 'Unknown', // Would need injury news to populate
    team: 'Unknown',
    sport,
    expectedImpact,
    actualImpact: spreadChange,
    overreaction,
    edge,
    direction,
  };
}

/**
 * Compare Kalshi sports market to sportsbook consensus
 *
 * ADVERSARIAL LOGIC:
 * - Kalshi prices should converge with sportsbook consensus
 * - If Kalshi diverges significantly, it may be mispriced
 * - BUT: We need to account for Kalshi's different market structure
 * - Edge exists when divergence is large (>5%) and unexplained
 */
export function compareKalshiToConsensus(
  kalshiPrice: number,
  consensusProb: number,
  minEdge: number = 0.05
): {
  edge: number;
  direction: 'buy_yes' | 'buy_no' | 'no_edge';
  confidence: number;
  reasoning: string;
} {
  const edge = consensusProb - kalshiPrice;
  const absEdge = Math.abs(edge);

  if (absEdge < minEdge) {
    return {
      edge: 0,
      direction: 'no_edge',
      confidence: 0,
      reasoning: `Kalshi (${(kalshiPrice * 100).toFixed(0)}%) aligned with consensus (${(consensusProb * 100).toFixed(0)}%)`,
    };
  }

  const direction = edge > 0 ? 'buy_yes' : 'buy_no';

  // Confidence based on edge magnitude and number of books in consensus
  const confidence = Math.min(0.6 + (absEdge * 2), 0.85);

  const reasoning = `Sportsbook consensus: ${(consensusProb * 100).toFixed(0)}% vs ` +
    `Kalshi: ${(kalshiPrice * 100).toFixed(0)}%. Edge: ${(edge * 100).toFixed(1)}%`;

  return {
    edge,
    direction,
    confidence,
    reasoning,
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert American odds to implied probability
 */
function americanOddsToProb(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Fetch all configured sports odds
 */
export async function fetchAllSportsOdds(): Promise<Map<string, SportOdds[]>> {
  const results = new Map<string, SportOdds[]>();

  const sports: (keyof typeof SPORT_KEYS)[] = ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab'];

  // Fetch in parallel but with some rate limiting
  const batchSize = 3;
  for (let i = 0; i < sports.length; i += batchSize) {
    const batch = sports.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(sport => fetchSportOdds(sport).then(odds => ({ sport, odds })))
    );

    for (const { sport, odds } of batchResults) {
      if (odds.length > 0) {
        results.set(sport, odds);
      }
    }

    // Small delay between batches to respect rate limits
    if (i + batchSize < sports.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Format sports odds report
 */
export function formatSportsOddsReport(odds: Map<string, SportOdds[]>): string {
  const lines: string[] = [
    '**🏈 Sports Odds Summary**',
    '═══════════════════════════════',
    '',
  ];

  for (const [sport, games] of odds) {
    if (games.length === 0) continue;

    lines.push(`**${sport.toUpperCase()}** (${games.length} games)`);

    for (const game of games.slice(0, 3)) {
      const homeProb = (game.consensusHomeWinProb * 100).toFixed(0);
      const awayProb = (game.consensusAwayWinProb * 100).toFixed(0);
      lines.push(`${game.awayTeam} @ ${game.homeTeam}: ${awayProb}% / ${homeProb}%`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// KALSHI SPORTS MARKET MATCHING
// =============================================================================

export interface SportsEdgeSignal {
  kalshiMarket: Market;
  matchedGame: SportOdds;
  kalshiPrice: number;
  consensusProb: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
  matchType: 'home_win' | 'away_win' | 'spread' | 'total';
}

// =============================================================================
// TEAM NAME NORMALIZATION - Uses unified teams.ts module
// =============================================================================

/**
 * Build team aliases map from unified teams module
 * Combines all pro leagues for sports odds matching
 */
function buildSportsOddsAliases(): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};

  const allTeams: LeagueTeams[] = [NFL_TEAMS, NBA_TEAMS, MLB_TEAMS, NHL_TEAMS];

  for (const teams of allTeams) {
    for (const [teamKey, info] of Object.entries(teams)) {
      // Use the last word of fullName as key (team nickname)
      const nickname = info.fullName.split(' ').pop()?.toLowerCase() ?? teamKey;

      // Combine aliases with lowercase abbreviations
      const allAliases = [
        ...info.aliases,
        ...info.abbreviations.map(a => a.toLowerCase()),
      ];

      // Store under both teamKey and nickname
      aliases[teamKey] = allAliases;
      if (nickname !== teamKey) {
        aliases[nickname] = allAliases;
      }
    }
  }

  return aliases;
}

const TEAM_ALIASES = buildSportsOddsAliases();

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase();

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(alias => lower.includes(alias))) {
      return canonical;
    }
  }

  // Return last word (usually team name)
  const words = lower.split(/\s+/);
  return words[words.length - 1];
}

/**
 * Check if a Kalshi market matches a sports game
 */
function matchKalshiToGame(
  market: Market,
  game: SportOdds
): { matched: boolean; matchType: 'home_win' | 'away_win' | 'spread' | 'total' | null; teamSide: 'home' | 'away' | null } {
  const title = (market.title ?? '').toLowerCase();

  const homeNorm = normalizeTeamName(game.homeTeam);
  const awayNorm = normalizeTeamName(game.awayTeam);

  // Check if market mentions either team
  const mentionsHome = title.includes(homeNorm) ||
    TEAM_ALIASES[homeNorm]?.some(alias => title.includes(alias));
  const mentionsAway = title.includes(awayNorm) ||
    TEAM_ALIASES[awayNorm]?.some(alias => title.includes(alias));

  if (!mentionsHome && !mentionsAway) {
    return { matched: false, matchType: null, teamSide: null };
  }

  // Determine match type
  let matchType: 'home_win' | 'away_win' | 'spread' | 'total' | null = null;
  let teamSide: 'home' | 'away' | null = null;

  if (title.includes('win') || title.includes('beat') || title.includes('defeat')) {
    if (mentionsHome && !mentionsAway) {
      matchType = 'home_win';
      teamSide = 'home';
    } else if (mentionsAway && !mentionsHome) {
      matchType = 'away_win';
      teamSide = 'away';
    }
  } else if (title.includes('spread') || title.includes('cover') || title.includes('points')) {
    matchType = 'spread';
    teamSide = mentionsHome ? 'home' : 'away';
  } else if (title.includes('over') || title.includes('under') || title.includes('total')) {
    matchType = 'total';
  } else if (mentionsHome || mentionsAway) {
    // Default to win market if team is mentioned
    matchType = mentionsHome ? 'home_win' : 'away_win';
    teamSide = mentionsHome ? 'home' : 'away';
  }

  return { matched: matchType !== null, matchType, teamSide };
}

/**
 * Match Kalshi sports markets to sportsbook consensus and find edges
 *
 * ADVERSARIAL LOGIC:
 * - Sportsbooks have sharp lines from millions in handle
 * - Kalshi sports markets have less liquidity, can misprice
 * - Edge exists when Kalshi diverges significantly from consensus
 * - We bet toward the consensus (sharper) price
 */
export function findSportsEdges(
  kalshiMarkets: Market[],
  sportsOdds: Map<string, SportOdds[]>,
  minEdge: number = 0.05
): SportsEdgeSignal[] {
  const edges: SportsEdgeSignal[] = [];

  // Filter Kalshi markets to sports-related
  const sportsMarkets = kalshiMarkets.filter(m => {
    const title = (m.title ?? '').toLowerCase();
    const category = (m.category ?? '').toLowerCase();

    return category === 'sports' ||
      title.includes('nfl') || title.includes('nba') ||
      title.includes('mlb') || title.includes('nhl') ||
      title.includes('win') && (
        Object.keys(TEAM_ALIASES).some(team => title.includes(team))
      );
  });

  if (sportsMarkets.length === 0) {
    logger.debug('No Kalshi sports markets found');
    return [];
  }

  logger.debug(`Checking ${sportsMarkets.length} Kalshi sports markets against sportsbook odds`);

  // Try to match each Kalshi market to a game
  for (const market of sportsMarkets) {
    for (const [sport, games] of sportsOdds) {
      for (const game of games) {
        const match = matchKalshiToGame(market, game);

        if (!match.matched || !match.matchType) continue;

        // Get consensus probability based on match type
        let consensusProb: number;

        switch (match.matchType) {
          case 'home_win':
            consensusProb = game.consensusHomeWinProb;
            break;
          case 'away_win':
            consensusProb = game.consensusAwayWinProb;
            break;
          case 'spread':
          case 'total':
            // For spread/total, assume 50% (vig-adjusted)
            consensusProb = 0.5;
            break;
          default:
            continue;
        }

        // Compare to Kalshi price
        const comparison = compareKalshiToConsensus(market.price, consensusProb, minEdge);

        if (comparison.direction === 'no_edge') continue;

        edges.push({
          kalshiMarket: market,
          matchedGame: game,
          kalshiPrice: market.price,
          consensusProb,
          edge: comparison.edge,
          direction: comparison.direction,
          confidence: comparison.confidence,
          reasoning: `${game.awayTeam} @ ${game.homeTeam}: ${comparison.reasoning}`,
          matchType: match.matchType,
        });
      }
    }
  }

  // Sort by edge magnitude
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  logger.info(`Found ${edges.length} sports edges vs sportsbook consensus`);

  return edges;
}

/**
 * Format sports edges report
 */
// =============================================================================
// PLAYER PROPS
// =============================================================================

export interface PlayerProp {
  gameId: string;
  sport: string;
  playerName: string;
  team: string;
  propType: string;        // e.g., 'player_pass_tds', 'player_rush_yds'
  propLabel: string;       // Human readable: 'Passing TDs', 'Rushing Yards'
  line: number;            // The over/under line (e.g., 1.5 TDs, 74.5 yards)
  overPrice: number;       // American odds for over
  underPrice: number;      // American odds for under
  overProb: number;        // Implied probability for over
  underProb: number;       // Implied probability for under
  bookmaker: string;
  lastUpdate: string;
}

export interface PlayerPropEdge {
  kalshiMarket: Market;
  playerProp: PlayerProp;
  kalshiPrice: number;
  consensusProb: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
}

// Player prop market types supported by The Odds API
const PLAYER_PROP_MARKETS: Record<string, string[]> = {
  nfl: [
    'player_pass_tds',
    'player_pass_yds',
    'player_rush_yds',
    'player_receptions',
    'player_reception_yds',
    'player_anytime_td',
  ],
  nba: [
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_threes',
    'player_blocks',
    'player_steals',
    'player_points_rebounds_assists',
  ],
  mlb: [
    'batter_hits',
    'batter_total_bases',
    'batter_rbis',
    'batter_runs_scored',
    'batter_home_runs',
    'pitcher_strikeouts',
  ],
  nhl: [
    'player_points',
    'player_shots_on_goal',
    'player_goals',
    'player_assists',
  ],
};

// Human-readable labels for prop types
const PROP_LABELS: Record<string, string> = {
  player_pass_tds: 'Passing TDs',
  player_pass_yds: 'Passing Yards',
  player_rush_yds: 'Rushing Yards',
  player_receptions: 'Receptions',
  player_reception_yds: 'Receiving Yards',
  player_anytime_td: 'Anytime TD',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers',
  player_blocks: 'Blocks',
  player_steals: 'Steals',
  player_points_rebounds_assists: 'PTS+REB+AST',
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  batter_rbis: 'RBIs',
  batter_runs_scored: 'Runs',
  batter_home_runs: 'Home Runs',
  pitcher_strikeouts: 'Strikeouts',
  player_shots_on_goal: 'Shots on Goal',
  player_goals: 'Goals',
};

/**
 * Fetch player props for upcoming games in a sport
 * Note: Player props require event IDs, so we first fetch events then props
 */
export async function fetchPlayerProps(sport: keyof typeof SPORT_KEYS): Promise<PlayerProp[]> {
  if (!ODDS_API_KEY) {
    return [];
  }

  const sportKey = SPORT_KEYS[sport];
  const propMarkets = PLAYER_PROP_MARKETS[sport];

  if (!sportKey || !propMarkets) {
    return [];
  }

  try {
    // First, fetch event IDs for this sport
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}`;
    const eventsResponse = await fetch(eventsUrl);

    if (!eventsResponse.ok) {
      logger.debug(`No events found for ${sport} player props`);
      return [];
    }

    const events = await eventsResponse.json() as Array<{
      id: string;
      sport_key: string;
      home_team: string;
      away_team: string;
      commence_time: string;
    }>;

    if (events.length === 0) {
      return [];
    }

    // Limit to first 3 games to conserve API calls
    const allProps: PlayerProp[] = [];
    const marketsParam = propMarkets.join(',');

    for (const event of events.slice(0, 3)) {
      try {
        const propsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${event.id}/odds?` +
          `apiKey=${ODDS_API_KEY}&regions=us&markets=${marketsParam}&oddsFormat=american`;

        const propsResponse = await fetch(propsUrl);

        if (!propsResponse.ok) {
          continue;
        }

        const propsData = await propsResponse.json() as {
          id: string;
          bookmakers: Array<{
            key: string;
            last_update: string;
            markets: Array<{
              key: string;
              outcomes: Array<{
                name: string;
                description: string;
                price: number;
                point?: number;
              }>;
            }>;
          }>;
        };

        // Parse player props from each bookmaker
        for (const bookmaker of propsData.bookmakers) {
          for (const market of bookmaker.markets) {
            const propType = market.key;

            // Group outcomes by player (over/under pairs)
            const playerOutcomes = new Map<string, { over?: typeof market.outcomes[0]; under?: typeof market.outcomes[0] }>();

            for (const outcome of market.outcomes) {
              const playerName = outcome.description || outcome.name;
              const existing = playerOutcomes.get(playerName) || {};

              if (outcome.name === 'Over') {
                existing.over = outcome;
              } else if (outcome.name === 'Under') {
                existing.under = outcome;
              }

              playerOutcomes.set(playerName, existing);
            }

            // Convert to PlayerProp objects
            for (const [playerName, outcomes] of playerOutcomes) {
              if (!outcomes.over || !outcomes.under) continue;

              const overProb = americanOddsToProb(outcomes.over.price);
              const underProb = americanOddsToProb(outcomes.under.price);

              // Determine team from player name (rough heuristic)
              const team = event.home_team; // Default, would need roster data for accuracy

              allProps.push({
                gameId: event.id,
                sport,
                playerName,
                team,
                propType,
                propLabel: PROP_LABELS[propType] || propType,
                line: outcomes.over.point ?? 0,
                overPrice: outcomes.over.price,
                underPrice: outcomes.under.price,
                overProb,
                underProb,
                bookmaker: bookmaker.key,
                lastUpdate: bookmaker.last_update,
              });
            }
          }
        }

        // Small delay between requests
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        logger.debug(`Error fetching props for event ${event.id}: ${err}`);
      }
    }

    logger.info(`  Fetched ${allProps.length} player props for ${sport}`);
    return allProps;

  } catch (error) {
    logger.debug(`Player props fetch error for ${sport}: ${error}`);
    return [];
  }
}

/**
 * Fetch all player props across major sports
 */
export async function fetchAllPlayerProps(): Promise<Map<string, PlayerProp[]>> {
  const allProps = new Map<string, PlayerProp[]>();

  const sports: Array<keyof typeof SPORT_KEYS> = ['nfl', 'nba', 'mlb', 'nhl'];

  for (const sport of sports) {
    const props = await fetchPlayerProps(sport);
    if (props.length > 0) {
      allProps.set(sport, props);
    }
  }

  return allProps;
}

/**
 * Normalize player name for matching
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match Kalshi player prop markets to sportsbook props
 */
export function findPlayerPropEdges(
  kalshiMarkets: Market[],
  playerProps: Map<string, PlayerProp[]>,
  minEdge: number = 0.05
): PlayerPropEdge[] {
  const edges: PlayerPropEdge[] = [];

  // Filter to player prop markets (usually have player names + stats)
  const propMarkets = kalshiMarkets.filter(m => {
    const title = (m.title ?? '').toLowerCase();
    return (
      title.includes('yards') ||
      title.includes('touchdowns') ||
      title.includes('points') ||
      title.includes('rebounds') ||
      title.includes('assists') ||
      title.includes('receptions') ||
      title.includes('strikeouts') ||
      title.includes('hits') ||
      title.includes('goals') ||
      title.includes('3-pointers') ||
      title.includes('threes')
    );
  });

  if (propMarkets.length === 0) {
    return [];
  }

  logger.debug(`Checking ${propMarkets.length} Kalshi player prop markets`);

  for (const market of propMarkets) {
    const title = (market.title ?? '').toLowerCase();

    // Try to match to player props
    for (const [sport, props] of playerProps) {
      for (const prop of props) {
        const playerNorm = normalizePlayerName(prop.playerName);

        // Check if market mentions this player
        if (!title.includes(playerNorm)) {
          // Try first/last name separately
          const nameParts = playerNorm.split(' ');
          const hasName = nameParts.some(part => part.length > 2 && title.includes(part));
          if (!hasName) continue;
        }

        // Check if prop type matches
        const propLabel = prop.propLabel.toLowerCase();
        if (!title.includes(propLabel.split(' ')[0])) continue;

        // Determine if Kalshi market is over or under
        const isOver = title.includes('over') || title.includes('more than') || title.includes('above');
        const isUnder = title.includes('under') || title.includes('fewer than') || title.includes('below');

        if (!isOver && !isUnder) continue;

        // Get consensus probability
        const consensusProb = isOver ? prop.overProb : prop.underProb;
        const kalshiPrice = market.price;

        // Calculate edge
        const edge = consensusProb - kalshiPrice;

        if (Math.abs(edge) < minEdge) continue;

        const direction = edge > 0 ? 'buy_yes' : 'buy_no';
        const confidence = Math.min(0.6 + Math.abs(edge) * 2, 0.85);

        edges.push({
          kalshiMarket: market,
          playerProp: prop,
          kalshiPrice,
          consensusProb,
          edge,
          direction,
          confidence,
          reasoning: `${prop.playerName} ${prop.propLabel} ${isOver ? 'Over' : 'Under'} ${prop.line}: ` +
            `Sportsbooks ${(consensusProb * 100).toFixed(0)}% vs Kalshi ${(kalshiPrice * 100).toFixed(0)}%`,
        });
      }
    }
  }

  // Sort by edge and deduplicate by market
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  // Keep best edge per market
  const bestPerMarket = new Map<string, PlayerPropEdge>();
  for (const edge of edges) {
    const key = edge.kalshiMarket.id;
    if (!bestPerMarket.has(key) || Math.abs(edge.edge) > Math.abs(bestPerMarket.get(key)!.edge)) {
      bestPerMarket.set(key, edge);
    }
  }

  const dedupedEdges = Array.from(bestPerMarket.values());
  logger.info(`Found ${dedupedEdges.length} player prop edges`);

  return dedupedEdges;
}

export function formatSportsEdgesReport(edges: SportsEdgeSignal[]): string {
  if (edges.length === 0) {
    return 'No sports edges found vs sportsbook consensus.';
  }

  const lines: string[] = [
    '**🏆 Sports: Kalshi vs Sportsbook Consensus**',
    '═══════════════════════════════════════════════',
    '',
  ];

  for (const edge of edges.slice(0, 5)) {
    const dirIcon = edge.direction === 'buy_yes' ? '📈' : '📉';
    const edgePct = (edge.edge * 100).toFixed(1);
    const confPct = (edge.confidence * 100).toFixed(0);

    lines.push(`${dirIcon} **${edge.kalshiMarket.title?.slice(0, 50)}**`);
    lines.push(`   Game: ${edge.matchedGame.awayTeam} @ ${edge.matchedGame.homeTeam}`);
    lines.push(`   Kalshi: ${(edge.kalshiPrice * 100).toFixed(0)}% | Consensus: ${(edge.consensusProb * 100).toFixed(0)}%`);
    lines.push(`   Edge: ${edgePct}% | Direction: ${edge.direction.toUpperCase()} | Conf: ${confPct}%`);
    lines.push('');
  }

  return lines.join('\n');
}
