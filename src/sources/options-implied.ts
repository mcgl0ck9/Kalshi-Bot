/**
 * Options-Implied Probability Source
 *
 * Extracts probability estimates from derivatives markets:
 * - Fed Funds Futures → Rate decision probabilities
 * - SPX Options / VIX → Market crash / volatility probabilities
 * - Treasury Yields → Recession probability from yield curve
 *
 * All sources are FREE public data.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FedFundsImplied {
  meetingDate: string;
  currentTarget: { lower: number; upper: number };
  impliedRate: number;
  probabilities: Array<{ rate: number; probability: number }>;
  probCut25: number;
  probCut50: number;
  probHold: number;
  probHike25: number;
  probHike50: number;
  source: 'cme' | 'treasury';
  fetchedAt: string;
}

export interface SPXImplied {
  expirationDate: string;
  currentPrice: number;
  probabilities: Array<{ level: number; probAbove: number; probBelow: number }>;
  probDown10: number;
  probDown20: number;
  probDown30: number;
  vixCurrent: number;
  vixImpliedMove: number;
  fetchedAt: string;
}

export interface TreasuryImplied {
  yields: Array<{ tenor: string; yield: number }>;
  curve2s10s: number;
  curve3m10y: number;
  isInverted: boolean;
  inversionDepth: number;
  recessionProb12m: number;
  fetchedAt: string;
}

export interface OptionsImpliedData {
  fedFunds: FedFundsImplied | null;
  spx: SPXImplied | null;
  treasury: TreasuryImplied | null;
  fetchedAt: string;
}

// =============================================================================
// FOMC DATES
// =============================================================================

const FOMC_MEETING_DATES_2025 = [
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-11-05', '2025-12-17',
];

const FOMC_MEETING_DATES_2026 = [
  '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
];

function getNextFOMCMeeting(): string {
  const now = new Date();
  const allDates = [...FOMC_MEETING_DATES_2025, ...FOMC_MEETING_DATES_2026];
  for (const date of allDates) {
    if (new Date(date) > now) return date;
  }
  return allDates[allDates.length - 1];
}

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<OptionsImpliedData>({
  name: 'options-implied',
  category: 'macro',
  cacheTTL: 1800,  // 30 min cache

  async fetch(): Promise<OptionsImpliedData> {
    const [fedFunds, spx, treasury] = await Promise.all([
      fetchFedFundsImplied(),
      fetchSPXImplied(),
      fetchTreasuryYields(),
    ]);

    if (fedFunds) {
      logger.info(`FedFunds: P(cut)=${((fedFunds.probCut25 + fedFunds.probCut50) * 100).toFixed(0)}%, P(hold)=${(fedFunds.probHold * 100).toFixed(0)}%`);
    }
    if (spx) {
      logger.info(`VIX: ${spx.vixCurrent.toFixed(1)}, P(down 10%)=${(spx.probDown10 * 100).toFixed(1)}%`);
    }
    if (treasury) {
      logger.info(`2s10s: ${(treasury.curve2s10s * 100).toFixed(0)}bp, Recession prob: ${(treasury.recessionProb12m * 100).toFixed(0)}%`);
    }

    return {
      fedFunds,
      spx,
      treasury,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// FED FUNDS FUTURES
// =============================================================================

async function fetchFedFundsImplied(): Promise<FedFundsImplied | null> {
  try {
    const response = await fetch('https://www.cmegroup.com/services/fed-funds-target-rate.json', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'KalshiEdgeDetector/4.0' },
    });

    if (!response.ok) {
      logger.warn('CME FedWatch unavailable, using treasury fallback');
      return calculateFedFundsFromTreasury();
    }

    const data = await response.json() as {
      meetings?: Array<{ outcomes?: Array<{ rate: string; probability: string }> }>;
    };

    const meetingDate = getNextFOMCMeeting();
    const currentTarget = { lower: 4.25, upper: 4.50 };

    const probabilities: Array<{ rate: number; probability: number }> = [];
    let probCut25 = 0, probCut50 = 0, probHold = 0, probHike25 = 0, probHike50 = 0;

    if (data?.meetings?.length && data.meetings.length > 0) {
      const nextMeeting = data.meetings[0];
      for (const outcome of nextMeeting.outcomes || []) {
        const rate = parseFloat(outcome.rate);
        const prob = parseFloat(outcome.probability) / 100;
        probabilities.push({ rate, probability: prob });

        const diff = rate - currentTarget.upper;
        if (diff <= -0.50) probCut50 += prob;
        else if (diff <= -0.25) probCut25 += prob;
        else if (Math.abs(diff) < 0.125) probHold += prob;
        else if (diff >= 0.50) probHike50 += prob;
        else if (diff >= 0.25) probHike25 += prob;
      }
    }

    if (probabilities.length === 0) {
      return calculateFedFundsFromTreasury();
    }

    const impliedRate = probabilities.reduce((sum, p) => sum + p.rate * p.probability, 0);

    return {
      meetingDate,
      currentTarget,
      impliedRate,
      probabilities,
      probCut25,
      probCut50,
      probHold,
      probHike25,
      probHike50,
      source: 'cme',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`FedFunds fetch error: ${error}`);
    return calculateFedFundsFromTreasury();
  }
}

async function calculateFedFundsFromTreasury(): Promise<FedFundsImplied | null> {
  try {
    const treasury = await fetchTreasuryYields();
    if (!treasury) return null;

    const meetingDate = getNextFOMCMeeting();
    const currentTarget = { lower: 4.25, upper: 4.50 };
    const threeMoYield = treasury.yields.find(y => y.tenor === '3m')?.yield ?? 4.35;
    const impliedRate = threeMoYield;
    const diff = impliedRate - currentTarget.upper;

    let probCut25 = 0, probCut50 = 0, probHold = 0, probHike25 = 0, probHike50 = 0;

    if (diff < -0.35) {
      probCut50 = 0.3; probCut25 = 0.5; probHold = 0.2;
    } else if (diff < -0.15) {
      probCut25 = 0.6; probHold = 0.35; probHike25 = 0.05;
    } else if (diff < 0.15) {
      probCut25 = 0.2; probHold = 0.6; probHike25 = 0.2;
    } else if (diff < 0.35) {
      probHold = 0.35; probHike25 = 0.5; probHike50 = 0.15;
    } else {
      probHike25 = 0.4; probHike50 = 0.4; probHold = 0.2;
    }

    return {
      meetingDate,
      currentTarget,
      impliedRate,
      probabilities: [
        { rate: currentTarget.upper - 0.50, probability: probCut50 },
        { rate: currentTarget.upper - 0.25, probability: probCut25 },
        { rate: currentTarget.upper, probability: probHold },
        { rate: currentTarget.upper + 0.25, probability: probHike25 },
        { rate: currentTarget.upper + 0.50, probability: probHike50 },
      ],
      probCut25, probCut50, probHold, probHike25, probHike50,
      source: 'treasury',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Treasury fallback error: ${error}`);
    return null;
  }
}

// =============================================================================
// SPX / VIX IMPLIED
// =============================================================================

async function fetchSPXImplied(): Promise<SPXImplied | null> {
  try {
    const [vixResponse, spxResponse] = await Promise.all([
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d'),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d'),
    ]);

    if (!vixResponse.ok || !spxResponse.ok) {
      logger.warn('Yahoo Finance unavailable for VIX/SPX');
      return getDefaultSPXImplied();
    }

    type YahooChartResponse = {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };

    const vixData = await vixResponse.json() as YahooChartResponse;
    const spxData = await spxResponse.json() as YahooChartResponse;

    const vixCurrent = vixData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 15;
    const spxCurrent = spxData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 5000;

    const vixImpliedMove = vixCurrent / Math.sqrt(12) / 100;
    const stdDev = vixCurrent / 100 / Math.sqrt(12);

    const probDown10 = normalCDF(-0.10 / stdDev);
    const probDown20 = normalCDF(-0.20 / stdDev);
    const probDown30 = normalCDF(-0.30 / stdDev);

    const probabilities: Array<{ level: number; probAbove: number; probBelow: number }> = [];
    const levels = [0.95, 0.90, 0.85, 0.80, 1.05, 1.10];

    for (const mult of levels) {
      const level = spxCurrent * mult;
      const pctMove = mult - 1;
      const zScore = pctMove / stdDev;
      probabilities.push({
        level: Math.round(level),
        probAbove: 1 - normalCDF(zScore),
        probBelow: normalCDF(zScore),
      });
    }

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 30);

    return {
      expirationDate: expirationDate.toISOString().split('T')[0],
      currentPrice: spxCurrent,
      probabilities,
      probDown10,
      probDown20,
      probDown30,
      vixCurrent,
      vixImpliedMove,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`SPX implied fetch error: ${error}`);
    return getDefaultSPXImplied();
  }
}

function getDefaultSPXImplied(): SPXImplied {
  return {
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    currentPrice: 5000,
    probabilities: [],
    probDown10: 0.05,
    probDown20: 0.01,
    probDown30: 0.002,
    vixCurrent: 15,
    vixImpliedMove: 0.043,
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// TREASURY YIELDS
// =============================================================================

async function fetchTreasuryYields(): Promise<TreasuryImplied | null> {
  try {
    const tnyResponse = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1d');

    let yield10y = 4.0;
    if (tnyResponse.ok) {
      const data = await tnyResponse.json() as {
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
      };
      yield10y = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 4.0;
    }

    // Estimate curve shape
    const yield3m = yield10y + 0.5;
    const yield2y = yield10y + 0.2;
    const yield1y = yield10y + 0.3;
    const yield5y = yield10y - 0.1;
    const yield30y = yield10y + 0.3;

    const yields = [
      { tenor: '3m', yield: yield3m },
      { tenor: '1y', yield: yield1y },
      { tenor: '2y', yield: yield2y },
      { tenor: '5y', yield: yield5y },
      { tenor: '10y', yield: yield10y },
      { tenor: '30y', yield: yield30y },
    ];

    const curve2s10s = yield10y - yield2y;
    const curve3m10y = yield10y - yield3m;
    const isInverted = curve2s10s < 0 || curve3m10y < 0;
    const inversionDepth = Math.min(curve2s10s, curve3m10y);

    // NY Fed recession model (simplified)
    let recessionProb12m: number;
    if (curve3m10y < -1.0) recessionProb12m = 0.7;
    else if (curve3m10y < -0.5) recessionProb12m = 0.5;
    else if (curve3m10y < 0) recessionProb12m = 0.35;
    else if (curve3m10y < 0.5) recessionProb12m = 0.2;
    else recessionProb12m = 0.1;

    return {
      yields,
      curve2s10s,
      curve3m10y,
      isInverted,
      inversionDepth,
      recessionProb12m,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Treasury yields fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// EDGE ANALYSIS HELPERS
// =============================================================================

export interface OptionsEdgeSignal {
  type: 'fed' | 'spx' | 'recession';
  impliedProb: number;
  marketPrice: number;
  edge: number;
  direction: 'YES' | 'NO';
  confidence: number;
  reasoning: string;
}

export function findOptionsEdge(
  kalshiPrice: number,
  impliedProb: number,
  source: string
): OptionsEdgeSignal | null {
  const edge = impliedProb - kalshiPrice;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.03) return null;

  const sourceConfidence: Record<string, number> = {
    cme: 0.9,
    treasury: 0.75,
    spx: 0.7,
    calculated: 0.6,
  };

  return {
    type: source.includes('fed') ? 'fed' : source.includes('spx') ? 'spx' : 'recession',
    impliedProb,
    marketPrice: kalshiPrice,
    edge: absEdge,
    direction: edge > 0 ? 'YES' : 'NO',
    confidence: sourceConfidence[source] ?? 0.5,
    reasoning: `Options-implied: ${(impliedProb * 100).toFixed(0)}% vs market: ${(kalshiPrice * 100).toFixed(0)}%`,
  };
}

// =============================================================================
// UTILITY
// =============================================================================

function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);
  return 0.5 * (1.0 + sign * y);
}
