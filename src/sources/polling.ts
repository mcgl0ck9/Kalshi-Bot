/**
 * Political Polling Aggregator Source
 *
 * Fetches and aggregates polling data from multiple sources:
 * - FiveThirtyEight (538) - Nate Silver's original, now ABC-owned
 * - RealClearPolitics (RCP) - Polling averages
 *
 * 2025+: Focuses on approval ratings and generic ballot (off-cycle year).
 * All sources are FREE public data.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ApprovalRating {
  politician: string;
  office: string;
  approve: number;
  disapprove: number;
  netApproval: number;
  asOf: string;
  source: string;
}

export interface PollingAverage {
  race: string;
  raceType: 'president' | 'senate' | 'house' | 'governor' | 'primary' | 'approval';
  state?: string;
  asOf: string;
  candidates: Record<string, number>;
  spread: number;
  leader: string;
  source: string;
}

export interface ElectionForecast {
  race: string;
  state?: string;
  asOf: string;
  candidates: Record<string, number>;
  favorite: string;
  favoriteOdds: number;
  source: string;
  modelType: 'polls-only' | 'polls-plus' | 'fundamentals' | 'ensemble';
}

export interface PollingData {
  approvalRatings: ApprovalRating[];
  genericBallot: PollingAverage | null;
  forecasts: ElectionForecast[];
  sources: string[];
  fetchedAt: string;
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

const FIVETHIRTYEIGHT_URLS = {
  trumpApprovalAvg: 'https://projects.fivethirtyeight.com/polls/approval/donald-trump/polling-average.json',
  genericBallotAvg: 'https://projects.fivethirtyeight.com/polls/generic-ballot/polling-average.json',
};

const RCP_URLS = {
  trumpApproval: 'https://www.realclearpolling.com/polls/approval/donald-trump',
};

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<PollingData>({
  name: 'polling',
  category: 'politics',
  cacheTTL: 3600,  // 1 hour cache (polls don't update that frequently)

  async fetch(): Promise<PollingData> {
    const approvalRatings: ApprovalRating[] = [];
    let genericBallot: PollingAverage | null = null;
    const forecasts: ElectionForecast[] = [];
    const sources: string[] = [];

    // Fetch from 538
    const data538 = await fetch538Data();
    if (data538) {
      if (data538.approvalRatings) approvalRatings.push(...data538.approvalRatings);
      if (data538.genericBallot) genericBallot = data538.genericBallot;
      sources.push('FiveThirtyEight');
    }

    // Fetch from RCP
    const dataRCP = await fetchRCPData();
    if (dataRCP) {
      if (dataRCP.approvalRatings) approvalRatings.push(...dataRCP.approvalRatings);
      sources.push('RealClearPolitics');
    }

    if (approvalRatings.length > 0) {
      const avgApprove = approvalRatings.reduce((s, r) => s + r.approve, 0) / approvalRatings.length;
      logger.info(`Polling: Trump approval avg ${avgApprove.toFixed(1)}% from ${sources.length} sources`);
    }

    return {
      approvalRatings,
      genericBallot,
      forecasts,
      sources,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// 538 FETCHER
// =============================================================================

interface FiveThirtyEightApproval {
  date: string;
  subgroup: string;
  approve_estimate: number;
  disapprove_estimate: number;
}

interface FiveThirtyEightAverage {
  date: string;
  candidate: string;
  pct_estimate: number;
}

async function fetch538Data(): Promise<{
  approvalRatings?: ApprovalRating[];
  genericBallot?: PollingAverage;
} | null> {
  const approvalRatings: ApprovalRating[] = [];
  let genericBallot: PollingAverage | undefined;

  // Fetch Trump approval rating
  try {
    const response = await fetch(FIVETHIRTYEIGHT_URLS.trumpApprovalAvg, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/4.0)' },
    });

    if (response.ok) {
      const data = await response.json() as FiveThirtyEightApproval[];

      if (Array.isArray(data) && data.length > 0) {
        const allPolls = data.filter(d => d.subgroup === 'All polls' || d.subgroup === 'Adults');
        const latest = allPolls.sort((a, b) => b.date.localeCompare(a.date))[0];

        if (latest) {
          approvalRatings.push({
            politician: 'Donald Trump',
            office: 'President',
            approve: latest.approve_estimate,
            disapprove: latest.disapprove_estimate,
            netApproval: latest.approve_estimate - latest.disapprove_estimate,
            asOf: parseDate(latest.date),
            source: 'FiveThirtyEight',
          });
          logger.debug(`538 Trump approval: ${latest.approve_estimate.toFixed(1)}%`);
        }
      }
    }
  } catch (error) {
    logger.debug(`538 Trump approval fetch error: ${error}`);
  }

  // Fetch generic ballot
  try {
    const response = await fetch(FIVETHIRTYEIGHT_URLS.genericBallotAvg, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/4.0)' },
    });

    if (response.ok) {
      const data = await response.json() as FiveThirtyEightAverage[];

      if (Array.isArray(data) && data.length > 0) {
        const latestDate = data.reduce((max, d) => d.date > max ? d.date : max, '');
        const latestData = data.filter(d => d.date === latestDate);

        const candidates: Record<string, number> = {};
        for (const entry of latestData) {
          candidates[entry.candidate] = entry.pct_estimate;
        }

        const sorted = getSortedCandidates(candidates);
        const leader = sorted[0]?.[0] ?? '';
        const spread = sorted.length >= 2 ? sorted[0][1] - sorted[1][1] : 0;

        genericBallot = {
          race: 'Generic Congressional Ballot',
          raceType: 'house',
          asOf: parseDate(latestDate),
          candidates,
          spread,
          leader,
          source: 'FiveThirtyEight',
        };
        logger.debug(`538 generic ballot: ${leader} +${spread.toFixed(1)}`);
      }
    }
  } catch (error) {
    logger.debug(`538 generic ballot fetch error: ${error}`);
  }

  if (approvalRatings.length === 0 && !genericBallot) {
    return null;
  }

  return { approvalRatings, genericBallot };
}

// =============================================================================
// RCP FETCHER
// =============================================================================

async function fetchRCPData(): Promise<{ approvalRatings?: ApprovalRating[] } | null> {
  const approvalRatings: ApprovalRating[] = [];

  try {
    const response = await fetch(RCP_URLS.trumpApproval, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (response.ok) {
      const html = await response.text();

      const approveMatch = html.match(/(?:Approve|Approval)[:\s]*(\d+\.?\d*)\s*%?/i);
      const disapproveMatch = html.match(/(?:Disapprove|Disapproval)[:\s]*(\d+\.?\d*)\s*%?/i);

      if (approveMatch && disapproveMatch) {
        const approve = parseFloat(approveMatch[1]);
        const disapprove = parseFloat(disapproveMatch[1]);

        approvalRatings.push({
          politician: 'Donald Trump',
          office: 'President',
          approve,
          disapprove,
          netApproval: approve - disapprove,
          asOf: new Date().toISOString().split('T')[0],
          source: 'RealClearPolitics',
        });
        logger.debug(`RCP Trump approval: ${approve}%`);
      }
    }
  } catch (error) {
    logger.debug(`RCP approval fetch error: ${error}`);
  }

  if (approvalRatings.length === 0) {
    return null;
  }

  return { approvalRatings };
}

// =============================================================================
// EDGE ANALYSIS HELPERS
// =============================================================================

export interface PollingEdgeSignal {
  candidate: string;
  pollingImplied: number;
  marketPrice: number;
  edge: number;
  direction: 'YES' | 'NO';
  confidence: number;
  reasoning: string;
}

export function comparePollingToMarket(
  polling: PollingData,
  marketPrices: Record<string, number>
): PollingEdgeSignal[] {
  const edges: PollingEdgeSignal[] = [];

  // Use approval ratings to estimate probability for approval markets
  for (const rating of polling.approvalRatings) {
    const marketKey = findMarketKey(rating.politician, marketPrices);
    if (!marketKey) continue;

    const marketPrice = marketPrices[marketKey];
    // Approval > 50% implies more likely to win re-election, etc.
    const impliedProb = rating.approve / 100;
    const edge = impliedProb - marketPrice;

    if (Math.abs(edge) >= 0.03) {
      edges.push({
        candidate: rating.politician,
        pollingImplied: impliedProb * 100,
        marketPrice: marketPrice * 100,
        edge: Math.abs(edge) * 100,
        direction: edge > 0 ? 'YES' : 'NO',
        confidence: Math.min(0.85, 0.5 + polling.sources.length * 0.1),
        reasoning: `${rating.politician} approval at ${rating.approve.toFixed(1)}% (${rating.source})`,
      });
    }
  }

  return edges.sort((a, b) => b.edge - a.edge);
}

function findMarketKey(candidate: string, prices: Record<string, number>): string | null {
  const candidateLower = candidate.toLowerCase();
  for (const key of Object.keys(prices)) {
    if (key.toLowerCase().includes(candidateLower) ||
        candidateLower.includes(key.toLowerCase())) {
      return key;
    }
  }
  return null;
}

// =============================================================================
// UTILITIES
// =============================================================================

function getSortedCandidates(candidates: Record<string, number>): [string, number][] {
  return Object.entries(candidates).sort((a, b) => b[1] - a[1]);
}

function parseDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Fall through
  }
  return new Date().toISOString().split('T')[0];
}
