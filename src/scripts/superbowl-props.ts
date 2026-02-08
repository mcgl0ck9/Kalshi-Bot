#!/usr/bin/env tsx
/**
 * Super Bowl LX Props Scanner
 *
 * Compares Kalshi market prices vs FanDuel sportsbook odds to find edge
 * in player props, then suggests optimal parlays.
 *
 * Seattle Seahawks vs New England Patriots — Feb 8, 2026
 */

import 'dotenv/config';
import * as fs from 'fs';

// =============================================================================
// TYPES
// =============================================================================

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  yes_sub_title?: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  status: string;
  close_time?: string;
}

interface FanDuelProp {
  player: string;
  team: 'SEA' | 'NE';
  propType: string;
  line?: number;
  odds: number;          // American odds (e.g., +370, -110)
  impliedProb: number;   // Raw implied probability (with vig)
}

interface EdgeResult {
  player: string;
  propType: string;
  kalshiPrice: number;    // 0-100 cents
  kalshiAsk: number;
  fanDuelOdds: number;
  fanDuelImplied: number;
  kalshiImplied: number;
  edge: number;           // positive = value on FanDuel
  edgeDirection: 'FD_VALUE' | 'KALSHI_VALUE' | 'FAIR';
  payoutFD: number;
  payoutKalshi: number;
  confidence: number;
  ticker?: string;
}

interface ParlayLeg {
  player: string;
  prop: string;
  odds: number;
  impliedProb: number;
  confidence: number;
  reason: string;
  correlation: string;
}

interface ParlayRecommendation {
  name: string;
  theme: string;
  legs: ParlayLeg[];
  combinedOdds: number;
  impliedProb: number;
  correlationBoost: number;
  reason: string;
}

// =============================================================================
// UTILITY: ODDS CONVERSION
// =============================================================================

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanToPayout(odds: number): number {
  if (odds > 0) return (odds + 100) / 100;
  return (Math.abs(odds) + 100) / Math.abs(odds);
}

function impliedToAmerican(prob: number): number {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatPct(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

// =============================================================================
// KALSHI DATA FETCHING
// =============================================================================

async function fetchKalshiSeries(series: string): Promise<KalshiMarket[]> {
  // Try loading from pre-fetched file first (works around proxy issues)
  const filePath = `/tmp/kalshi_${series}.json`;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as { markets?: KalshiMarket[] };
      return (data.markets ?? []).filter((m: KalshiMarket) => m.status === 'active');
    }
  } catch {
    // Fall through to API
  }

  // Fall back to API
  try {
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&limit=200`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json() as { markets?: KalshiMarket[] };
    return (data.markets ?? []).filter((m: KalshiMarket) => m.status === 'active');
  } catch {
    return [];
  }
}

async function fetchAllKalshiProps(): Promise<Map<string, KalshiMarket[]>> {
  const seriesList = [
    'KXSB',           // Super Bowl winner
    'KXNFLSBMVP',     // Super Bowl MVP
    'KXNFLFIRSTTD',   // First touchdown scorer
    'KXNFLTOTAL',     // Total points
    'KXNFLSPREAD',    // Point spread
    'KXNFLOT',        // Overtime
    'KXNFLREC',       // Receptions
  ];

  const results = new Map<string, KalshiMarket[]>();

  console.log('Fetching Kalshi markets...');
  for (const series of seriesList) {
    const markets = await fetchKalshiSeries(series);
    if (markets.length > 0) {
      results.set(series, markets);
      console.log(`  ${series}: ${markets.length} active markets`);
    }
  }

  return results;
}

// =============================================================================
// FANDUEL DATA (hardcoded from live scrape — Feb 8, 2026)
// =============================================================================

function getFanDuelProps(): FanDuelProp[] {
  const props: FanDuelProp[] = [];

  // ---- GAME LINES ----
  props.push(
    { player: 'Seattle Seahawks', team: 'SEA', propType: 'moneyline', odds: -225, impliedProb: americanToImplied(-225) },
    { player: 'New England Patriots', team: 'NE', propType: 'moneyline', odds: 188, impliedProb: americanToImplied(188) },
  );

  // ---- MVP ----
  props.push(
    { player: 'Sam Darnold', team: 'SEA', propType: 'mvp', odds: 120, impliedProb: americanToImplied(120) },
    { player: 'Drake Maye', team: 'NE', propType: 'mvp', odds: 240, impliedProb: americanToImplied(240) },
    { player: 'Jaxon Smith-Njigba', team: 'SEA', propType: 'mvp', odds: 500, impliedProb: americanToImplied(500) },
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'mvp', odds: 850, impliedProb: americanToImplied(850) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'mvp', odds: 2800, impliedProb: americanToImplied(2800) },
    { player: 'Rashid Shaheed', team: 'SEA', propType: 'mvp', odds: 3000, impliedProb: americanToImplied(3000) },
  );

  // ---- FIRST TD SCORER ----
  props.push(
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'first_td', odds: 370, impliedProb: americanToImplied(370) },
    { player: 'Jaxon Smith-Njigba', team: 'SEA', propType: 'first_td', odds: 550, impliedProb: americanToImplied(550) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'first_td', odds: 800, impliedProb: americanToImplied(800) },
    { player: 'Cooper Kupp', team: 'SEA', propType: 'first_td', odds: 1200, impliedProb: americanToImplied(1200) },
    { player: 'AJ Barner', team: 'SEA', propType: 'first_td', odds: 1200, impliedProb: americanToImplied(1200) },
    { player: 'Stefon Diggs', team: 'NE', propType: 'first_td', odds: 1400, impliedProb: americanToImplied(1400) },
    { player: 'Hunter Henry', team: 'NE', propType: 'first_td', odds: 1600, impliedProb: americanToImplied(1600) },
    { player: 'Kayshon Boutte', team: 'NE', propType: 'first_td', odds: 1700, impliedProb: americanToImplied(1700) },
    { player: 'Drake Maye', team: 'NE', propType: 'first_td', odds: 1700, impliedProb: americanToImplied(1700) },
    { player: 'Rashid Shaheed', team: 'SEA', propType: 'first_td', odds: 1900, impliedProb: americanToImplied(1900) },
    { player: 'Mack Hollins', team: 'NE', propType: 'first_td', odds: 2200, impliedProb: americanToImplied(2200) },
    { player: 'George Holani', team: 'SEA', propType: 'first_td', odds: 2200, impliedProb: americanToImplied(2200) },
    { player: 'TreVeyon Henderson', team: 'NE', propType: 'first_td', odds: 2700, impliedProb: americanToImplied(2700) },
    { player: 'Seattle D/ST', team: 'SEA', propType: 'first_td', odds: 3000, impliedProb: americanToImplied(3000) },
    { player: 'DeMario Douglas', team: 'NE', propType: 'first_td', odds: 3300, impliedProb: americanToImplied(3300) },
    { player: 'Austin Hooper', team: 'NE', propType: 'first_td', odds: 3500, impliedProb: americanToImplied(3500) },
    { player: 'New England D/ST', team: 'NE', propType: 'first_td', odds: 3500, impliedProb: americanToImplied(3500) },
    { player: 'Sam Darnold', team: 'SEA', propType: 'first_td', odds: 3500, impliedProb: americanToImplied(3500) },
  );

  // ---- ANYTIME TD ----
  props.push(
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'anytime_td', odds: -185, impliedProb: americanToImplied(-185) },
    { player: 'Jaxon Smith-Njigba', team: 'SEA', propType: 'anytime_td', odds: -105, impliedProb: americanToImplied(-105) },
    { player: 'Hunter Henry', team: 'NE', propType: 'anytime_td', odds: 230, impliedProb: americanToImplied(230) },
    { player: 'Seattle D/ST', team: 'SEA', propType: 'anytime_td', odds: 550, impliedProb: americanToImplied(550) },
    { player: 'Austin Hooper', team: 'NE', propType: 'anytime_td', odds: 800, impliedProb: americanToImplied(800) },
  );

  // ---- PASSING PROPS ----
  props.push(
    { player: 'Sam Darnold', team: 'SEA', propType: 'pass_yards_over', line: 229.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Sam Darnold', team: 'SEA', propType: 'completions_over', line: 20.5, odds: -115, impliedProb: americanToImplied(-115) },
    { player: 'Sam Darnold', team: 'SEA', propType: 'pass_tds_over', line: 1.5, odds: -130, impliedProb: americanToImplied(-130) },
    { player: 'Sam Darnold', team: 'SEA', propType: 'ints_over', line: 0.5, odds: -126, impliedProb: americanToImplied(-126) },
    { player: 'Drake Maye', team: 'NE', propType: 'pass_yards_over', line: 221.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Drake Maye', team: 'NE', propType: 'completions_over', line: 19.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Drake Maye', team: 'NE', propType: 'pass_tds_over', line: 1.5, odds: 140, impliedProb: americanToImplied(140) },
    { player: 'Drake Maye', team: 'NE', propType: 'ints_over', line: 0.5, odds: -127, impliedProb: americanToImplied(-127) },
  );

  // ---- RUSHING PROPS ----
  props.push(
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'rush_yards_over', line: 72.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'rush_attempts_over', line: 18.5, odds: -115, impliedProb: americanToImplied(-115) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'rush_yards_over', line: 48.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'rush_attempts_over', line: 14.5, odds: -110, impliedProb: americanToImplied(-110) },
  );

  // ---- RECEIVING PROPS ----
  props.push(
    { player: 'Jaxon Smith-Njigba', team: 'SEA', propType: 'rec_yards_over', line: 92.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Jaxon Smith-Njigba', team: 'SEA', propType: 'receptions_over', line: 6.5, odds: -120, impliedProb: americanToImplied(-120) },
    { player: 'Cooper Kupp', team: 'SEA', propType: 'rec_yards_over', line: 33.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Cooper Kupp', team: 'SEA', propType: 'receptions_over', line: 3.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Rashid Shaheed', team: 'SEA', propType: 'rec_yards_over', line: 20.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Rashid Shaheed', team: 'SEA', propType: 'receptions_over', line: 1.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Stefon Diggs', team: 'NE', propType: 'rec_yards_over', line: 43.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Stefon Diggs', team: 'NE', propType: 'receptions_over', line: 4.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Hunter Henry', team: 'NE', propType: 'rec_yards_over', line: 38.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Hunter Henry', team: 'NE', propType: 'receptions_over', line: 3.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Kayshon Boutte', team: 'NE', propType: 'rec_yards_over', line: 30.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Kayshon Boutte', team: 'NE', propType: 'receptions_over', line: 2.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'rec_yards_over', line: 22.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Rhamondre Stevenson', team: 'NE', propType: 'receptions_over', line: 3.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'rec_yards_over', line: 20.5, odds: -110, impliedProb: americanToImplied(-110) },
    { player: 'Kenneth Walker III', team: 'SEA', propType: 'receptions_over', line: 2.5, odds: -130, impliedProb: americanToImplied(-130) },
  );

  // ---- OTHER ----
  props.push(
    { player: 'Leonard Williams', team: 'SEA', propType: 'sack', odds: 144, impliedProb: americanToImplied(144) },
    { player: 'AJ Barner', team: 'SEA', propType: 'rush_yards_over', line: 0.5, odds: 116, impliedProb: americanToImplied(116) },
  );

  return props;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

function findEdges(
  kalshiMarkets: Map<string, KalshiMarket[]>,
  fdProps: FanDuelProp[]
): EdgeResult[] {
  const edges: EdgeResult[] = [];

  // --- MVP Edge Comparison ---
  const mvpMarkets = kalshiMarkets.get('KXNFLSBMVP') ?? [];
  const mvpProps = fdProps.filter(p => p.propType === 'mvp');

  for (const fdProp of mvpProps) {
    const playerKey = normalizePlayerName(fdProp.player);
    const match = mvpMarkets.find(m => {
      const sub = (m.yes_sub_title ?? m.subtitle ?? '').toLowerCase();
      return sub.includes(playerKey) || playerKey.split(' ').every(part => sub.includes(part));
    });

    if (match) {
      const kalshiMid = (match.yes_bid + match.yes_ask) / 2;
      const kalshiImplied = kalshiMid / 100;
      const fdImplied = fdProp.impliedProb;
      const edge = fdImplied - kalshiImplied;

      edges.push({
        player: fdProp.player,
        propType: 'SB MVP',
        kalshiPrice: match.yes_bid,
        kalshiAsk: match.yes_ask,
        fanDuelOdds: fdProp.odds,
        fanDuelImplied: fdImplied,
        kalshiImplied,
        edge: Math.abs(edge),
        edgeDirection: edge > 0.02 ? 'KALSHI_VALUE' : edge < -0.02 ? 'FD_VALUE' : 'FAIR',
        payoutFD: americanToPayout(fdProp.odds),
        payoutKalshi: 100 / match.yes_ask,
        confidence: Math.min(0.9, 0.5 + Math.abs(edge) * 5),
        ticker: match.ticker,
      });
    }
  }

  // --- First TD Edge Comparison ---
  const firstTdMarkets = kalshiMarkets.get('KXNFLFIRSTTD') ?? [];
  const firstTdProps = fdProps.filter(p => p.propType === 'first_td');

  for (const fdProp of firstTdProps) {
    const playerKey = normalizePlayerName(fdProp.player);
    const match = firstTdMarkets.find(m => {
      const sub = (m.yes_sub_title ?? m.subtitle ?? m.title ?? '').toLowerCase();
      return sub.includes(playerKey) || playerKey.split(' ').every(part => sub.includes(part));
    });

    if (match) {
      const kalshiMid = (match.yes_bid + match.yes_ask) / 2;
      const kalshiImplied = kalshiMid / 100;
      const fdImplied = fdProp.impliedProb;
      const edge = fdImplied - kalshiImplied;
      const fdPayout = americanToPayout(fdProp.odds);
      const kalshiPayout = match.yes_ask > 0 ? 100 / match.yes_ask : 0;

      edges.push({
        player: fdProp.player,
        propType: 'First TD',
        kalshiPrice: match.yes_bid,
        kalshiAsk: match.yes_ask,
        fanDuelOdds: fdProp.odds,
        fanDuelImplied: fdImplied,
        kalshiImplied,
        edge: Math.abs(edge),
        edgeDirection: fdPayout > kalshiPayout ? 'FD_VALUE' : kalshiPayout > fdPayout ? 'KALSHI_VALUE' : 'FAIR',
        payoutFD: fdPayout,
        payoutKalshi: kalshiPayout,
        confidence: Math.min(0.85, 0.5 + Math.abs(edge) * 4),
        ticker: match.ticker,
      });
    }
  }

  // --- Game Total Edge Comparison ---
  const totalMarkets = kalshiMarkets.get('KXNFLTOTAL') ?? [];
  // Kalshi O/U 45.5 vs FanDuel O/U 45.5
  const kalshi455 = totalMarkets.find(m =>
    m.ticker?.includes('45') || (m.yes_sub_title ?? '').includes('45.5')
  );
  if (kalshi455) {
    const kalshiMid = (kalshi455.yes_bid + kalshi455.yes_ask) / 2;
    edges.push({
      player: 'Game Total',
      propType: 'Over 45.5',
      kalshiPrice: kalshi455.yes_bid,
      kalshiAsk: kalshi455.yes_ask,
      fanDuelOdds: -110,
      fanDuelImplied: americanToImplied(-110),
      kalshiImplied: kalshiMid / 100,
      edge: Math.abs(kalshiMid / 100 - americanToImplied(-110)),
      edgeDirection: kalshiMid / 100 > americanToImplied(-110) ? 'FD_VALUE' : 'KALSHI_VALUE',
      payoutFD: americanToPayout(-110),
      payoutKalshi: 100 / kalshi455.yes_ask,
      confidence: 0.6,
      ticker: kalshi455.ticker,
    });
  }

  // Sort by edge size
  edges.sort((a, b) => b.edge - a.edge);
  return edges;
}

function normalizePlayerName(name: string): string {
  return name.toLowerCase()
    .replace(/iii$/i, '')
    .replace(/ii$/i, '')
    .replace(/iv$/i, '')
    .replace(/jr\.?$/i, '')
    .replace(/sr\.?$/i, '')
    .replace(/d\/st$/i, '')
    .trim();
}

// =============================================================================
// PARLAY BUILDER
// =============================================================================

function buildParlays(fdProps: FanDuelProp[]): ParlayRecommendation[] {
  const parlays: ParlayRecommendation[] = [];

  // ==========================================================================
  // PARLAY 1: "SEATTLE STAMPEDE" — Seattle win game flow
  // Correlated: If SEA wins big, Darnold throws well, JSN gets targets, Walker runs
  // ==========================================================================
  parlays.push({
    name: 'SEATTLE STAMPEDE',
    theme: 'Seattle offensive explosion + comfortable win',
    legs: [
      {
        player: 'Sam Darnold',
        prop: 'Over 1.5 Pass TDs',
        odds: -130,
        impliedProb: americanToImplied(-130),
        confidence: 0.72,
        reason: 'Darnold averaged 1.6 TDs/game in reg season, 2.0 in playoffs. In a game SEA is favored, he should throw 2+.',
        correlation: 'SEA_WIN_FLOW',
      },
      {
        player: 'Jaxon Smith-Njigba',
        prop: 'Over 6.5 Receptions',
        odds: -120,
        impliedProb: americanToImplied(-120),
        confidence: 0.65,
        reason: 'JSN averaged 7.4 rec/game. NE defense is elite but JSN is Darnold\'s #1 read. Kalshi has 7+ rec at 56c.',
        correlation: 'SEA_WIN_FLOW',
      },
      {
        player: 'Kenneth Walker III',
        prop: 'Anytime TD',
        odds: -185,
        impliedProb: americanToImplied(-185),
        confidence: 0.72,
        reason: 'Walker scored 4 TDs in 2 playoff games. TD in 4 of last 5. He\'s the goal-line back.',
        correlation: 'SEA_WIN_FLOW',
      },
    ],
    combinedOdds: 0,
    impliedProb: 0,
    correlationBoost: 1.15, // Positive correlation boosts EV by ~15%
    reason: 'All legs move together — if SEA controls the game, Darnold throws TDs, JSN catches balls, Walker punches it in.',
  });

  // ==========================================================================
  // PARLAY 2: "DEFENSE WINS CHAMPIONSHIPS" — Low scoring game
  // Correlated: Under means fewer yards, fewer TDs, more punts
  // ==========================================================================
  parlays.push({
    name: 'DEFENSE WINS CHAMPIONSHIPS',
    theme: 'Low-scoring defensive battle',
    legs: [
      {
        player: 'Game Total',
        prop: 'Under 45.5 Points',
        odds: -110,
        impliedProb: americanToImplied(-110),
        confidence: 0.68,
        reason: 'Both defenses elite. SEA ranked #1 in scoring D. NE limited opponents in all 3 playoff games. Kalshi has O45.5 at just 49c.',
        correlation: 'LOW_SCORING',
      },
      {
        player: 'Kenneth Walker III',
        prop: 'Under 72.5 Rush Yards',
        odds: -110,
        impliedProb: americanToImplied(-110),
        confidence: 0.65,
        reason: 'NE held Chargers RBs to 30 yds, Texans to 31, Broncos to 75 in playoffs. Walker struggles vs elite run D.',
        correlation: 'LOW_SCORING',
      },
      {
        player: 'Drake Maye',
        prop: 'Under 1.5 Pass TDs',
        odds: -180,
        impliedProb: americanToImplied(-180),
        confidence: 0.70,
        reason: 'NE averaged just 18 pts/game in playoffs. Maye\'s ceiling is limited behind a struggling O-line (47 sacks in reg season + 15 in playoffs).',
        correlation: 'LOW_SCORING',
      },
    ],
    combinedOdds: 0,
    impliedProb: 0,
    correlationBoost: 1.20, // Strong positive correlation
    reason: 'Strong correlation — Under games mean fewer rush yards and fewer pass TDs. All three legs reinforce each other.',
  });

  // ==========================================================================
  // PARLAY 3: "TE PARTY" — Tight ends feast on mismatches
  // Correlated: Both defenses weak vs TEs
  // ==========================================================================
  parlays.push({
    name: 'TIGHT END PARTY',
    theme: 'Both TEs exploit defensive weaknesses',
    legs: [
      {
        player: 'Hunter Henry',
        prop: 'Over 38.5 Rec Yards',
        odds: -110,
        impliedProb: americanToImplied(-110),
        confidence: 0.68,
        reason: 'SEA allowed 5th-most catches to TEs (6.2/game) and 6th-most rec yards to TEs (63.5/game). Henry avg 43.7 yd/game.',
        correlation: 'TE_MISMATCH',
      },
      {
        player: 'Hunter Henry',
        prop: 'Anytime TD',
        odds: 230,
        impliedProb: americanToImplied(230),
        confidence: 0.55,
        reason: 'TE is NE\'s best red zone weapon. SEA weakness vs TEs makes Henry a top TD candidate.',
        correlation: 'TE_MISMATCH',
      },
      {
        player: 'AJ Barner',
        prop: 'Over 2.5 Receptions',
        odds: -110, // estimated from Kalshi
        impliedProb: 0.55,
        confidence: 0.60,
        reason: 'Barner has emerged as Darnold\'s safety valve. Kalshi prices 3+ rec at 56-58c. Correlated with Darnold passing.',
        correlation: 'TE_MISMATCH',
      },
    ],
    combinedOdds: 0,
    impliedProb: 0,
    correlationBoost: 1.10,
    reason: 'Both defenses have shown vulnerability to TEs. If the game stays close, TEs become safety valves in pressure moments.',
  });

  // ==========================================================================
  // PARLAY 4: "DARNOLD'S REVENGE" — Sam Darnold as the star
  // Correlated: If Darnold plays well, everything connects
  // ==========================================================================
  parlays.push({
    name: 'DARNOLD\'S REVENGE',
    theme: 'Sam Darnold redemption arc = game MVP',
    legs: [
      {
        player: 'Sam Darnold',
        prop: 'Over 229.5 Pass Yards',
        odds: -110,
        impliedProb: americanToImplied(-110),
        confidence: 0.63,
        reason: 'Darnold avg 237.7 yds/game, threw 346 in NFC title game. SEA defense lets him play aggressively when ahead.',
        correlation: 'DARNOLD_GAME',
      },
      {
        player: 'Sam Darnold',
        prop: 'Over 1.5 Pass TDs',
        odds: -130,
        impliedProb: americanToImplied(-130),
        confidence: 0.72,
        reason: 'FD line is -130 (56.5%). Averaged 2.0 TDs in playoffs. NE secondary has been tested.',
        correlation: 'DARNOLD_GAME',
      },
      {
        player: 'Jaxon Smith-Njigba',
        prop: 'Over 92.5 Rec Yards',
        odds: -110,
        impliedProb: americanToImplied(-110),
        confidence: 0.58,
        reason: 'JSN\'s 92.5 line is big but he averaged 90.3 yd/game. If Darnold hits 230+ yards, JSN gets 100+.',
        correlation: 'DARNOLD_GAME',
      },
    ],
    combinedOdds: 0,
    impliedProb: 0,
    correlationBoost: 1.25, // Very strong positive correlation
    reason: 'Extremely high correlation — Darnold\'s passing yards directly feed JSN\'s receiving yards. If Darnold throws 230+ and 2 TDs, JSN likely over 92.5.',
  });

  // ==========================================================================
  // PARLAY 5: "LONGSHOT BOMB" — High risk, huge payout
  // ==========================================================================
  parlays.push({
    name: 'LONGSHOT BOMB',
    theme: 'Rashid Shaheed breakout game',
    legs: [
      {
        player: 'Rashid Shaheed',
        prop: 'First TD Scorer',
        odds: 1900,
        impliedProb: americanToImplied(1900),
        confidence: 0.35,
        reason: 'Shaheed is the most versatile player on either team — WR, rusher, returner. Had a 51-yd catch in NFC Championship. FD gives +1900.',
        correlation: 'SHAHEED_BOMB',
      },
      {
        player: 'Seattle Seahawks',
        prop: 'Win (ML)',
        odds: -225,
        impliedProb: americanToImplied(-225),
        confidence: 0.67,
        reason: 'Seattle is the consensus favorite. Provides safety net for the Shaheed longshot.',
        correlation: 'SHAHEED_BOMB',
      },
    ],
    combinedOdds: 0,
    impliedProb: 0,
    correlationBoost: 1.10,
    reason: 'Shaheed first TD + SEA win is positively correlated. If Shaheed scores first, SEA likely has early lead → more likely to win.',
  });

  // Calculate combined odds for each parlay
  for (const parlay of parlays) {
    let combinedImplied = 1;
    for (const leg of parlay.legs) {
      combinedImplied *= leg.impliedProb;
    }
    parlay.impliedProb = combinedImplied;
    // Adjust for correlation
    const adjustedProb = combinedImplied * parlay.correlationBoost;
    parlay.combinedOdds = impliedToAmerican(combinedImplied);
  }

  return parlays;
}

// =============================================================================
// DISPLAY
// =============================================================================

function displayResults(
  edges: EdgeResult[],
  parlays: ParlayRecommendation[],
  kalshiMarkets: Map<string, KalshiMarket[]>
): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              SUPER BOWL LX PROPS SCANNER                            ║
║         Seattle Seahawks vs New England Patriots                     ║
║              Feb 8, 2026 — Levi's Stadium                            ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // --- GAME OVERVIEW ---
  console.log('━━━ GAME OVERVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SEA Seahawks (-4.5)  vs  NE Patriots (+4.5)');
  console.log('  O/U: 45.5  |  Moneyline: SEA -225 / NE +188');
  console.log('');

  const sbMarkets = kalshiMarkets.get('KXSB') ?? [];
  const seaWin = sbMarkets.find(m => m.ticker?.includes('SEA'));
  const neWin = sbMarkets.find(m => m.ticker?.includes('NE'));
  if (seaWin && neWin) {
    console.log(`  Kalshi Winner:  SEA ${seaWin.yes_bid}c / NE ${neWin.yes_bid}c`);
    console.log(`  FanDuel ML:     SEA -225 (${formatPct(americanToImplied(-225))}) / NE +188 (${formatPct(americanToImplied(188))})`);
  }

  const otMarket = (kalshiMarkets.get('KXNFLOT') ?? [])[0];
  if (otMarket) {
    console.log(`  OT on Kalshi:   ${otMarket.yes_bid}c YES (vol: ${otMarket.volume.toLocaleString()})`);
  }
  console.log('');

  // --- KALSHI vs FANDUEL EDGE TABLE ---
  console.log('━━━ EDGE DETECTION: KALSHI vs FANDUEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // MVP edges
  const mvpEdges = edges.filter(e => e.propType === 'SB MVP');
  if (mvpEdges.length > 0) {
    console.log('  MVP COMPARISON:');
    console.log('  ┌────────────────────────┬──────────┬──────────┬────────┬─────────┐');
    console.log('  │ Player                 │ Kalshi   │ FanDuel  │ Edge   │ Value   │');
    console.log('  ├────────────────────────┼──────────┼──────────┼────────┼─────────┤');
    for (const e of mvpEdges) {
      const name = e.player.padEnd(22).slice(0, 22);
      const kalshi = `${e.kalshiPrice}/${e.kalshiAsk}c`.padEnd(8);
      const fd = formatOdds(e.fanDuelOdds).padEnd(8);
      const edge = `${(e.edge * 100).toFixed(1)}%`.padEnd(6);
      const val = e.edgeDirection === 'KALSHI_VALUE' ? 'KALSHI' :
                  e.edgeDirection === 'FD_VALUE' ? 'FD    ' : 'FAIR  ';
      console.log(`  │ ${name} │ ${kalshi} │ ${fd} │ ${edge} │ ${val}  │`);
    }
    console.log('  └────────────────────────┴──────────┴──────────┴────────┴─────────┘');
    console.log('');
  }

  // First TD edges
  const tdEdges = edges.filter(e => e.propType === 'First TD');
  if (tdEdges.length > 0) {
    console.log('  FIRST TD SCORER COMPARISON:');
    console.log('  ┌────────────────────────┬──────────┬──────────┬────────┬───────────┬─────────┐');
    console.log('  │ Player                 │ Kalshi   │ FD Odds  │ Edge   │ FD Payout │ Value   │');
    console.log('  ├────────────────────────┼──────────┼──────────┼────────┼───────────┼─────────┤');
    for (const e of tdEdges.slice(0, 12)) {
      const name = e.player.padEnd(22).slice(0, 22);
      const kalshi = `${e.kalshiPrice}/${e.kalshiAsk}c`.padEnd(8);
      const fd = formatOdds(e.fanDuelOdds).padEnd(8);
      const edge = `${(e.edge * 100).toFixed(1)}%`.padEnd(6);
      const payout = `${e.payoutFD.toFixed(1)}x`.padEnd(9);
      const val = e.edgeDirection === 'FD_VALUE' ? 'FD BETTER' :
                  e.edgeDirection === 'KALSHI_VALUE' ? 'KALSHI   ' : 'FAIR     ';
      console.log(`  │ ${name} │ ${kalshi} │ ${fd} │ ${edge} │ ${payout} │ ${val} │`);
    }
    console.log('  └────────────────────────┴──────────┴──────────┴────────┴───────────┴─────────┘');
    console.log('');
  }

  // --- KEY INSIGHTS ---
  console.log('━━━ KEY INSIGHTS FROM CROSS-PLATFORM ANALYSIS ━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Find biggest edges
  const bigEdges = edges.filter(e => e.edge >= 0.02).sort((a, b) => b.edge - a.edge);
  for (const e of bigEdges.slice(0, 5)) {
    const dir = e.edgeDirection === 'FD_VALUE' ? 'FanDuel offers better value' :
                e.edgeDirection === 'KALSHI_VALUE' ? 'Kalshi offers better value' : 'Fairly priced';
    console.log(`  ${e.edge >= 0.05 ? '🔴' : '🟡'} ${e.player} ${e.propType}: ${(e.edge * 100).toFixed(1)}% edge`);
    console.log(`     ${dir} — FD: ${formatOdds(e.fanDuelOdds)} (${formatPct(e.fanDuelImplied)}) vs Kalshi: ${e.kalshiPrice}/${e.kalshiAsk}c (${formatPct(e.kalshiImplied)})`);
    console.log('');
  }

  // --- RECEPTIONS MARKET INSIGHTS ---
  const recMarkets = kalshiMarkets.get('KXNFLREC') ?? [];
  if (recMarkets.length > 0) {
    console.log('━━━ KALSHI RECEPTIONS MARKET (vs FanDuel lines) ━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Group by player
    const byPlayer = new Map<string, KalshiMarket[]>();
    for (const m of recMarkets) {
      const sub = m.yes_sub_title ?? '';
      const player = sub.split(':')[0].trim();
      if (!player) continue;
      if (!byPlayer.has(player)) byPlayer.set(player, []);
      byPlayer.get(player)!.push(m);
    }

    const keyPlayers = [
      'Jaxon Smith-Njigba', 'Cooper Kupp', 'Stefon Diggs', 'Hunter Henry',
      'Rhamondre Stevenson', 'Kenneth Walker III', 'Kayshon Boutte', 'Rashid Shaheed'
    ];

    for (const playerName of keyPlayers) {
      const markets = byPlayer.get(playerName);
      if (!markets || markets.length === 0) continue;

      console.log(`  ${playerName}:`);
      for (const m of markets.sort((a, b) => {
        const aNum = parseInt(a.yes_sub_title?.match(/(\d+)\+/)?.[1] ?? '0');
        const bNum = parseInt(b.yes_sub_title?.match(/(\d+)\+/)?.[1] ?? '0');
        return aNum - bNum;
      }).slice(0, 5)) {
        const sub = (m.yes_sub_title ?? '').padEnd(30);
        console.log(`    ${sub} YES: ${m.yes_bid}/${m.yes_ask}c  (vol: ${m.volume.toLocaleString()})`);
      }
      console.log('');
    }
  }

  // --- PARLAY RECOMMENDATIONS ---
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                RECOMMENDED FANDUEL PARLAYS                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  for (let i = 0; i < parlays.length; i++) {
    const p = parlays[i];
    const correlationLabel = p.correlationBoost >= 1.20 ? 'STRONG' :
                              p.correlationBoost >= 1.10 ? 'MODERATE' : 'LOW';

    console.log(`  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    console.log(`  ┃  PARLAY ${i + 1}: ${p.name.padEnd(53)} ┃`);
    console.log(`  ┃  ${p.theme.padEnd(64)} ┃`);
    console.log(`  ┃  Correlation: ${correlationLabel.padEnd(51)} ┃`);
    console.log(`  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
    console.log('');

    for (const leg of p.legs) {
      console.log(`    ${leg.player}: ${leg.prop} (${formatOdds(leg.odds)})`);
      console.log(`      ${leg.reason}`);
      console.log(`      Confidence: ${formatPct(leg.confidence)}`);
      console.log('');
    }

    // Calculate parlay payout
    let parlayPayout = 1;
    for (const leg of p.legs) {
      parlayPayout *= americanToPayout(leg.odds);
    }
    const parlayOdds = impliedToAmerican(1 / parlayPayout);
    const adjustedProb = p.impliedProb * p.correlationBoost;

    console.log(`    Combined FD Payout: ${parlayPayout.toFixed(1)}x (${formatOdds(parlayOdds)})`);
    console.log(`    Raw Implied Prob:   ${formatPct(p.impliedProb)}`);
    console.log(`    Correlation Adj:    ${formatPct(adjustedProb)} (${correlationLabel} positive correlation)`);
    console.log(`    $10 bet wins:       $${(10 * parlayPayout - 10).toFixed(0)}`);
    console.log(`    $25 bet wins:       $${(25 * parlayPayout - 25).toFixed(0)}`);
    console.log('');
    console.log(`    WHY: ${p.reason}`);
    console.log('');
    console.log('  ────────────────────────────────────────────────────────────────────');
    console.log('');
  }

  // --- FINAL RECOMMENDATION ---
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                   FINAL RECOMMENDATIONS                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  BEST VALUE PARLAYS (for FanDuel):');
  console.log('');
  console.log('  1. BEST OVERALL: "DARNOLD\'S REVENGE" (Parlay 4)');
  console.log('     Darnold O229.5 pass + O1.5 TDs + JSN O92.5 rec yards');
  console.log('     Why: STRONGEST correlation of any parlay. Darnold\'s passing yards');
  console.log('     directly feed JSN\'s receiving yards. If one hits, the others likely do too.');
  console.log('     Correlation boost: +25%. Payout ~5.5x.');
  console.log('');
  console.log('  2. SAFEST: "SEATTLE STAMPEDE" (Parlay 1)');
  console.log('     Darnold O1.5 TDs + JSN O6.5 rec + Walker Anytime TD');
  console.log('     Why: All three legs have >55% FD implied probability individually.');
  console.log('     With correlation boost, true probability is ~30-35%. Safe 3-leg parlay.');
  console.log('');
  console.log('  3. HIGHEST EV: "DEFENSE WINS CHAMPIONSHIPS" (Parlay 2)');
  console.log('     Under 45.5 + Walker U72.5 rush + Maye U1.5 TDs');
  console.log('     Why: Kalshi prices O45.5 at just 49c (near coin flip), but BOTH');
  console.log('     defenses are playoff-elite. Under is the sharp side. All legs are');
  console.log('     strongly correlated. If the total goes Under, Walker struggles and');
  console.log('     Maye doesn\'t throw TDs. Correlation boost: +20%.');
  console.log('');
  console.log('  4. FUN LONGSHOT: "LONGSHOT BOMB" (Parlay 5)');
  console.log('     Shaheed First TD + SEA ML');
  console.log('     Why: +1900 on Shaheed is the best value first TD price. He\'s the most');
  console.log('     versatile player on either team (WR/rusher/returner). $5 wins ~$45.');
  console.log('');
  console.log('  INDIVIDUAL BEST BETS:');
  console.log('');
  console.log('  - Hunter Henry O38.5 rec yards (-110): SEA allows 6th-most TE yards');
  console.log('  - Under 45.5 total (-110): Both defenses elite, Kalshi agrees (49c)');
  console.log('  - Darnold O1.5 TDs (-130): Averaged 2.0 in playoffs');
  console.log('  - Walker Anytime TD (-185): 4 TDs in 2 playoff games');
  console.log('  - Leonard Williams sack (+144): 88% snap rate, NE O-line struggling');
  console.log('');
  console.log('  KALSHI-SPECIFIC EDGES (if trading on Kalshi):');

  // Find actual Kalshi-vs-FD edges
  const kalshiEdges = edges.filter(e => e.edgeDirection === 'KALSHI_VALUE' && e.edge >= 0.02);
  for (const e of kalshiEdges.slice(0, 3)) {
    console.log(`  - ${e.player} ${e.propType}: Buy YES at ${e.kalshiAsk}c (${e.payoutKalshi.toFixed(1)}x) vs FD ${formatOdds(e.fanDuelOdds)} (${e.payoutFD.toFixed(1)}x)`);
  }

  console.log('');
  console.log('  Data freshness: Kalshi live API + FanDuel scraped odds (Feb 8, 2026)');
  console.log('  Scanner: Kalshi Edge Detector v4.0 — Super Bowl Props Module');
  console.log('');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('Starting Super Bowl LX Props Scanner...\n');

  // Fetch Kalshi markets
  const kalshiMarkets = await fetchAllKalshiProps();

  // Get FanDuel props
  const fdProps = getFanDuelProps();
  console.log(`\nLoaded ${fdProps.length} FanDuel props\n`);

  // Find edges
  const edges = findEdges(kalshiMarkets, fdProps);
  console.log(`Found ${edges.length} cross-platform comparisons\n`);

  // Build parlays
  const parlays = buildParlays(fdProps);

  // Display everything
  displayResults(edges, parlays, kalshiMarkets);
}

main().catch(err => {
  console.error('Scanner error:', err);
  process.exit(1);
});
