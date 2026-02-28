#!/usr/bin/env node
/**
 * NCAAM Basketball Edge Scanner
 *
 * Scans for edges in college basketball markets by:
 * 1. Fetching upcoming NCAAM games + odds from ESPN
 * 2. Fetching Kalshi MVE markets containing college basketball legs
 * 3. Cross-referencing spreads/totals for mispricing
 * 4. Reporting potential edges
 */

import 'dotenv/config';

// =============================================================================
// TYPES
// =============================================================================

interface NCAAMGame {
  id: string;
  homeTeam: string;
  homeAbbr: string;
  homeRank: number | null;
  awayTeam: string;
  awayAbbr: string;
  awayRank: number | null;
  startTime: string;
  status: string;
  spread?: number;        // Home spread
  overUnder?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
  provider?: string;
}

interface KalshiNCAAMLeg {
  ticker: string;
  title: string;
  team: string;
  type: 'spread' | 'total' | 'moneyline' | 'parlay';
  spreadValue?: number;
  totalValue?: number;
  side?: 'over' | 'under' | 'yes' | 'no';
  price: number;
  volume: number;
  closeTime: string;
}

interface EdgeResult {
  game: NCAAMGame;
  kalshiLeg: KalshiNCAAMLeg;
  espnImpliedProb: number;
  kalshiImpliedProb: number;
  edge: number;
  direction: string;
  confidence: number;
  reason: string;
}

// =============================================================================
// COLLEGE BASKETBALL TEAMS
// =============================================================================

const COLLEGE_TEAMS = [
  'duke', 'north carolina', 'kentucky', 'kansas', 'gonzaga', 'uconn',
  'auburn', 'purdue', 'houston', 'tennessee', 'florida', 'iowa state',
  'marquette', 'alabama', 'michigan state', 'creighton', 'st. john',
  'texas tech', 'wisconsin', 'michigan', 'oregon', 'clemson', 'pitt',
  'maryland', 'ohio state', 'illinois', 'xavier', 'memphis', 'baylor',
  'arkansas', 'villanova', 'virginia', 'arizona', 'ucla', 'louisville',
  'georgia', 'south carolina', 'ole miss', 'mississippi state',
  'nc state', 'wake forest', 'georgia tech', 'boston university',
  'holy cross', 'rhode island', 'toledo', 'miami', 'western michigan',
  'syracuse', 'vanderbilt', 'nebraska', 'northwestern', 'indiana',
  'byu', 'cincinnati', 'tcu', 'arizona state', 'georgetown',
  'loyola chicago', 'saint louis', 'texas', 'colorado', 'oklahoma',
  'oklahoma state', 'iowa', 'penn state', 'rutgers', 'stanford',
  'notre dame', 'seton hall', 'depaul', 'butler', 'san diego state',
  'connecticut', 'texas a&m',
];

// =============================================================================
// ESPN FETCHER
// =============================================================================

async function fetchESPNGames(dates: string[]): Promise<NCAAMGame[]> {
  const allGames: NCAAMGame[] = [];

  for (const date of dates) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) continue;

      const data = await response.json() as { events?: ESPNEvent[] };
      const events = data.events ?? [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        if (!comp) continue;

        const home = comp.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'home');
        const away = comp.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'away');
        if (!home?.team || !away?.team) continue;

        const status = event.status?.type?.state ?? 'unknown';
        if (status === 'post') continue; // Skip finished

        const odds = comp.odds?.[0];

        const homeRank = home.curatedRank?.current;
        const awayRank = away.curatedRank?.current;

        allGames.push({
          id: event.id,
          homeTeam: home.team.displayName ?? 'Unknown',
          homeAbbr: home.team.abbreviation ?? '',
          homeRank: homeRank && homeRank <= 25 ? homeRank : null,
          awayTeam: away.team.displayName ?? 'Unknown',
          awayAbbr: away.team.abbreviation ?? '',
          awayRank: awayRank && awayRank <= 25 ? awayRank : null,
          startTime: event.date,
          status,
          spread: odds?.spread,
          overUnder: odds?.overUnder,
          homeMoneyline: odds?.homeTeamOdds?.moneyLine,
          awayMoneyline: odds?.awayTeamOdds?.moneyLine,
          provider: odds?.provider?.name,
        });
      }
    } catch (error) {
      console.error(`ESPN fetch error for ${date}: ${error}`);
    }
  }

  return allGames;
}

// ESPN types
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
  curatedRank?: { current?: number };
}

interface ESPNOdds {
  provider?: { name?: string };
  spread?: number;
  overUnder?: number;
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
}

// =============================================================================
// KALSHI FETCHER
// =============================================================================

async function fetchKalshiNCAAMMarkets(): Promise<KalshiNCAAMLeg[]> {
  const legs: KalshiNCAAMLeg[] = [];
  const baseUrl = 'https://api.elections.kalshi.com';

  // NCAAM dedicated series on Kalshi
  const mveSeriesList = [
    'KXNCAAMBGAME',      // Moneylines
    'KXNCAAMBSPREAD',    // Spreads
    'KXNCAAMBTOTAL',     // Totals
    'KXNCAAMB1HSPREAD',  // First half spreads
    'KXNCAAMB1HTOTAL',   // First half totals
  ];

  for (const series of mveSeriesList) {
    try {
      let cursor = '';
      let pageCount = 0;

      do {
        const url = cursor
          ? `${baseUrl}/trade-api/v2/markets?series_ticker=${series}&limit=200&status=open&cursor=${cursor}`
          : `${baseUrl}/trade-api/v2/markets?series_ticker=${series}&limit=200&status=open`;

        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) break;

        const data = await response.json() as { markets?: KalshiMarket[]; cursor?: string };
        if (!data?.markets) break;

        pageCount++;

        for (const m of data.markets) {
          const title = (m.title ?? '').toLowerCase();

          // Check if this market contains college basketball legs
          const hasCollegeLeg = COLLEGE_TEAMS.some(team => title.includes(team));
          if (!hasCollegeLeg) continue;

          // Parse legs from the title
          const parsed = parseKalshiLeg(m);
          if (parsed) {
            legs.push(parsed);
          }
        }

        cursor = data.cursor ?? '';
        if (pageCount >= 5) break; // Limit pages
      } while (cursor);

    } catch (error) {
      console.error(`Kalshi fetch error for ${series}: ${error}`);
    }
  }

  return legs;
}

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  status: string;
  yes_bid?: number;
  last_price?: number;
  volume?: number;
  close_time?: string;
}

function parseKalshiLeg(market: KalshiMarket): KalshiNCAAMLeg | null {
  const title = market.title ?? '';
  const titleLower = title.toLowerCase();
  const price = (market.yes_bid ?? market.last_price ?? 0) / 100;

  // Detect spread legs: "X wins by over Y Points"
  const spreadMatch = titleLower.match(/(\w[\w\s]+?)\s+wins by over ([\d.]+) points/);
  if (spreadMatch) {
    return {
      ticker: market.ticker,
      title,
      team: spreadMatch[1].trim(),
      type: 'spread',
      spreadValue: parseFloat(spreadMatch[2]),
      side: 'yes',
      price,
      volume: market.volume ?? 0,
      closeTime: market.close_time ?? '',
    };
  }

  // Detect total legs: "Over/Under X points scored"
  const totalMatch = titleLower.match(/(yes|no)\s+over ([\d.]+) points scored/);
  if (totalMatch) {
    return {
      ticker: market.ticker,
      title,
      team: 'total',
      type: 'total',
      totalValue: parseFloat(totalMatch[2]),
      side: totalMatch[1] === 'yes' ? 'over' : 'under',
      price,
      volume: market.volume ?? 0,
      closeTime: market.close_time ?? '',
    };
  }

  // Detect moneyline legs: "yes TeamName" (simple win)
  for (const team of COLLEGE_TEAMS) {
    if (titleLower.includes(`yes ${team}`) || titleLower.includes(`no ${team}`)) {
      const isYes = titleLower.includes(`yes ${team}`);
      return {
        ticker: market.ticker,
        title,
        team,
        type: 'moneyline',
        side: isYes ? 'yes' : 'no',
        price,
        volume: market.volume ?? 0,
        closeTime: market.close_time ?? '',
      };
    }
  }

  // Generic parlay with college team reference
  const matchedTeam = COLLEGE_TEAMS.find(t => titleLower.includes(t));
  if (matchedTeam) {
    return {
      ticker: market.ticker,
      title,
      team: matchedTeam,
      type: 'parlay',
      price,
      volume: market.volume ?? 0,
      closeTime: market.close_time ?? '',
    };
  }

  return null;
}

// =============================================================================
// ODDS UTILITIES
// =============================================================================

function oddsToProb(americanOdds: number): number {
  if (americanOdds === 0) return 0.5;
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function spreadToWinProb(spread: number): number {
  // Each point of spread ≈ 3% win probability (standard model)
  const prob = 0.5 - (spread * 0.03);
  return Math.max(0.05, Math.min(0.95, prob));
}

function spreadToMarginProb(spread: number, marginLine: number): number {
  // Probability of winning by more than marginLine given the spread
  // Using normal distribution approximation with std dev of ~11 for college basketball
  const stdDev = 11; // College basketball scoring margin std dev
  const expectedMargin = -spread; // Convert spread to expected margin (negative spread = favored)
  const z = (marginLine - expectedMargin) / stdDev;
  // Approximate normal CDF
  return 1 - normalCDF(z);
}

function normalCDF(x: number): number {
  // Approximation of the standard normal CDF
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

function detectEdges(games: NCAAMGame[], kalshiLegs: KalshiNCAAMLeg[]): EdgeResult[] {
  const edges: EdgeResult[] = [];

  for (const leg of kalshiLegs) {
    if (leg.price <= 0 || leg.price >= 1) continue;

    // Try to match to a game
    const matchedGame = findMatchingGame(leg, games);
    if (!matchedGame) continue;

    let espnImpliedProb: number | null = null;
    let reason = '';

    if (leg.type === 'spread' && leg.spreadValue !== undefined) {
      // Compare Kalshi spread market to ESPN spread
      if (matchedGame.spread !== undefined) {
        espnImpliedProb = spreadToMarginProb(matchedGame.spread, leg.spreadValue);
        reason = `ESPN spread ${matchedGame.spread > 0 ? '+' : ''}${matchedGame.spread} implies ${(espnImpliedProb * 100).toFixed(0)}% chance of winning by >${leg.spreadValue}, Kalshi prices at ${(leg.price * 100).toFixed(0)}%`;
      }
    } else if (leg.type === 'moneyline') {
      // Compare to ESPN moneyline
      const teamLower = leg.team.toLowerCase();
      const isHome = matchedGame.homeTeam.toLowerCase().includes(teamLower);

      if (isHome && matchedGame.homeMoneyline) {
        espnImpliedProb = oddsToProb(matchedGame.homeMoneyline);
      } else if (!isHome && matchedGame.awayMoneyline) {
        espnImpliedProb = oddsToProb(matchedGame.awayMoneyline);
      } else if (matchedGame.spread !== undefined) {
        espnImpliedProb = isHome ? spreadToWinProb(matchedGame.spread) : spreadToWinProb(-matchedGame.spread);
      }

      if (espnImpliedProb !== null) {
        reason = `ESPN implies ${(espnImpliedProb * 100).toFixed(0)}% win prob for ${leg.team}, Kalshi at ${(leg.price * 100).toFixed(0)}%`;
      }
    } else if (leg.type === 'total' && leg.totalValue !== undefined && matchedGame.overUnder !== undefined) {
      // Compare total to ESPN O/U
      const diff = leg.totalValue - matchedGame.overUnder;
      // Simple approximation: each point away from line is ~3% less likely
      espnImpliedProb = leg.side === 'over'
        ? 0.5 - (diff * 0.03)
        : 0.5 + (diff * 0.03);
      espnImpliedProb = Math.max(0.05, Math.min(0.95, espnImpliedProb));
      reason = `ESPN O/U at ${matchedGame.overUnder}, Kalshi line at ${leg.totalValue} ${leg.side}`;
    }

    if (espnImpliedProb === null) continue;

    const edge = Math.abs(espnImpliedProb - leg.price);
    if (edge < 0.03) continue; // Minimum 3% edge

    const direction = espnImpliedProb > leg.price ? 'BUY YES' : 'BUY NO';
    const confidence = calculateConfidence(edge, matchedGame, leg);

    edges.push({
      game: matchedGame,
      kalshiLeg: leg,
      espnImpliedProb,
      kalshiImpliedProb: leg.price,
      edge,
      direction,
      confidence,
      reason,
    });
  }

  // Sort by edge size descending
  edges.sort((a, b) => b.edge - a.edge);
  return edges;
}

function findMatchingGame(leg: KalshiNCAAMLeg, games: NCAAMGame[]): NCAAMGame | null {
  const teamLower = leg.team.toLowerCase();

  for (const game of games) {
    const homeLower = game.homeTeam.toLowerCase();
    const awayLower = game.awayTeam.toLowerCase();

    if (homeLower.includes(teamLower) || awayLower.includes(teamLower) ||
        teamLower.includes(homeLower.split(' ').pop() ?? '') ||
        teamLower.includes(awayLower.split(' ').pop() ?? '')) {
      return game;
    }
  }

  return null;
}

function calculateConfidence(edge: number, game: NCAAMGame, leg: KalshiNCAAMLeg): number {
  let confidence = 0.50;

  // Ranked games have better data
  if (game.homeRank || game.awayRank) confidence += 0.05;
  if (game.homeRank && game.awayRank) confidence += 0.05;

  // Larger edge = more confidence
  if (edge >= 0.10) confidence += 0.10;
  else if (edge >= 0.07) confidence += 0.05;

  // Volume indicates market efficiency
  if (leg.volume > 100) confidence += 0.05;
  if (leg.volume > 500) confidence += 0.05;

  // Have moneyline data = better pricing
  if (game.homeMoneyline && game.awayMoneyline) confidence += 0.10;

  return Math.min(0.85, confidence);
}

// =============================================================================
// OUTPUT FORMATTING
// =============================================================================

function formatResults(games: NCAAMGame[], kalshiLegs: KalshiNCAAMLeg[], edges: EdgeResult[]): void {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║            NCAAM BASKETBALL EDGE SCANNER                   ║
║            ${new Date().toISOString().split('T')[0]}                              ║
╚════════════════════════════════════════════════════════════╝
`);

  // Upcoming Games
  console.log('=== UPCOMING NCAAM GAMES ===\n');
  const preGames = games.filter(g => g.status === 'pre');

  if (preGames.length === 0) {
    console.log('  No upcoming games found for today/tomorrow.');
    console.log('  Note: ESPN odds typically appear 24-48 hours before tipoff.\n');
  }

  for (const game of preGames) {
    const homeRank = game.homeRank ? `#${game.homeRank} ` : '';
    const awayRank = game.awayRank ? `#${game.awayRank} ` : '';
    const gameTime = new Date(game.startTime).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    console.log(`  ${awayRank}${game.awayTeam} (${game.awayAbbr}) @ ${homeRank}${game.homeTeam} (${game.homeAbbr})`);
    console.log(`    Time: ${gameTime} ET`);

    if (game.spread !== undefined) {
      const spreadStr = game.spread > 0 ? `+${game.spread}` : `${game.spread}`;
      console.log(`    Spread: ${game.homeAbbr} ${spreadStr} | O/U: ${game.overUnder ?? 'N/A'}`);
    }
    if (game.homeMoneyline !== undefined) {
      console.log(`    ML: ${game.awayAbbr} ${game.awayMoneyline} / ${game.homeAbbr} ${game.homeMoneyline} (${game.provider})`);
    }
    if (!game.spread && !game.homeMoneyline) {
      console.log(`    Odds: Not yet posted`);
    }
    console.log('');
  }

  // Kalshi Markets
  console.log('=== KALSHI NCAAM MARKETS ===\n');

  // Group by type
  const spreadLegs = kalshiLegs.filter(l => l.type === 'spread');
  const mlLegs = kalshiLegs.filter(l => l.type === 'moneyline');
  const totalLegs = kalshiLegs.filter(l => l.type === 'total');
  const parlayLegs = kalshiLegs.filter(l => l.type === 'parlay');

  console.log(`  Found ${kalshiLegs.length} NCAAM-related Kalshi markets:`);
  console.log(`    Spread markets: ${spreadLegs.length}`);
  console.log(`    Moneyline markets: ${mlLegs.length}`);
  console.log(`    Total markets: ${totalLegs.length}`);
  console.log(`    Parlay markets: ${parlayLegs.length}`);
  console.log('');

  // Show notable Kalshi markets
  const notableLegs = kalshiLegs
    .filter(l => l.volume > 0 || l.price > 0)
    .sort((a, b) => b.volume - a.volume);

  if (notableLegs.length > 0) {
    console.log('  Notable Markets (with volume/price):');
    for (const leg of notableLegs.slice(0, 15)) {
      const pricePct = (leg.price * 100).toFixed(0);
      console.log(`    [${pricePct}¢ | Vol:${leg.volume}] ${leg.title.slice(0, 80)}`);
      console.log(`      Team: ${leg.team} | Type: ${leg.type}${leg.spreadValue ? ` (${leg.spreadValue}pts)` : ''}`);
      console.log('');
    }
  }

  // Edges
  console.log('=== EDGE OPPORTUNITIES ===\n');

  if (edges.length === 0) {
    console.log('  No significant edges detected.\n');
    console.log('  Possible reasons:');
    console.log('  - ESPN odds not yet posted (check closer to game time)');
    console.log('  - Kalshi MVE parlays have low liquidity');
    console.log('  - Markets are efficiently priced');
    console.log('');
  }

  for (const e of edges.slice(0, 10)) {
    const urgency = e.edge >= 0.10 ? '🔴 CRITICAL' : e.edge >= 0.07 ? '🟡 STANDARD' : '🟢 FYI';
    const edgePct = (e.edge * 100).toFixed(1);
    const confPct = (e.confidence * 100).toFixed(0);
    const homeRank = e.game.homeRank ? `#${e.game.homeRank} ` : '';
    const awayRank = e.game.awayRank ? `#${e.game.awayRank} ` : '';

    console.log(`  ${urgency} | Edge: ${edgePct}% | ${e.direction}`);
    console.log(`  ${awayRank}${e.game.awayTeam} @ ${homeRank}${e.game.homeTeam}`);
    console.log(`  ${e.reason}`);
    console.log(`  Confidence: ${confPct}% | Volume: ${e.kalshiLeg.volume}`);
    console.log(`  Ticker: ${e.kalshiLeg.ticker.slice(0, 50)}...`);
    console.log('');
  }

  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`  Games scanned: ${games.length} (${preGames.length} upcoming)`);
  console.log(`  Kalshi NCAAM markets: ${kalshiLegs.length}`);
  console.log(`  Edges found: ${edges.length}`);
  if (edges.length > 0) {
    const avgEdge = edges.reduce((s, e) => s + e.edge, 0) / edges.length;
    console.log(`  Average edge: ${(avgEdge * 100).toFixed(1)}%`);
    console.log(`  Largest edge: ${(edges[0].edge * 100).toFixed(1)}%`);
  }
  console.log('');

  // Schedule note
  console.log('=== UPCOMING SCHEDULE NOTE ===\n');
  const dateNow = new Date();
  const marchMadness = new Date('2026-03-17'); // Selection Sunday is typically mid-March
  const daysToMM = Math.ceil((marchMadness.getTime() - dateNow.getTime()) / (1000 * 60 * 60 * 24));

  if (daysToMM > 0 && daysToMM <= 30) {
    console.log(`  March Madness is approximately ${daysToMM} days away!`);
    console.log('  Expect significantly more NCAAM markets and edges as the tournament approaches.');
    console.log('  Selection Sunday typically brings a flood of new bracket/game markets.\n');
  }

  // Conference tournament info
  console.log('  Conference tournaments are underway - high-volume period for college basketball.');
  console.log('  Key upcoming dates:');
  console.log('    - Conference tournament championships: Early March');
  console.log('    - Selection Sunday: ~Mar 15');
  console.log('    - First Four: ~Mar 17-18');
  console.log('    - First Round: ~Mar 19-20');
  console.log('    - Sweet 16: ~Mar 26-27');
  console.log('    - Final Four: ~Apr 4');
  console.log('    - Championship: ~Apr 6\n');
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  // Generate date strings for today through next 5 days
  const dates: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));
  }

  console.log(`Scanning NCAAM games for dates: ${dates.join(', ')}...\n`);

  // Fetch data in parallel
  const [games, kalshiLegs] = await Promise.all([
    fetchESPNGames(dates),
    fetchKalshiNCAAMMarkets(),
  ]);

  console.log(`Fetched ${games.length} ESPN games and ${kalshiLegs.length} Kalshi NCAAM legs\n`);

  // Detect edges
  const edges = detectEdges(games, kalshiLegs);

  // Format and display
  formatResults(games, kalshiLegs, edges);
}

main().catch(error => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
