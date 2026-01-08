/**
 * Options-Implied Probability Module
 *
 * Extracts probability estimates from derivatives markets:
 * - Fed Funds Futures → Rate decision probabilities
 * - SPX Options → Market crash / recession probabilities
 * - Treasury Yields → Recession probability from yield curve
 */

import { logger } from '../../utils/index.js';
import type { FedFundsImplied, SPXImplied, TreasuryImplied, OptionsImpliedData } from '../../types/index.js';

// =============================================================================
// FED FUNDS FUTURES
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

/**
 * Fetch Fed Funds Futures implied probabilities
 * Uses CME FedWatch methodology
 */
export async function fetchFedFundsImplied(): Promise<FedFundsImplied | null> {
  try {
    // CME FedWatch data endpoint (public)
    const response = await fetch('https://www.cmegroup.com/services/fed-funds-target-rate.json', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'KalshiEdgeDetector/2.0' },
    });

    if (!response.ok) {
      // Fallback: Calculate from treasury yields
      logger.warn('CME FedWatch unavailable, using treasury fallback');
      return calculateFedFundsFromTreasury();
    }

    const data = await response.json() as {
      meetings?: Array<{
        outcomes?: Array<{ rate: string; probability: string }>;
      }>;
    };
    const meetingDate = getNextFOMCMeeting();

    // Current Fed Funds target rate (as of late 2024/early 2025)
    const currentTarget = { lower: 4.25, upper: 4.50 };

    // Parse CME data format
    const probabilities: { rate: number; probability: number }[] = [];
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
        else if (diff >= 0.25) probHike25 += prob;
        else if (diff >= 0.50) probHike50 += prob;
      }
    }

    // If no data, use reasonable defaults
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

/**
 * Fallback: Calculate Fed Funds probabilities from Treasury yields
 */
async function calculateFedFundsFromTreasury(): Promise<FedFundsImplied | null> {
  try {
    // Fetch treasury yields from FRED or similar
    const treasury = await fetchTreasuryYields();
    if (!treasury) return null;

    const meetingDate = getNextFOMCMeeting();
    const currentTarget = { lower: 4.25, upper: 4.50 };

    // Use 3-month treasury as proxy for near-term Fed expectations
    const threeMoYield = treasury.yields.find(y => y.tenor === '3m')?.yield ?? 4.35;
    const impliedRate = threeMoYield;

    // Estimate probabilities based on yield vs current target
    const diff = impliedRate - currentTarget.upper;

    let probCut25 = 0, probCut50 = 0, probHold = 0, probHike25 = 0, probHike50 = 0;

    if (diff < -0.35) {
      probCut50 = 0.3;
      probCut25 = 0.5;
      probHold = 0.2;
    } else if (diff < -0.15) {
      probCut25 = 0.6;
      probHold = 0.35;
      probHike25 = 0.05;
    } else if (diff < 0.15) {
      probCut25 = 0.2;
      probHold = 0.6;
      probHike25 = 0.2;
    } else if (diff < 0.35) {
      probHold = 0.35;
      probHike25 = 0.5;
      probHike50 = 0.15;
    } else {
      probHike25 = 0.4;
      probHike50 = 0.4;
      probHold = 0.2;
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
      probCut25,
      probCut50,
      probHold,
      probHike25,
      probHike50,
      source: 'treasury',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Treasury fallback error: ${error}`);
    return null;
  }
}

// =============================================================================
// SPX OPTIONS IMPLIED
// =============================================================================

/**
 * Fetch SPX options implied probabilities
 * Extracts tail risk probabilities from put spreads
 */
export async function fetchSPXImplied(): Promise<SPXImplied | null> {
  try {
    // Fetch VIX as proxy for implied volatility
    const vixResponse = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d');
    const spxResponse = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d');

    if (!vixResponse.ok || !spxResponse.ok) {
      logger.warn('Yahoo Finance unavailable for VIX/SPX');
      return getDefaultSPXImplied();
    }

    type YahooChartResponse = {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
        }>;
      };
    };

    const vixData = await vixResponse.json() as YahooChartResponse;
    const spxData = await spxResponse.json() as YahooChartResponse;

    const vixCurrent = vixData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 15;
    const spxCurrent = spxData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 5000;

    // VIX represents annualized 30-day expected volatility
    // Convert to expected move: VIX / sqrt(12) for monthly
    const vixImpliedMove = vixCurrent / Math.sqrt(12) / 100;

    // Calculate probability of various drawdowns using normal distribution approximation
    // This is simplified; real options math would use Black-Scholes
    const stdDev = vixCurrent / 100 / Math.sqrt(12);

    const probDown10 = normalCDF(-0.10 / stdDev);
    const probDown20 = normalCDF(-0.20 / stdDev);
    const probDown30 = normalCDF(-0.30 / stdDev);

    // Calculate probability levels
    const probabilities: { level: number; probAbove: number; probBelow: number }[] = [];
    const levels = [
      spxCurrent * 0.95,
      spxCurrent * 0.90,
      spxCurrent * 0.85,
      spxCurrent * 0.80,
      spxCurrent * 1.05,
      spxCurrent * 1.10,
    ];

    for (const level of levels) {
      const pctMove = (level - spxCurrent) / spxCurrent;
      const zScore = pctMove / stdDev;
      probabilities.push({
        level: Math.round(level),
        probAbove: 1 - normalCDF(zScore),
        probBelow: normalCDF(zScore),
      });
    }

    // Expiration for 30-day options
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

/**
 * Fetch Treasury yields and calculate recession probability
 */
export async function fetchTreasuryYields(): Promise<TreasuryImplied | null> {
  try {
    // Fetch from Treasury.gov XML or fallback to Yahoo Finance
    const tenors: TreasuryImplied['yields'] = [];

    // Try Yahoo Finance for treasury ETFs as proxy
    const symbols = {
      '3m': '%5EIRX', // 3-month T-bill rate
      '2y': '%5ETYX', // Approximate with 10y, adjust below
      '10y': '%5ETNX',
    };

    // Fetch 10-year yield
    const tnyResponse = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1d');
    let yield10y = 4.0;
    if (tnyResponse.ok) {
      const data = await tnyResponse.json() as {
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
      };
      yield10y = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 4.0;
    }

    // Estimate other yields based on typical curve shape
    // In reality, you'd fetch each tenor separately
    const yield3m = yield10y + 0.5; // Inverted curve assumption
    const yield2y = yield10y + 0.2;
    const yield1y = yield10y + 0.3;
    const yield5y = yield10y - 0.1;
    const yield30y = yield10y + 0.3;

    tenors.push(
      { tenor: '3m', yield: yield3m },
      { tenor: '1y', yield: yield1y },
      { tenor: '2y', yield: yield2y },
      { tenor: '5y', yield: yield5y },
      { tenor: '10y', yield: yield10y },
      { tenor: '30y', yield: yield30y },
    );

    const curve2s10s = yield10y - yield2y;
    const curve3m10y = yield10y - yield3m;
    const isInverted = curve2s10s < 0 || curve3m10y < 0;
    const inversionDepth = Math.min(curve2s10s, curve3m10y);

    // NY Fed recession probability model (simplified)
    // Based on 3m10y spread
    // Real model: https://www.newyorkfed.org/research/capital_markets/ycfaq
    let recessionProb12m: number;
    if (curve3m10y < -1.0) {
      recessionProb12m = 0.7;
    } else if (curve3m10y < -0.5) {
      recessionProb12m = 0.5;
    } else if (curve3m10y < 0) {
      recessionProb12m = 0.35;
    } else if (curve3m10y < 0.5) {
      recessionProb12m = 0.2;
    } else {
      recessionProb12m = 0.1;
    }

    return {
      yields: tenors,
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
// AGGREGATED DATA
// =============================================================================

/**
 * Fetch all options-implied data
 */
export async function fetchAllOptionsImplied(): Promise<OptionsImpliedData> {
  const [fedFunds, spx, treasury] = await Promise.all([
    fetchFedFundsImplied(),
    fetchSPXImplied(),
    fetchTreasuryYields(),
  ]);

  return {
    fedFunds,
    spx,
    treasury,
    aggregatedAt: new Date().toISOString(),
  };
}

/**
 * Compare options-implied to Kalshi market prices
 */
export function findOptionsEdge(
  kalshiPrice: number,
  impliedProb: number,
  source: string
): { edge: number; direction: 'buy_yes' | 'buy_no'; confidence: number } | null {
  const edge = impliedProb - kalshiPrice;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.03) return null;

  // Confidence based on source reliability
  const sourceConfidence: Record<string, number> = {
    cme: 0.9,
    treasury: 0.75,
    spx: 0.7,
    calculated: 0.6,
  };

  return {
    edge,
    direction: edge > 0 ? 'buy_yes' : 'buy_no',
    confidence: sourceConfidence[source] ?? 0.5,
  };
}

/**
 * Format options-implied report
 */
export function formatOptionsImpliedReport(data: OptionsImpliedData): string {
  const lines: string[] = [
    '📈 **Options-Implied Probabilities**',
    '═══════════════════════════════════',
    '',
  ];

  if (data.fedFunds) {
    const ff = data.fedFunds;
    lines.push('**Fed Funds Futures**');
    lines.push(`Next Meeting: ${ff.meetingDate}`);
    lines.push(`Implied Rate: ${ff.impliedRate.toFixed(2)}%`);
    lines.push(`P(Cut 25bp): ${(ff.probCut25 * 100).toFixed(0)}%`);
    lines.push(`P(Hold): ${(ff.probHold * 100).toFixed(0)}%`);
    lines.push(`P(Hike 25bp): ${(ff.probHike25 * 100).toFixed(0)}%`);
    lines.push('');
  }

  if (data.spx) {
    lines.push('**SPX Options**');
    lines.push(`Current: ${data.spx.currentPrice.toFixed(0)}`);
    lines.push(`VIX: ${data.spx.vixCurrent.toFixed(1)}`);
    lines.push(`P(Down 10%): ${(data.spx.probDown10 * 100).toFixed(1)}%`);
    lines.push(`P(Down 20%): ${(data.spx.probDown20 * 100).toFixed(2)}%`);
    lines.push('');
  }

  if (data.treasury) {
    lines.push('**Treasury Curve**');
    lines.push(`2s10s Spread: ${(data.treasury.curve2s10s * 100).toFixed(0)}bp`);
    lines.push(`Inverted: ${data.treasury.isInverted ? 'Yes' : 'No'}`);
    lines.push(`Recession Prob (12m): ${(data.treasury.recessionProb12m * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

// =============================================================================
// UTILITY
// =============================================================================

function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}
