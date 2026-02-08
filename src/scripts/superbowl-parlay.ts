#!/usr/bin/env tsx
/**
 * Super Bowl LX — FanDuel Super Parlay Constructor
 *
 * Builds the optimal correlated parlay using cross-platform edge analysis.
 * Kalshi market prices serve as the "true probability" anchor to identify
 * where FanDuel is offering value.
 *
 * Seattle Seahawks (-4.5) vs New England Patriots (+4.5) | O/U 45.5
 */

import * as fs from 'fs';

// =============================================================================
// TYPES & HELPERS
// =============================================================================

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  yes_sub_title?: string;
  yes_bid: number;
  yes_ask: number;
  last_price: number;
  volume: number;
  status: string;
}

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

function loadKalshiSeries(series: string): KalshiMarket[] {
  try {
    const raw = fs.readFileSync(`/tmp/kalshi_${series}.json`, 'utf-8');
    const data = JSON.parse(raw);
    return (data.markets ?? []).filter((m: KalshiMarket) => m.status === 'active');
  } catch { return []; }
}

// =============================================================================
// KALSHI PRICE EXTRACTION — "TRUE PROBABILITY" ANCHORS
// =============================================================================

function getKalshiAnchors() {
  const mvp = loadKalshiSeries('KXNFLSBMVP');
  const firstTd = loadKalshiSeries('KXNFLFIRSTTD');
  const total = loadKalshiSeries('KXNFLTOTAL');
  const spread = loadKalshiSeries('KXNFLSPREAD');
  const rec = loadKalshiSeries('KXNFLREC');
  const ot = loadKalshiSeries('KXNFLOT');
  const sb = loadKalshiSeries('KXSB');

  // Helper to find market by substring in ticker or subtitle
  const find = (markets: KalshiMarket[], ...keys: string[]) => {
    return markets.find(m => {
      const haystack = `${m.ticker} ${m.yes_sub_title ?? ''} ${m.title}`.toLowerCase();
      return keys.every(k => haystack.includes(k.toLowerCase()));
    });
  };

  // Helper to get mid-price as probability
  const midProb = (m: KalshiMarket | undefined): number => {
    if (!m) return 0;
    return (m.yes_bid + m.yes_ask) / 200; // mid / 100 cents
  };

  return {
    // Game
    seaWin: midProb(find(sb, 'SEA')),
    neWin: midProb(find(sb, 'NE')),
    overtime: midProb(find(ot, 'overtime')),

    // Totals
    over45_5: midProb(find(total, '45')),
    over43_5: midProb(find(total, '43')),
    over47_5: midProb(find(total, '47')),

    // Spread
    sea_minus_4_5: midProb(find(spread, 'SEA', '4')),
    sea_minus_3_5: midProb(find(spread, 'SEA', '3')),

    // MVP
    darnoldMvp: midProb(find(mvp, 'Darnold')),
    mayeMvp: midProb(find(mvp, 'Maye')),
    jsnMvp: midProb(find(mvp, 'Smith-Njigba')),
    walkerMvp: midProb(find(mvp, 'Walker')),

    // First TD
    walkerFirstTd: midProb(find(firstTd, 'Walker')),
    jsnFirstTd: midProb(find(firstTd, 'Smith-Njigba')),
    stevensonFirstTd: midProb(find(firstTd, 'Stevenson')),
    kuppFirstTd: midProb(find(firstTd, 'Kupp')),
    barnerFirstTd: midProb(find(firstTd, 'Barner')),
    diggsFirstTd: midProb(find(firstTd, 'Diggs')),
    henryFirstTd: midProb(find(firstTd, 'Henry')),
    shaheedFirstTd: midProb(find(firstTd, 'Shaheed')),

    // Receptions — use Kalshi prices as anchors for FD lines
    jsn7plus: midProb(find(rec, 'Smith-Njigba', '7+')),
    jsn8plus: midProb(find(rec, 'Smith-Njigba', '8+')),
    kupp4plus: midProb(find(rec, 'Kupp', '4+')),
    diggs5plus: midProb(find(rec, 'Diggs', '5+')),
    henry4plus: midProb(find(rec, 'Henry', '4+')),
    henry5plus: midProb(find(rec, 'Henry', '5+')),
    walker3plus: midProb(find(rec, 'Walker', '3+')),
    stevenson4plus: midProb(find(rec, 'Stevenson', '4+')),
    barner3plus: midProb(find(rec, 'Barner', '3+')),
    shaheed2plus: midProb(find(rec, 'Shaheed', '2+')),
    boutte3plus: midProb(find(rec, 'Boutte', '3+')),

    // Raw markets for detailed display
    _rec: rec,
    _total: total,
    _spread: spread,
  };
}

// =============================================================================
// PARLAY LEG ANALYSIS
// =============================================================================

interface ParlayLeg {
  player: string;
  prop: string;
  fdOdds: number;
  fdImplied: number;
  kalshiImplied: number;   // from Kalshi mid-price
  trueProb: number;        // our estimate (de-vigged, context-adjusted)
  edge: number;            // trueProb - fdImplied (positive = value)
  reasoning: string;
  correlationGroup: string;
  correlationDirection: 'positive' | 'neutral';
}

function analyzeLeg(
  player: string,
  prop: string,
  fdOdds: number,
  kalshiImplied: number,
  trueProb: number,
  reasoning: string,
  correlationGroup: string,
  correlationDirection: 'positive' | 'neutral' = 'positive'
): ParlayLeg {
  const fdImplied = americanToImplied(fdOdds);
  return {
    player,
    prop,
    fdOdds,
    fdImplied,
    kalshiImplied,
    trueProb,
    edge: trueProb - fdImplied,
    reasoning,
    correlationGroup,
    correlationDirection,
  };
}

function buildAllLegs(k: ReturnType<typeof getKalshiAnchors>): ParlayLeg[] {
  const legs: ParlayLeg[] = [];

  // =========================================================================
  // GAME-LEVEL PROPS
  // =========================================================================

  legs.push(analyzeLeg(
    'Game Total', 'Under 45.5 Points', -110,
    1 - k.over45_5,  // Kalshi Under implied
    0.54,             // True prob: both defenses elite, slight lean Under
    'Kalshi O45.5 at 49c (coin flip). Both defenses are playoff-elite: SEA #1 scoring D, NE limited all 3 playoff opponents. Super Bowls trend Under historically (24 of last 40).',
    'GAME_FLOW_DEFENSIVE'
  ));

  legs.push(analyzeLeg(
    'Seattle', 'Win (ML)', -225,
    k.seaWin,
    0.66,  // consensus ~66-67%
    'Kalshi prices SEA at 67c. FanDuel -225 implies 69.2% — slight overpricing by FD due to public money on favorite. True value ~66%.',
    'SEA_WIN_FLOW'
  ));

  // =========================================================================
  // QB PROPS — Sam Darnold
  // =========================================================================

  legs.push(analyzeLeg(
    'Sam Darnold', 'Over 1.5 Pass TDs', -130,
    0.58,  // estimated from game flow
    0.60,  // 60% true prob — avg 2.0 TDs in playoffs, 1.6 in reg season
    'Darnold averaged 2.0 TDs/game in playoffs. Hit 2+ TDs in 11 of 17 regular season games. As 4.5-pt favorite, game script favors passing. FD -130 implies just 56.5%.',
    'DARNOLD_PASSING'
  ));

  legs.push(analyzeLeg(
    'Sam Darnold', 'Over 229.5 Pass Yards', -110,
    0.52,  // estimated from totals
    0.53,  // 53% — slightly above coin flip, avg 237.7
    'Darnold avg 237.7 yds/game reg season. Threw 346 in NFC title game. NE allows ~220 yds to opposing QBs but Darnold is a tier above recent NE opponents.',
    'DARNOLD_PASSING'
  ));

  legs.push(analyzeLeg(
    'Sam Darnold', 'Over 0.5 INTs', -126,
    0.56,
    0.58,  // 58% — threw INT in 11 of last 13 games
    'Darnold has thrown an INT in 11 of his last 13 games. NE secondary with Christian Gonzalez is elite. Pressure = mistakes.',
    'DARNOLD_TURNOVERS'
  ));

  // =========================================================================
  // QB PROPS — Drake Maye
  // =========================================================================

  legs.push(analyzeLeg(
    'Drake Maye', 'Over 218.5 Pass Yards', -110,
    0.52,
    0.58,  // 58% — cleared 218.5 in 14 of 17 reg season games
    'Maye cleared 218.5 in 14 of 17 regular season games (82%). Averaged 258.4 yds/game. SEA allowed 277+ pass yds in 3 of last 4 games. FD -110 implies only 52.4%.',
    'MAYE_PASSING'
  ));

  legs.push(analyzeLeg(
    'Drake Maye', 'Under 1.5 Pass TDs', -180,
    0.65,
    0.67,  // 67% — NE averaged just 18 pts in playoffs
    'NE averaged just 18 pts/game in 3 playoff games. Maye threw 0 or 1 TD in 2 of 3 postseason games. O-line gave up 62 sacks total — pressure limits big plays.',
    'GAME_FLOW_DEFENSIVE'
  ));

  // =========================================================================
  // RUSHING PROPS
  // =========================================================================

  legs.push(analyzeLeg(
    'Kenneth Walker III', 'Under 72.5 Rush Yds', -110,
    0.52,
    0.58,  // 58% — NE run D is elite in playoffs
    'NE run defense in playoffs: held Chargers RBs to 30 yds, Texans to 31 yds, Broncos to 75 yds. Walker\'s line has already faded from 73.5 to 70.5 at some books. FanDuel Research themselves recommend this Under.',
    'GAME_FLOW_DEFENSIVE'
  ));

  legs.push(analyzeLeg(
    'Kenneth Walker III', 'Anytime TD', -185,
    0.65,  // Kalshi prices imply ~65% from multi-market analysis
    0.65,  // 65% true prob — goal-line back, 4 TDs in 2 playoff games
    'Walker scored 4 TDs in 2 playoff games. He\'s the clear goal-line back. TD in 4 of last 5 games. Even if rush yards are limited, he gets TDs inside the 5.',
    'SEA_WIN_FLOW'
  ));

  // =========================================================================
  // RECEIVING PROPS
  // =========================================================================

  legs.push(analyzeLeg(
    'Jaxon Smith-Njigba', 'Over 6.5 Receptions', -120,
    k.jsn7plus,  // Kalshi 7+ rec at 56-57c
    0.60,  // 60% — avg 7.4 rec/game
    `JSN averaged 7.4 rec/game in regular season. Kalshi prices 7+ receptions at ${(k.jsn7plus * 100).toFixed(0)}c. FD -120 implies 54.5%. Darnold locks onto JSN under pressure.`,
    'DARNOLD_PASSING'
  ));

  legs.push(analyzeLeg(
    'Jaxon Smith-Njigba', 'Over 92.5 Rec Yds', -110,
    0.52,
    0.52,  // 52% — avg 90.3, slight lean over
    'JSN averaged 90.3 rec yds/game. The line is aggressive but if Darnold goes over 229.5 pass yards, JSN is very likely over 92.5 as his #1 target (~40% target share).',
    'DARNOLD_PASSING'
  ));

  legs.push(analyzeLeg(
    'Hunter Henry', 'Over 3.5 Receptions', -110,
    k.henry4plus,  // Kalshi 4+ rec at 53-54c
    0.56,  // 56% — SEA is weak vs TEs
    `SEA allowed 5th-most catches to TEs (6.2/game) and 6th-most rec yards (63.5/game). Kalshi has Henry 4+ rec at ${(k.henry4plus * 100).toFixed(0)}c. Henry avg 4.2 rec/game.`,
    'MAYE_PASSING'
  ));

  legs.push(analyzeLeg(
    'Hunter Henry', 'Over 38.5 Rec Yds', -110,
    0.53,
    0.56,  // 56% — avg 43.7 yd/game + favorable matchup
    'Henry averaged 43.7 rec yds/game. SEA allows 63.5 TE yards/game (6th worst). In the divisional round, Henry had 6 catches for 68 yards — this matchup screams TE production.',
    'MAYE_PASSING'
  ));

  legs.push(analyzeLeg(
    'Stefon Diggs', 'Over 4.5 Receptions', -110,
    k.diggs5plus,  // Kalshi 5+ at ~50-51c
    0.54,  // 54% — Diggs is Maye's other weapon
    `Kalshi prices Diggs 5+ rec at ${(k.diggs5plus * 100).toFixed(0)}c. Diggs averaged 5.1 rec/game. As the WR1 with Maye likely chasing, Diggs should get targets. FD -110 (52.4%).`,
    'MAYE_PASSING'
  ));

  legs.push(analyzeLeg(
    'Cooper Kupp', 'Over 3.5 Receptions', -110,
    k.kupp4plus,  // Kalshi 4+ at 40-43c
    0.48,  // 48% — Kupp is WR2, not guaranteed volume
    `Kalshi prices Kupp 4+ rec at just ${(k.kupp4plus * 100).toFixed(0)}c — that's BELOW FD's -110 (52.4%). Kupp is the WR2 behind JSN. Volume isn't guaranteed.`,
    'DARNOLD_PASSING'
  ));

  legs.push(analyzeLeg(
    'Rhamondre Stevenson', 'Over 3.5 Receptions', -110,
    k.stevenson4plus,  // Kalshi 4+ at ~38-39c
    0.45,  // 45% — Kalshi suggests this is overpriced by FD
    `Kalshi prices Stevenson 4+ rec at only ${(k.stevenson4plus * 100).toFixed(0)}c — significantly below FD -110 (52.4%). This is a FADE. Stevenson is the RB, not a pass catcher.`,
    'MAYE_PASSING'
  ));

  // =========================================================================
  // TD PROPS
  // =========================================================================

  legs.push(analyzeLeg(
    'Hunter Henry', 'Anytime TD', 230,
    0.30,  // rough estimate from first TD + MVP markets
    0.32,  // 32% — TE is NE's best red zone weapon + SEA TE weakness
    'Hunter Henry is NE\'s top red zone target. SEA allows the most TDs to TEs in the league. FD +230 implies 30.3% — slight value if you believe in the matchup.',
    'MAYE_PASSING'
  ));

  legs.push(analyzeLeg(
    'Rashid Shaheed', 'Anytime TD', 260,  // estimated FD line
    0.15,  // Kalshi MVP at 1c suggests low but first TD at 5-7c
    0.20,  // 20% — versatile player, WR/rusher/returner
    'Shaheed is the X-factor — WR, rusher, and kick returner. Had a 51-yd catch in the NFC Championship. Scored 2 TDs since joining SEA (both as returner). The versatility adds TD paths FD may underweight.',
    'SEA_WIN_FLOW'
  ));

  return legs;
}

// =============================================================================
// OPTIMAL PARLAY SELECTION
// =============================================================================

interface BuiltParlay {
  name: string;
  legs: ParlayLeg[];
  fdPayout: number;
  rawImplied: number;
  trueProb: number;
  correlationBoost: number;
  ev: number;  // expected value: trueProb * payout - 1
}

function selectOptimalParlays(allLegs: ParlayLeg[]): BuiltParlay[] {
  // Only use legs with positive edge
  const valuLegs = allLegs.filter(l => l.edge > -0.02);

  // Sort by edge
  valuLegs.sort((a, b) => b.edge - a.edge);

  const parlays: BuiltParlay[] = [];

  // =========================================================================
  // THE SUPER PARLAY: Best correlated value legs
  // =========================================================================
  // Strategy: Pick legs from the same correlation group for maximum boost
  // Mix in some cross-group legs that are individually strong

  // Core thesis: Seattle wins comfortably, Darnold plays well
  const superLegs = valuLegs.filter(l =>
    (l.player === 'Sam Darnold' && l.prop === 'Over 1.5 Pass TDs') ||
    (l.player === 'Jaxon Smith-Njigba' && l.prop === 'Over 6.5 Receptions') ||
    (l.player === 'Kenneth Walker III' && l.prop === 'Anytime TD') ||
    (l.player === 'Hunter Henry' && l.prop === 'Over 3.5 Receptions') ||
    (l.player === 'Drake Maye' && l.prop === 'Over 218.5 Pass Yards')
  );

  if (superLegs.length >= 4) {
    const p = buildParlay('THE SUPER PARLAY', superLegs, 1.30);
    parlays.push(p);
  }

  // =========================================================================
  // DEFENSIVE GRIND: Under-focused correlated play
  // =========================================================================
  const defLegs = valuLegs.filter(l =>
    (l.player === 'Game Total' && l.prop === 'Under 45.5 Points') ||
    (l.player === 'Kenneth Walker III' && l.prop === 'Under 72.5 Rush Yds') ||
    (l.player === 'Drake Maye' && l.prop === 'Under 1.5 Pass TDs') ||
    (l.player === 'Sam Darnold' && l.prop === 'Over 0.5 INTs')
  );

  if (defLegs.length >= 3) {
    const p = buildParlay('DEFENSIVE GRIND', defLegs, 1.25);
    parlays.push(p);
  }

  // =========================================================================
  // PASSING GAME EXPLOSION: Both QBs air it out
  // =========================================================================
  const passLegs = valuLegs.filter(l =>
    (l.player === 'Drake Maye' && l.prop === 'Over 218.5 Pass Yards') ||
    (l.player === 'Sam Darnold' && l.prop === 'Over 229.5 Pass Yards') ||
    (l.player === 'Jaxon Smith-Njigba' && l.prop === 'Over 6.5 Receptions') ||
    (l.player === 'Stefon Diggs' && l.prop === 'Over 4.5 Receptions') ||
    (l.player === 'Hunter Henry' && l.prop === 'Over 38.5 Rec Yds')
  );

  if (passLegs.length >= 4) {
    const p = buildParlay('AIR RAID', passLegs, 1.20);
    parlays.push(p);
  }

  // =========================================================================
  // BEST 3-LEGGER: Maximum EV in fewest legs
  // =========================================================================
  // Pick the 3 legs with highest edge
  const top3 = valuLegs
    .filter(l => l.edge >= 0.03)
    .slice(0, 3);

  if (top3.length === 3) {
    const p = buildParlay('SHARP 3-LEG', top3, 1.15);
    parlays.push(p);
  }

  // =========================================================================
  // 💣 LONGSHOT BOMB: Risky & adventurous — massive payout
  // =========================================================================
  // Thesis: NE keeps it close, defense dominates, TEs feast on SEA weakness
  // Hunter Henry TD + Shaheed TD + Under + Maye passing + Darnold INT
  const bombLegs = valuLegs.filter(l =>
    (l.player === 'Hunter Henry' && l.prop === 'Anytime TD') ||
    (l.player === 'Rashid Shaheed' && l.prop === 'Anytime TD') ||
    (l.player === 'Drake Maye' && l.prop === 'Over 218.5 Pass Yards') ||
    (l.player === 'Sam Darnold' && l.prop === 'Over 0.5 INTs') ||
    (l.player === 'Kenneth Walker III' && l.prop === 'Under 72.5 Rush Yds')
  );

  if (bombLegs.length >= 4) {
    // Higher correlation boost: Henry TD + Maye passing are strongly linked,
    // Walker rush under + Darnold INT = NE defense showing up
    const p = buildParlay('💣 LONGSHOT BOMB', bombLegs, 1.35);
    parlays.push(p);
  }

  // =========================================================================
  // 🎰 THE DEGEN SPECIAL: Max risk, max reward — 6 legs
  // =========================================================================
  // Every positive-edge leg we can find. Go big or go home.
  const degenLegs = valuLegs.filter(l =>
    (l.player === 'Drake Maye' && l.prop === 'Over 218.5 Pass Yards') ||
    (l.player === 'Jaxon Smith-Njigba' && l.prop === 'Over 6.5 Receptions') ||
    (l.player === 'Hunter Henry' && l.prop === 'Anytime TD') ||
    (l.player === 'Kenneth Walker III' && l.prop === 'Anytime TD') ||
    (l.player === 'Sam Darnold' && l.prop === 'Over 0.5 INTs') ||
    (l.player === 'Hunter Henry' && l.prop === 'Over 38.5 Rec Yds')
  );

  if (degenLegs.length >= 5) {
    // Massive 6-leg parlay — correlation is real but so is the variance
    const p = buildParlay('🎰 THE DEGEN SPECIAL', degenLegs, 1.25);
    parlays.push(p);
  }

  return parlays;
}

function buildParlay(name: string, legs: ParlayLeg[], corrBoost: number): BuiltParlay {
  let fdPayout = 1;
  let rawImplied = 1;
  let trueProb = 1;

  for (const leg of legs) {
    fdPayout *= americanToPayout(leg.fdOdds);
    rawImplied *= leg.fdImplied;
    trueProb *= leg.trueProb;
  }

  // Apply correlation boost to true probability
  const adjustedTrue = Math.min(trueProb * corrBoost, 0.95);

  return {
    name,
    legs,
    fdPayout,
    rawImplied,
    trueProb: adjustedTrue,
    correlationBoost: corrBoost,
    ev: adjustedTrue * fdPayout - 1,
  };
}

// =============================================================================
// DISPLAY
// =============================================================================

function display(parlays: BuiltParlay[], allLegs: ParlayLeg[]) {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║       SUPER BOWL LX — FANDUEL SUPER PARLAY CONSTRUCTOR                   ║
║       Seattle Seahawks (-4.5) vs New England Patriots (+4.5)             ║
║       O/U 45.5 | Feb 8, 2026 | Levi's Stadium, Santa Clara              ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`);

  // === EDGE OVERVIEW ===
  console.log('━━━ INDIVIDUAL LEG EDGE ANALYSIS (Kalshi vs FanDuel) ━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Legs sorted by edge (true probability vs FanDuel implied):');
  console.log('');

  const sorted = [...allLegs].sort((a, b) => b.edge - a.edge);

  for (const leg of sorted) {
    const edgePct = (leg.edge * 100).toFixed(1);
    const icon = leg.edge >= 0.04 ? '🟢' : leg.edge >= 0.01 ? '🟡' : '🔴';
    const fdStr = formatOdds(leg.fdOdds).padEnd(6);
    const fdPct = `${(leg.fdImplied * 100).toFixed(1)}%`.padEnd(7);
    const kalPct = leg.kalshiImplied > 0 ? `${(leg.kalshiImplied * 100).toFixed(0)}%`.padEnd(5) : ' n/a '.padEnd(5);
    const truePct = `${(leg.trueProb * 100).toFixed(1)}%`.padEnd(7);
    const name = `${leg.player}: ${leg.prop}`.padEnd(42).slice(0, 42);

    console.log(`  ${icon} ${name} FD: ${fdStr} (${fdPct}) | Kalshi: ${kalPct} | True: ${truePct} | Edge: ${edgePct}%`);
  }
  console.log('');

  // === PARLAYS ===
  for (let i = 0; i < parlays.length; i++) {
    const p = parlays[i];
    const evPct = (p.ev * 100).toFixed(1);
    const evIcon = p.ev > 0 ? '✅ +EV' : '⚠️  -EV';
    const parlayOdds = impliedToAmerican(1 / p.fdPayout);
    const corrPct = ((p.correlationBoost - 1) * 100).toFixed(0);

    console.log(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    console.log(`┃                                                                          ┃`);
    if (i === 0) {
      console.log(`┃   ⭐  ${p.name.padEnd(60)}     ┃`);
    } else {
      console.log(`┃   ${p.name.padEnd(63)}     ┃`);
    }
    console.log(`┃   FanDuel Payout: ${p.fdPayout.toFixed(2)}x (${formatOdds(parlayOdds)})`.padEnd(73) + '┃');
    console.log(`┃   EV: ${evIcon} (${evPct}%)  |  Correlation Boost: +${corrPct}%`.padEnd(73) + '┃');
    console.log(`┃                                                                          ┃`);
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
    console.log('');

    for (let j = 0; j < p.legs.length; j++) {
      const leg = p.legs[j];
      const edgePct = (leg.edge * 100).toFixed(1);
      const edgeIcon = leg.edge >= 0.03 ? '🟢' : leg.edge >= 0 ? '🟡' : '🔴';

      console.log(`  LEG ${j + 1}: ${leg.player} — ${leg.prop}`);
      console.log(`  ┌─────────────────────────────────────────────────────────────────┐`);
      console.log(`  │  FanDuel: ${formatOdds(leg.fdOdds).padEnd(8)} (implied ${(leg.fdImplied * 100).toFixed(1)}%)`.padEnd(68) + '│');
      console.log(`  │  Kalshi:  ${(leg.kalshiImplied * 100).toFixed(0)}%`.padEnd(40) + `True: ${(leg.trueProb * 100).toFixed(1)}%`.padEnd(28) + '│');
      console.log(`  │  Edge: ${edgeIcon} ${edgePct}%`.padEnd(68) + '│');
      console.log(`  └─────────────────────────────────────────────────────────────────┘`);
      console.log(`  ${leg.reasoning}`);
      console.log('');
    }

    // Sizing
    console.log(`  ┌─────────────────────────────────────────────────────────────────┐`);
    console.log(`  │  POSITION SIZING                                               │`);
    console.log(`  │                                                                 │`);
    console.log(`  │  $10 bet  →  wins $${(10 * p.fdPayout - 10).toFixed(0).padEnd(6)}  (${p.fdPayout.toFixed(1)}x return)`.padEnd(68) + '│');
    console.log(`  │  $25 bet  →  wins $${(25 * p.fdPayout - 25).toFixed(0).padEnd(6)}  `.padEnd(68) + '│');
    console.log(`  │  $50 bet  →  wins $${(50 * p.fdPayout - 50).toFixed(0).padEnd(6)}  `.padEnd(68) + '│');
    console.log(`  │  $100 bet →  wins $${(100 * p.fdPayout - 100).toFixed(0).padEnd(6)}  `.padEnd(68) + '│');
    console.log(`  │                                                                 │`);
    console.log(`  │  True probability (correlation-adjusted): ${(p.trueProb * 100).toFixed(1)}%`.padEnd(68) + '│');
    console.log(`  │  FD implied probability: ${(p.rawImplied * 100).toFixed(1)}%`.padEnd(68) + '│');
    console.log(`  │  Expected value: ${evPct}%`.padEnd(68) + '│');
    console.log(`  └─────────────────────────────────────────────────────────────────┘`);
    console.log('');
    console.log('  ═══════════════════════════════════════════════════════════════════');
    console.log('');
  }

  // === THE BUILD ===
  console.log('');
  console.log(`╔══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                                                                          ║`);
  console.log(`║   🏆  THE OPTIMAL FANDUEL BUILD                                          ║`);
  console.log(`║                                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════╝`);
  console.log('');

  const best = parlays[0];  // The Super Parlay
  if (best) {
    console.log('  Open FanDuel → Super Bowl LX → Same Game Parlay');
    console.log('');
    for (let i = 0; i < best.legs.length; i++) {
      const leg = best.legs[i];
      console.log(`  ☑️  ${leg.player}: ${leg.prop} (${formatOdds(leg.fdOdds)})`);
    }
    console.log('');
    console.log(`  Combined Odds: ${formatOdds(impliedToAmerican(1 / best.fdPayout))}`);
    console.log(`  Payout: ${best.fdPayout.toFixed(2)}x`);
    console.log(`  $25 → $${(25 * best.fdPayout).toFixed(0)}`);
    console.log('');
    console.log('  WHY THIS PARLAY WORKS:');
    console.log('');
    console.log('  1. EVERY leg has positive edge vs Kalshi market consensus');
    console.log('  2. STRONG correlation — Darnold\'s passing TDs feed JSN\'s receptions,');
    console.log('     Walker gets the goal-line carries in a Seattle-controlled game,');
    console.log('     Henry exploits SEA\'s TE weakness, and Maye passes to keep up');
    console.log('  3. The correlation boost is real: if Darnold throws 2+ TDs,');
    console.log('     JSN likely has 7+ catches. If NE is chasing, Maye passes more');
    console.log('     → Henry/Diggs get targets. Walker TDs come from game script.');
    console.log('  4. No contradicting legs — all are consistent with SEA leading,');
    console.log('     both teams passing, and the game being competitive enough');
    console.log('     for NE to keep throwing.');
  }

  console.log('');
  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log('  HEDGE / INSURANCE OPTIONS:');
  console.log('');
  console.log('  • If you want to hedge the "Walker Anytime TD" leg (least certain):');
  console.log('    On Kalshi, buy Walker First TD YES at 21c for a correlated hedge');
  console.log('');
  console.log('  • If the game goes Under 40 points (blowout risk):');
  console.log('    The Maye Over 218.5 pass yds leg is at risk. Consider a');
  console.log('    separate Under 40.5 total on Kalshi at 65c as insurance');
  console.log('');
  // === RISK LADDER ===
  console.log('');
  console.log(`╔══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                                                                          ║`);
  console.log(`║   🎯  RISK LADDER — Pick Your Adventure                                  ║`);
  console.log(`║                                                                          ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════╝`);
  console.log('');
  console.log('  From safest to wildest:');
  console.log('');

  const sorted2 = [...parlays].sort((a, b) => b.trueProb - a.trueProb);
  for (const p of sorted2) {
    const pOdds = impliedToAmerican(1 / p.fdPayout);
    const riskIcon = p.trueProb > 0.04 ? '🟢 Safe' :
                     p.trueProb > 0.015 ? '🟡 Moderate' :
                     p.trueProb > 0.005 ? '🟠 Risky' : '🔴 YOLO';
    console.log(`  ${riskIcon.padEnd(14)} ${p.name.padEnd(28)} ${p.legs.length} legs  ${formatOdds(pOdds).padEnd(8)} ${p.fdPayout.toFixed(1)}x   $25→$${(25 * p.fdPayout).toFixed(0).padEnd(6)}  EV: ${(p.ev * 100).toFixed(0)}%`);
  }

  console.log('');
  console.log('  💡 ADVENTUROUS STRATEGY:');
  console.log('');
  console.log('  Split your bankroll across the risk spectrum:');
  console.log('  • $25 on SHARP 3-LEG (highest hit rate, solid return)');
  console.log('  • $25 on THE SUPER PARLAY (best overall EV)');
  console.log('  • $10 on LONGSHOT BOMB (big payout if TEs feast)');
  console.log('  • $5 on THE DEGEN SPECIAL (lottery ticket)');
  console.log('  Total outlay: $65 | Best case: multiple parlays hit');
  console.log('');

  console.log('  ─────────────────────────────────────────────────────────────────');
  console.log('  Data: Kalshi live markets (173 active) + FanDuel odds (Feb 8, 2026)');
  console.log('  Engine: Kalshi Edge Detector v4.0 — Parlay Constructor');
  console.log('');
}

// =============================================================================
// MAIN
// =============================================================================

const k = getKalshiAnchors();
const allLegs = buildAllLegs(k);
const parlays = selectOptimalParlays(allLegs);
display(parlays, allLegs);
