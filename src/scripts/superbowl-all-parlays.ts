#!/usr/bin/env tsx
/**
 * Super Bowl LX — THE FULL PARLAY MENU
 *
 * 8 creative, correlated parlays built around the user's thesis:
 *   "Darnold for 2 TDs, 1 to JSN, lots of yards against Pats D"
 *
 * Every parlay is built with correlation logic — legs that move together
 * are worth MORE in a parlay than independent legs.
 *
 * Kalshi prices are used as the "true probability" anchor to find where
 * FanDuel is offering value.
 *
 * SEA Seahawks (-4.5) vs NE Patriots (+4.5) | O/U 45.5
 * Feb 8, 2026 | Levi's Stadium, Santa Clara
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
// KALSHI ANCHOR DATA
// =============================================================================

function getKalshiAnchors() {
  const mvp = loadKalshiSeries('KXNFLSBMVP');
  const firstTd = loadKalshiSeries('KXNFLFIRSTTD');
  const total = loadKalshiSeries('KXNFLTOTAL');
  const spread = loadKalshiSeries('KXNFLSPREAD');
  const rec = loadKalshiSeries('KXNFLREC');
  const ot = loadKalshiSeries('KXNFLOT');

  const find = (markets: KalshiMarket[], ...keys: string[]) => {
    return markets.find(m => {
      const haystack = `${m.ticker} ${m.yes_sub_title ?? ''} ${m.title}`.toLowerCase();
      return keys.every(k => haystack.includes(k.toLowerCase()));
    });
  };

  const midProb = (m: KalshiMarket | undefined): number => {
    if (!m) return 0;
    return (m.yes_bid + m.yes_ask) / 200;
  };

  return {
    // MVP (huge signal)
    darnoldMvp: midProb(find(mvp, 'Darnold')),       // 45.5%
    mayeMvp: midProb(find(mvp, 'Maye')),               // 26.5%
    jsnMvp: midProb(find(mvp, 'Smith-Njigba')),        // 16.5%
    walkerMvp: midProb(find(mvp, 'Walker')),            // 8.5%

    // First TD
    walkerFirstTd: midProb(find(firstTd, 'Walker')),
    jsnFirstTd: midProb(find(firstTd, 'Smith-Njigba')),
    shaheedFirstTd: midProb(find(firstTd, 'Shaheed')),
    kuppFirstTd: midProb(find(firstTd, 'Kupp')),
    barnerFirstTd: midProb(find(firstTd, 'Barner')),
    diggsFirstTd: midProb(find(firstTd, 'Diggs')),
    henryFirstTd: midProb(find(firstTd, 'Henry')),
    stevensonFirstTd: midProb(find(firstTd, 'Stevenson')),
    darnoldFirstTd: midProb(find(firstTd, 'Darnold')),

    // Totals
    over45_5: midProb(find(total, '45.5')),
    over43_5: midProb(find(total, '43.5')),
    over47_5: midProb(find(total, '47.5')),
    over49_5: midProb(find(total, '49.5')),

    // Spread
    sea_minus_4_5: midProb(find(spread, 'Seattle', '4.5')),
    sea_minus_6_5: midProb(find(spread, 'Seattle', '6.5')),

    // Overtime
    overtime: midProb(find(ot, 'overtime')),

    // Receptions
    jsn7plus: midProb(find(rec, 'Smith-Njigba', '7+')),
    jsn8plus: midProb(find(rec, 'Smith-Njigba', '8+')),
    jsn9plus: midProb(find(rec, 'Smith-Njigba', '9+')),
    henry4plus: midProb(find(rec, 'Henry', '4+')),
    henry5plus: midProb(find(rec, 'Henry', '5+')),
    henry6plus: midProb(find(rec, 'Henry', '6+')),
    diggs5plus: midProb(find(rec, 'Diggs', '5+')),
    diggs6plus: midProb(find(rec, 'Diggs', '6+')),
    kupp4plus: midProb(find(rec, 'Kupp', '4+')),
    walker3plus: midProb(find(rec, 'Walker', '3+')),
    barner3plus: midProb(find(rec, 'Barner', '3+')),
    stevenson4plus: midProb(find(rec, 'Stevenson', '4+')),
  };
}

// =============================================================================
// LEG TYPES
// =============================================================================

interface Leg {
  player: string;
  prop: string;
  fdOdds: number;
  trueProb: number;
  kalshiAnchor: string;  // human-readable Kalshi reference
  reasoning: string;
  tags: string[];         // for correlation grouping
}

function leg(
  player: string, prop: string, fdOdds: number,
  trueProb: number, kalshiAnchor: string, reasoning: string,
  tags: string[]
): Leg {
  return { player, prop, fdOdds, trueProb, kalshiAnchor, reasoning, tags };
}

// =============================================================================
// BUILD THE FULL LEG UNIVERSE
// =============================================================================

function buildAllLegs(k: ReturnType<typeof getKalshiAnchors>): Leg[] {
  return [
    // ── DARNOLD PASSING ─────────────────────────────────────────────
    leg('Sam Darnold', 'Over 231.5 Pass Yards', -110, 0.55,
      'Darnold MVP at 46c = Kalshi thinks he plays great',
      'Darnold avg 238.1 yds/game. Threw 346 in NFC CG. NE allows ~220 but Darnold is a tier above NE\'s recent opponents. Line moved up from 229.5 to 231.5 — still value.',
      ['DARNOLD_PASSING', 'PASSING_VOLUME', 'SEA_OFFENSE']),

    leg('Sam Darnold', 'Over 1.5 Pass TDs', -119, 0.60,
      'Darnold MVP at 46c implies 2+ TDs likely',
      'Darnold threw 2+ TDs in 11/17 reg season games and 2.0 avg in playoffs. As 4.5-pt favorite, game script = passing. FD -119 implies 54.3% — we see 60%.',
      ['DARNOLD_PASSING', 'DARNOLD_TDS', 'SEA_OFFENSE']),

    leg('Sam Darnold', 'Over 2.5 Pass TDs', 269, 0.28,
      'MVP at 46c + JSN MVP at 17c = multi-TD game',
      'Darnold threw 3 TDs in NFC CG and hit 3+ three times in reg season. If SEA leads and NE is chasing, Darnold keeps passing. +269 implies 27.1% — we see 28%.',
      ['DARNOLD_PASSING', 'DARNOLD_TDS', 'BOOM_LEG']),

    leg('Sam Darnold', 'Over 0.5 INTs', -126, 0.58,
      'Darnold threw INT in 11/13 games',
      'INT in 11 of last 13 games. NE secondary with Christian Gonzalez is elite. Big game pressure + aggressive throws = turnover potential.',
      ['DARNOLD_TURNOVERS', 'NE_DEFENSE']),

    // ── MAYE PASSING ────────────────────────────────────────────────
    leg('Drake Maye', 'Over 221.5 Pass Yards', -110, 0.57,
      'Maye MVP at 27c = Kalshi expects him to ball',
      'Cleared 218.5 in 14/17 reg season games (82%). Avg 258.4. SEA allowed 277+ pass yds in 3/4 recent games. Line at 221.5 is FREE. If NE is chasing, Maye has to throw.',
      ['MAYE_PASSING', 'PASSING_VOLUME', 'NE_OFFENSE']),

    leg('Drake Maye', 'Over 1.5 Pass TDs', 134, 0.40,
      'Maye MVP at 27c, O1.5 TDs +134',
      'Maye threw 31 TDs in reg season. If NE keeps it close or chases, he needs 2+ TDs. SEA pass D gives up big plays. +134 implies 42.7% — we see 40%, slight fade.',
      ['MAYE_PASSING', 'MAYE_TDS', 'NE_OFFENSE']),

    leg('Drake Maye', 'Under 1.5 Pass TDs', -180, 0.67,
      'NE averaged 18 pts in playoffs',
      'NE scored just 18 pts/game in 3 playoff games. SEA #1 scoring defense. O-line gave up 62 sacks. Pressure limits scoring. -180 implies 64.3% — we see 67%.',
      ['NE_STRUGGLES', 'SEA_DEFENSE', 'GAME_FLOW_DEFENSIVE']),

    leg('Drake Maye', 'Anytime TD (Rushing)', 280, 0.25,
      'Maye had 4 rush TDs, 450 rush yds in reg season',
      'Maye is a genuine dual threat — 4 rush TDs in the regular season. Inside the 10, he can scramble or designed run. SEA has to respect the pass, leaving lanes. +280 implies 26.3%.',
      ['MAYE_RUSHING', 'NE_OFFENSE', 'BOOM_LEG']),

    leg('Drake Maye', 'To Throw INT', -140, 0.60,
      'Pressure + big game = mistakes',
      'SEA defense is elite at generating pressure. Maye threw 15 INTs in reg season. Under pressure he forces throws. -140 implies 58.3% — we see 60%.',
      ['MAYE_TURNOVERS', 'SEA_DEFENSE']),

    // ── JSN ─────────────────────────────────────────────────────────
    leg('Jaxon Smith-Njigba', 'Anytime TD', -110, 0.58,
      `JSN MVP at ${(k.jsnMvp * 100).toFixed(0)}c, First TD at ${(k.jsnFirstTd * 100).toFixed(0)}c`,
      'JSN scored 10 TDs in reg season (36% target share), TD in both playoff games. Kalshi prices him 17c for MVP — that requires TDs. -110 implies 52.4% — we see 58%.',
      ['JSN_PRODUCTION', 'DARNOLD_TDS', 'SEA_OFFENSE']),

    leg('Jaxon Smith-Njigba', 'Over 6.5 Receptions', -120, 0.60,
      `Kalshi 7+ rec at ${(k.jsn7plus * 100).toFixed(0)}c`,
      `JSN avg 7.4 rec/game. Kalshi prices 7+ receptions at ${(k.jsn7plus * 100).toFixed(0)}c. 10 catches for 153 yds in NFC CG. He IS this offense. -120 implies 54.5%.`,
      ['JSN_PRODUCTION', 'DARNOLD_PASSING', 'SEA_OFFENSE']),

    leg('Jaxon Smith-Njigba', 'Over 93.5 Rec Yards', -110, 0.52,
      'JSN avg 90.3 yds but 153 in NFC CG',
      'Line is aggressive at 93.5 but JSN had 10 games with 93+ yds. If Darnold throws 232+, JSN gets 40% of air yards. Correlated with Darnold passing volume.',
      ['JSN_PRODUCTION', 'DARNOLD_PASSING', 'SEA_OFFENSE']),

    leg('Jaxon Smith-Njigba', 'First TD Scorer', 500, 0.17,
      `Kalshi JSN First TD at ${(k.jsnFirstTd * 100).toFixed(0)}c`,
      `Kalshi prices JSN first TD at ${(k.jsnFirstTd * 100).toFixed(0)}c. FD +500 implies 16.7%. JSN scored SEA's first offensive TD of the entire postseason. He's Darnold's #1 read on scripted plays.`,
      ['JSN_PRODUCTION', 'FIRST_TD', 'BOOM_LEG']),

    // ── WALKER ──────────────────────────────────────────────────────
    leg('Kenneth Walker III', 'Anytime TD', -190, 0.65,
      `Walker First TD at ${(k.walkerFirstTd * 100).toFixed(0)}c + MVP at ${(k.walkerMvp * 100).toFixed(0)}c`,
      'Walker scored 4 TDs in 2 playoff games. Sole backfield option (Charbonnet on IR). Goal-line back. Even if rush yards limited, he gets the carries inside the 5.',
      ['WALKER_TD', 'SEA_OFFENSE', 'SEA_GAMESCRIPT']),

    leg('Kenneth Walker III', 'Under 70.5 Rush Yards', -110, 0.58,
      'NE held playoff RBs to 30-75 yds',
      'NE run D in playoffs: 30 yds (Chargers), 31 yds (Texans), 75 yds (Broncos). Line already faded from 73.5 to 70.5. 83% of handle on the Under at BetMGM. FanDuel Research recommends this Under.',
      ['WALKER_RUSHING', 'NE_DEFENSE', 'GAME_FLOW_DEFENSIVE']),

    leg('Kenneth Walker III', 'First TD Scorer', 350, 0.21,
      `Kalshi Walker First TD at ${(k.walkerFirstTd * 100).toFixed(0)}c`,
      `Kalshi prices Walker First TD at ${(k.walkerFirstTd * 100).toFixed(0)}c. FD +350 implies 22.2%. If SEA scripts a run-heavy opening drive, Walker punches it in. He had the first TD in 2 of 4 playoff games.`,
      ['WALKER_TD', 'FIRST_TD', 'SEA_GAMESCRIPT']),

    // ── HENRY ───────────────────────────────────────────────────────
    leg('Hunter Henry', 'Anytime TD', 240, 0.32,
      'SEA allows MOST TDs to TEs in NFL',
      'Henry scored 7 TDs (career high). Seattle allows the most TDs to TEs in the league. He\'s NE\'s #1 red zone target — accounted for NE\'s first TD in 5 of 7 scoring games. +240 implies 29.4%.',
      ['HENRY_PRODUCTION', 'MAYE_PASSING', 'NE_OFFENSE', 'BOOM_LEG']),

    leg('Hunter Henry', 'Over 39.5 Rec Yards', -110, 0.56,
      `Kalshi Henry 4+ rec at ${(k.henry4plus * 100).toFixed(0)}c, 5+ at ${(k.henry5plus * 100).toFixed(0)}c`,
      `Henry avg 43.7 rec yds/game. SEA allows 63.5 TE yds/game (6th worst). Had 6 catches/68 yards in divisional round. This matchup is elite.`,
      ['HENRY_PRODUCTION', 'MAYE_PASSING', 'NE_OFFENSE']),

    leg('Hunter Henry', 'Over 3.5 Receptions', -110, 0.56,
      `Kalshi Henry 4+ rec at ${(k.henry4plus * 100).toFixed(0)}c`,
      `Kalshi has Henry 4+ rec at ${(k.henry4plus * 100).toFixed(0)}c. He avg 4.2 rec/game. SEA allowed 5th-most catches to TEs (6.2/game). Primary safety valve for a QB under pressure.`,
      ['HENRY_PRODUCTION', 'MAYE_PASSING', 'NE_OFFENSE']),

    // ── DIGGS ───────────────────────────────────────────────────────
    leg('Stefon Diggs', 'Over 4.5 Receptions', -110, 0.54,
      `Kalshi Diggs 5+ rec at ${(k.diggs5plus * 100).toFixed(0)}c`,
      `Diggs avg 5.1 rec/game. Kalshi prices 5+ at ${(k.diggs5plus * 100).toFixed(0)}c. As Maye\'s WR1, he gets force-fed targets especially if NE is trailing.`,
      ['DIGGS_PRODUCTION', 'MAYE_PASSING', 'NE_OFFENSE']),

    // ── KUPP ────────────────────────────────────────────────────────
    leg('Cooper Kupp', 'Over 3.5 Receptions', -110, 0.48,
      `Kalshi Kupp 4+ rec at ${(k.kupp4plus * 100).toFixed(0)}c — BELOW FD`,
      `Kalshi prices Kupp 4+ at just ${(k.kupp4plus * 100).toFixed(0)}c — that's BELOW FD's -110 (52.4%). Kupp is WR2 behind JSN. Not guaranteed volume. FADE.`,
      ['SEA_OFFENSE', 'FADE']),

    // ── STEVENSON ───────────────────────────────────────────────────
    leg('Rhamondre Stevenson', 'Anytime TD', 145, 0.40,
      'Stevenson First TD at 10.5c on Kalshi',
      'Stevenson had 8 rushing TDs in reg season. NE uses him in short-yardage. If game stays close, NE can pound it near the goal line. +145 implies 40.8%.',
      ['NE_OFFENSE', 'STEVENSON_TD']),

    // ── SHAHEED ─────────────────────────────────────────────────────
    leg('Rashid Shaheed', 'Anytime TD', 260, 0.20,
      `Kalshi Shaheed First TD at ${(k.shaheedFirstTd * 100).toFixed(0)}c`,
      'Shaheed is the X-factor — WR, jet sweeps, kick returner. Had a 51-yd catch in the NFC CG. 2 TDs since joining SEA (both as returner). Multiple TD paths FD underweights.',
      ['SEA_OFFENSE', 'BOOM_LEG']),

    // ── GAME-LEVEL ──────────────────────────────────────────────────
    leg('Game Total', 'Over 45.5 Points', -110, 0.50,
      `Kalshi O45.5 at ${(k.over45_5 * 100).toFixed(0)}c — coin flip`,
      `Kalshi O45.5 at ${(k.over45_5 * 100).toFixed(0)}c. True coin flip. If you believe Darnold throws 2+ TDs and Maye airs it out, this can hit. Correlated with passing volume thesis.`,
      ['OVER_FLOW', 'PASSING_VOLUME']),

    leg('Game Total', 'Under 45.5 Points', -110, 0.50,
      `Kalshi O45.5 at ${(k.over45_5 * 100).toFixed(0)}c`,
      'Both defenses are playoff-elite. Super Bowls trend Under (24 of last 40). If NE can\'t score, this is 28-14 territory.',
      ['GAME_FLOW_DEFENSIVE', 'NE_STRUGGLES']),

    leg('Seattle', 'Win by 5+ (Cover -4.5)', -110, 0.52,
      `Kalshi SEA -4.5 at ${(k.sea_minus_4_5 * 100).toFixed(0)}c`,
      `Kalshi SEA -4.5 at ${(k.sea_minus_4_5 * 100).toFixed(0)}c. True coin flip on the spread. If Darnold throws 2+ TDs and Walker gets a goal-line score, this covers easily.`,
      ['SEA_GAMESCRIPT', 'SEA_OFFENSE']),
  ];
}

// =============================================================================
// PARLAY BUILDER
// =============================================================================

interface Parlay {
  name: string;
  emoji: string;
  thesis: string;
  legNames: string[];  // "player|prop" to match
  corrBoost: number;
  whyItHits: string;
  riskLevel: 'SAFE' | 'MODERATE' | 'RISKY' | 'YOLO' | 'DEGEN';
}

function buildParlayMenu(): Parlay[] {
  return [
    // ── 1. THE DARNOLD MASTERCLASS ──────────────────────────────────
    {
      name: 'THE DARNOLD MASTERCLASS',
      emoji: '🎯',
      thesis: 'Darnold balls out. 2+ TDs, feeds JSN, lots of yards. Walker vultures goal-line.',
      legNames: [
        'Sam Darnold|Over 231.5 Pass Yards',
        'Sam Darnold|Over 1.5 Pass TDs',
        'Jaxon Smith-Njigba|Anytime TD',
        'Jaxon Smith-Njigba|Over 6.5 Receptions',
      ],
      corrBoost: 1.40,  // MASSIVE correlation: all same player/target
      whyItHits: 'Every leg feeds the same story. If Darnold throws 232+ and 2+ TDs, JSN MUST have 7+ catches (36% target share) and is highly likely to score (40% of receiving TDs). This is one outcome disguised as 4 legs.',
      riskLevel: 'MODERATE',
    },

    // ── 2. DARNOLD MASTERCLASS + WALKER ─────────────────────────────
    {
      name: 'DARNOLD + WALKER COMBO',
      emoji: '🔥',
      thesis: 'Darnold slings it, JSN eats, Walker punches in a goal-line TD.',
      legNames: [
        'Sam Darnold|Over 231.5 Pass Yards',
        'Sam Darnold|Over 1.5 Pass TDs',
        'Jaxon Smith-Njigba|Anytime TD',
        'Jaxon Smith-Njigba|Over 6.5 Receptions',
        'Kenneth Walker III|Anytime TD',
      ],
      corrBoost: 1.35,
      whyItHits: 'Same as Masterclass but adds Walker ATD. Walker and Darnold TDs aren\'t competing — Walker scores rushing TDs, Darnold throws to JSN/Kupp. In a SEA-controlled game, BOTH score.',
      riskLevel: 'MODERATE',
    },

    // ── 3. THE JSN CORONATION ───────────────────────────────────────
    {
      name: 'THE JSN CORONATION',
      emoji: '👑',
      thesis: 'JSN goes nuclear: TDs, yards, catches. Darnold throws 3+. JSN = Super Bowl MVP.',
      legNames: [
        'Jaxon Smith-Njigba|Anytime TD',
        'Jaxon Smith-Njigba|Over 93.5 Rec Yards',
        'Jaxon Smith-Njigba|Over 6.5 Receptions',
        'Sam Darnold|Over 2.5 Pass TDs',
      ],
      corrBoost: 1.45,  // Extreme correlation
      whyItHits: 'If Darnold throws 3 TDs, JSN catches at least one (40% TD share). If JSN scores with 7+ catches, he almost certainly clears 93.5 yards. This is the "JSN wins MVP" parlay.',
      riskLevel: 'RISKY',
    },

    // ── 4. THE SHOOTOUT ─────────────────────────────────────────────
    {
      name: 'THE SHOOTOUT',
      emoji: '💥',
      thesis: 'Both QBs air it out. Points galore. Receivers feast on both sides.',
      legNames: [
        'Sam Darnold|Over 231.5 Pass Yards',
        'Drake Maye|Over 221.5 Pass Yards',
        'Jaxon Smith-Njigba|Anytime TD',
        'Hunter Henry|Over 39.5 Rec Yards',
        'Game Total|Over 45.5 Points',
      ],
      corrBoost: 1.30,
      whyItHits: 'If the Over hits, both QBs MUST be passing. Darnold and Maye O pass yards are correlated with the Over total. JSN and Henry feast in a high-scoring game.',
      riskLevel: 'MODERATE',
    },

    // ── 5. GAME SCRIPT KING ─────────────────────────────────────────
    {
      name: 'GAME SCRIPT KING',
      emoji: '📋',
      thesis: 'SEA leads, NE chases via pass. Both sides\' game scripts are predictable.',
      legNames: [
        'Sam Darnold|Over 1.5 Pass TDs',
        'Kenneth Walker III|Anytime TD',
        'Drake Maye|Over 221.5 Pass Yards',
        'Hunter Henry|Over 39.5 Rec Yards',
        'Seattle|Win by 5+ (Cover -4.5)',
      ],
      corrBoost: 1.35,
      whyItHits: 'If SEA covers -4.5, Darnold had 2+ TDs and Walker scored. If NE is trailing, Maye passes 222+ and Henry gets his 40 yards. Every leg feeds from the same game state.',
      riskLevel: 'MODERATE',
    },

    // ── 6. TIGHT END TAKEOVER ───────────────────────────────────────
    {
      name: 'TIGHT END TAKEOVER',
      emoji: '🦾',
      thesis: 'Both TEs feast. Henry exploits SEA\'s TE weakness. Barner gets his as Maye\'s safety valve.',
      legNames: [
        'Hunter Henry|Anytime TD',
        'Hunter Henry|Over 39.5 Rec Yards',
        'Hunter Henry|Over 3.5 Receptions',
        'Sam Darnold|Over 1.5 Pass TDs',
        'Drake Maye|Over 221.5 Pass Yards',
      ],
      corrBoost: 1.35,
      whyItHits: 'SEA allows the MOST TDs to TEs. Henry is NE\'s #1 red zone target. If Maye throws 222+ yards, Henry gets his 4 catches and 40 yards. The ATD at +240 is the spice.',
      riskLevel: 'RISKY',
    },

    // ── 7. THE NE BACKDOOR ──────────────────────────────────────────
    {
      name: 'THE NE BACKDOOR',
      emoji: '🚪',
      thesis: 'NE keeps it close. Maye rushes for a TD. Diggs and Henry go off. The upset special.',
      legNames: [
        'Drake Maye|Over 221.5 Pass Yards',
        'Drake Maye|Anytime TD (Rushing)',
        'Stefon Diggs|Over 4.5 Receptions',
        'Hunter Henry|Anytime TD',
      ],
      corrBoost: 1.30,
      whyItHits: 'If NE is competitive, Maye passes 222+ AND uses his legs. In that world, Diggs and Henry are eating. The Maye rushing TD at +280 is the spice — he had 4 in the regular season.',
      riskLevel: 'RISKY',
    },

    // ── 8. THE LONGSHOT LOTTERY ─────────────────────────────────────
    {
      name: 'THE LONGSHOT LOTTERY',
      emoji: '🎰',
      thesis: 'Darnold throws 3 TDs. JSN scores first. Henry finds the end zone. Everything goes RIGHT.',
      legNames: [
        'Sam Darnold|Over 2.5 Pass TDs',
        'Jaxon Smith-Njigba|First TD Scorer',
        'Hunter Henry|Anytime TD',
        'Kenneth Walker III|Under 70.5 Rush Yards',
      ],
      corrBoost: 1.25,
      whyItHits: 'High payout, genuine logic. JSN First TD + Darnold 3 TDs = he throws one to JSN on the opening drive. Henry TD exploits SEA TE weakness. Walker Under because NE run D is elite even if he scores.',
      riskLevel: 'YOLO',
    },
  ];
}

// =============================================================================
// CALCULATE AND DISPLAY
// =============================================================================

interface BuiltParlay {
  parlay: Parlay;
  legs: Leg[];
  fdPayout: number;
  rawImplied: number;
  trueProb: number;
  boostedProb: number;
  ev: number;
}

function buildAndCalculate(parlayDef: Parlay, allLegs: Leg[]): BuiltParlay | null {
  const matched: Leg[] = [];
  for (const name of parlayDef.legNames) {
    const [player, prop] = name.split('|');
    const found = allLegs.find(l => l.player === player && l.prop === prop);
    if (!found) return null;
    matched.push(found);
  }

  let fdPayout = 1;
  let rawImplied = 1;
  let trueProb = 1;

  for (const l of matched) {
    fdPayout *= americanToPayout(l.fdOdds);
    rawImplied *= americanToImplied(l.fdOdds);
    trueProb *= l.trueProb;
  }

  const boostedProb = Math.min(trueProb * parlayDef.corrBoost, 0.95);
  const ev = boostedProb * fdPayout - 1;

  return {
    parlay: parlayDef,
    legs: matched,
    fdPayout,
    rawImplied,
    trueProb,
    boostedProb,
    ev,
  };
}

function display(results: BuiltParlay[], allLegs: Leg[]) {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║    🏈  SUPER BOWL LX — THE FULL PARLAY MENU                                  ║
║    Seattle Seahawks (-4.5) vs New England Patriots (+4.5)                    ║
║    O/U 45.5 | Feb 8, 2026 | Levi's Stadium                                  ║
║                                                                              ║
║    THESIS: Darnold for 2 TDs, 1 to JSN, big yards against Pats D            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // ── KALSHI ANCHORS ────────────────────────────────────────────────
  const k = getKalshiAnchors();
  console.log('━━━ KALSHI MARKET CONSENSUS (Live Anchors) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  MVP Favorites:     Darnold ${(k.darnoldMvp*100).toFixed(0)}c | Maye ${(k.mayeMvp*100).toFixed(0)}c | JSN ${(k.jsnMvp*100).toFixed(0)}c | Walker ${(k.walkerMvp*100).toFixed(0)}c`);
  console.log(`  First TD:          Walker ${(k.walkerFirstTd*100).toFixed(0)}c | JSN ${(k.jsnFirstTd*100).toFixed(0)}c | Stevenson ${(k.stevensonFirstTd*100).toFixed(0)}c | Shaheed ${(k.shaheedFirstTd*100).toFixed(0)}c`);
  console.log(`  Game Total:        O45.5 ${(k.over45_5*100).toFixed(0)}c | O47.5 ${(k.over47_5*100).toFixed(0)}c | O49.5 ${(k.over49_5*100).toFixed(0)}c`);
  console.log(`  Spread:            SEA -4.5 ${(k.sea_minus_4_5*100).toFixed(0)}c | SEA -6.5 ${(k.sea_minus_6_5*100).toFixed(0)}c`);
  console.log(`  JSN Receptions:    7+ ${(k.jsn7plus*100).toFixed(0)}c | 8+ ${(k.jsn8plus*100).toFixed(0)}c | 9+ ${(k.jsn9plus*100).toFixed(0)}c`);
  console.log(`  Henry Receptions:  4+ ${(k.henry4plus*100).toFixed(0)}c | 5+ ${(k.henry5plus*100).toFixed(0)}c | 6+ ${(k.henry6plus*100).toFixed(0)}c`);
  console.log(`  Overtime:          ${(k.overtime*100).toFixed(0)}c`);
  console.log('');

  // ── INDIVIDUAL EDGE TABLE ─────────────────────────────────────────
  console.log('━━━ INDIVIDUAL LEG EDGES (sorted by edge) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const sorted = [...allLegs]
    .filter(l => !l.tags.includes('FADE'))
    .sort((a, b) => (b.trueProb - americanToImplied(b.fdOdds)) - (a.trueProb - americanToImplied(a.fdOdds)));

  for (const l of sorted) {
    const fdImpl = americanToImplied(l.fdOdds);
    const edge = l.trueProb - fdImpl;
    const icon = edge >= 0.04 ? '🟢' : edge >= 0.01 ? '🟡' : '🔴';
    const name = `${l.player}: ${l.prop}`.padEnd(46).slice(0, 46);
    console.log(`  ${icon} ${name} FD ${formatOdds(l.fdOdds).padEnd(6)} (${(fdImpl*100).toFixed(0)}%) → True ${(l.trueProb*100).toFixed(0)}%  Edge: ${edge >= 0 ? '+' : ''}${(edge*100).toFixed(1)}%`);
  }
  console.log('');

  // ── EACH PARLAY ───────────────────────────────────────────────────
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const p = r.parlay;
    const parlayOdds = impliedToAmerican(1 / r.fdPayout);
    const evPct = (r.ev * 100).toFixed(0);
    const riskColors: Record<string, string> = {
      'SAFE': '🟢', 'MODERATE': '🟡', 'RISKY': '🟠', 'YOLO': '🔴', 'DEGEN': '💀'
    };

    console.log(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
    console.log(`┃  ${p.emoji}  PARLAY ${i + 1}: ${p.name.padEnd(55)} ┃`);
    console.log(`┃                                                                              ┃`);
    console.log(`┃  ${riskColors[p.riskLevel]} ${p.riskLevel.padEnd(10)} Payout: ${r.fdPayout.toFixed(1)}x (${formatOdds(parlayOdds)})     EV: ${r.ev > 0 ? '✅' : '⚠️ '} ${evPct}%`.padEnd(79) + '┃');
    console.log(`┃  Thesis: ${p.thesis.slice(0, 66)}`.padEnd(79) + '┃');
    console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
    console.log('');

    for (let j = 0; j < r.legs.length; j++) {
      const l = r.legs[j];
      const fdImpl = americanToImplied(l.fdOdds);
      const edge = l.trueProb - fdImpl;
      const edgeIcon = edge >= 0.03 ? '🟢' : edge >= 0 ? '🟡' : '🔴';

      console.log(`  ☑️  LEG ${j + 1}: ${l.player} — ${l.prop} (${formatOdds(l.fdOdds)})`);
      console.log(`      Edge: ${edgeIcon} ${(edge >= 0 ? '+' : '')}${(edge * 100).toFixed(1)}%  |  Kalshi: ${l.kalshiAnchor}`);
      console.log(`      ${l.reasoning}`);
      console.log('');
    }

    // WHY IT HITS
    console.log(`  💡 WHY IT HITS: ${p.whyItHits}`);
    console.log('');

    // SIZING
    console.log(`  ┌────────────────────────────────────────────────────────────────────────┐`);
    console.log(`  │  $5   →  $${(5 * r.fdPayout).toFixed(0).padEnd(7)} $10  →  $${(10 * r.fdPayout).toFixed(0).padEnd(7)} $25  →  $${(25 * r.fdPayout).toFixed(0).padEnd(7)} $50  →  $${(50 * r.fdPayout).toFixed(0).padEnd(7)}`.padEnd(77) + '│');
    console.log(`  │  True prob (w/ correlation): ${(r.boostedProb * 100).toFixed(1)}%    FD implied: ${(r.rawImplied * 100).toFixed(2)}%    EV: ${evPct}%`.padEnd(77) + '│');
    console.log(`  └────────────────────────────────────────────────────────────────────────┘`);
    console.log('');
    console.log('  ════════════════════════════════════════════════════════════════════════');
    console.log('');
  }

  // ── THE MASTER BUILD ORDER ────────────────────────────────────────
  console.log(`╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                                                                              ║`);
  console.log(`║   🏆  THE COMPLETE FANDUEL BUILD ORDER                                        ║`);
  console.log(`║                                                                              ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  console.log('');

  // Sort by risk level for the build order
  const riskOrder = ['SAFE', 'MODERATE', 'RISKY', 'YOLO', 'DEGEN'];
  const byRisk = [...results].sort((a, b) => riskOrder.indexOf(a.parlay.riskLevel) - riskOrder.indexOf(b.parlay.riskLevel));

  console.log('  Open FanDuel → Super Bowl LX → Same Game Parlay');
  console.log('  Build each of these as SEPARATE SGPs:');
  console.log('');

  const riskEmoji: Record<string, string> = { SAFE: '🟢', MODERATE: '🟡', RISKY: '🟠', YOLO: '🔴', DEGEN: '💀' };

  for (const r of byRisk) {
    const parlayOdds = impliedToAmerican(1 / r.fdPayout);
    console.log(`  ${r.parlay.emoji} ${r.parlay.name}`);
    console.log(`  ${riskEmoji[r.parlay.riskLevel]} ${r.parlay.riskLevel} | ${formatOdds(parlayOdds)} (${r.fdPayout.toFixed(1)}x) | EV: ${(r.ev * 100).toFixed(0)}%`);
    for (const l of r.legs) {
      console.log(`     ☑️  ${l.player}: ${l.prop} (${formatOdds(l.fdOdds)})`);
    }
    console.log('');
  }

  // ── BANKROLL STRATEGY ─────────────────────────────────────────────
  console.log(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
  console.log(`┃  💰  RECOMMENDED BANKROLL ALLOCATION                                        ┃`);
  console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
  console.log('');

  // Build allocation table
  const allocations = [
    { name: 'THE DARNOLD MASTERCLASS', amount: 25, reason: 'Core thesis, highest correlation' },
    { name: 'DARNOLD + WALKER COMBO', amount: 20, reason: 'Core thesis + Walker TD insurance' },
    { name: 'GAME SCRIPT KING', amount: 15, reason: 'SEA covers, both sides produce' },
    { name: 'THE SHOOTOUT', amount: 10, reason: 'If it\'s a high-scoring game' },
    { name: 'THE JSN CORONATION', amount: 10, reason: 'JSN goes nuclear, 3 Darnold TDs' },
    { name: 'TIGHT END TAKEOVER', amount: 5, reason: 'Henry TD is the big swing' },
    { name: 'THE NE BACKDOOR', amount: 5, reason: 'Insurance if NE keeps it close' },
    { name: 'THE LONGSHOT LOTTERY', amount: 5, reason: 'Lottery ticket, massive payout' },
  ];

  let totalOut = 0;
  for (const a of allocations) {
    const r = byRisk.find(x => x.parlay.name === a.name);
    if (r) {
      const winAmt = (a.amount * r.fdPayout).toFixed(0);
      console.log(`  $${String(a.amount).padEnd(4)} ${a.name.padEnd(28)} → wins $${winAmt.padEnd(7)} (${a.reason})`);
      totalOut += a.amount;
    }
  }

  console.log('');
  console.log(`  Total outlay: $${totalOut}`);
  console.log('');

  // Best/worst case
  const maxWin = allocations.reduce((sum, a) => {
    const r = byRisk.find(x => x.parlay.name === a.name);
    return sum + (r ? a.amount * r.fdPayout : 0);
  }, 0);

  console.log(`  BEST CASE (all hit):   +$${maxWin.toFixed(0)} (${(maxWin / totalOut).toFixed(0)}x return)`);
  console.log(`  WORST CASE (none hit): -$${totalOut}`);
  console.log(`  LIKELY SCENARIO:       1-3 parlays hit = solid profit`);
  console.log('');

  // ── KEY CORRELATIONS EXPLAINED ────────────────────────────────────
  console.log(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
  console.log(`┃  🧠  WHY CORRELATIONS MATTER IN SAME GAME PARLAYS                           ┃`);
  console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
  console.log('');
  console.log('  FanDuel prices SGP legs as if they\'re INDEPENDENT. But they\'re NOT:');
  console.log('');
  console.log('  🔗 Darnold 2+ TDs → JSN ATD (r = 0.65)');
  console.log('     If Darnold throws 2 TDs, there\'s a 40% chance one goes to JSN.');
  console.log('     Combined, FD treats this as 52% × 52% = 27%. Real: ~35%.');
  console.log('');
  console.log('  🔗 Darnold O231.5 yds → JSN O6.5 rec (r = 0.70)');
  console.log('     JSN gets 36% of Darnold\'s targets. More passing = more JSN catches.');
  console.log('     FD: 52% × 55% = 29%. Real: ~38%.');
  console.log('');
  console.log('  🔗 SEA covers → Walker ATD (r = 0.55)');
  console.log('     If SEA wins by 5+, they scored at least 3 TDs. Walker gets goal-line.');
  console.log('');
  console.log('  🔗 Maye O221.5 yds → Henry O39.5 yds (r = 0.60)');
  console.log('     Henry is the safety valve. More Maye attempts = more Henry targets.');
  console.log('');
  console.log('  🔗 NE trailing → Maye passing volume (r = 0.75)');
  console.log('     If SEA leads, NE abandons run = Maye throws 35+ times = yards pile up.');
  console.log('');

  // ── CONTRARIAN PLAYS ──────────────────────────────────────────────
  console.log(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
  console.log(`┃  ⚡  BONUS: KALSHI-ONLY PLAYS (Not available on FanDuel)                     ┃`);
  console.log(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
  console.log('');
  console.log('  These Kalshi markets complement your FD parlays:');
  console.log('');
  console.log(`  • JSN 9+ receptions: ${(k.jsn9plus*100).toFixed(0)}c YES — if your JSN thesis hits big`);
  console.log(`  • Henry 6+ receptions: ${(k.henry6plus*100).toFixed(0)}c YES — if TE Takeover parlay hits`);
  console.log(`  • Darnold MVP: ${(k.darnoldMvp*100).toFixed(0)}c YES — direct play on your thesis`);
  console.log(`  • JSN MVP: ${(k.jsnMvp*100).toFixed(0)}c YES — if JSN Coronation hits, this 6x's`);
  console.log(`  • Walker First TD: ${(k.walkerFirstTd*100).toFixed(0)}c YES — scripted opening drive play`);
  console.log(`  • Over 49.5 total: ${(k.over49_5*100).toFixed(0)}c YES — if shootout thesis is right`);
  console.log('');

  console.log('  ══════════════════════════════════════════════════════════════════════════');
  console.log('  Data: Kalshi live markets (173 active) + FanDuel odds (Feb 8, 2026)');
  console.log('  Engine: Kalshi Edge Detector v4.0 — Creative Parlay Constructor');
  console.log('');
}

// =============================================================================
// MAIN
// =============================================================================

const k = getKalshiAnchors();
const allLegs = buildAllLegs(k);
const parlayMenu = buildParlayMenu();

const results: BuiltParlay[] = [];
for (const p of parlayMenu) {
  const r = buildAndCalculate(p, allLegs);
  if (r) results.push(r);
}

display(results, allLegs);
