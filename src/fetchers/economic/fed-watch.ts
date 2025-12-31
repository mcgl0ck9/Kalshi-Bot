/**
 * CME FedWatch Tool Fetcher
 *
 * Fetches Fed Funds futures-implied probabilities from CME FedWatch.
 * This is THE source for market-implied Fed rate expectations.
 *
 * Use cases:
 * - Compare to Kalshi Fed rate markets for arbitrage
 * - Track how rate expectations evolve
 * - Alert on significant probability shifts
 */

import { logger } from '../../utils/index.js';
import type {
  FedWatchData,
  FedMeetingProbabilities,
  FedRateProbability,
} from '../../types/index.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// FOMC meeting schedule (approximate - verify against Fed calendar)
const FOMC_MEETINGS_2025 = [
  { date: '2025-01-29', name: 'January 2025 FOMC' },
  { date: '2025-03-19', name: 'March 2025 FOMC' },
  { date: '2025-05-07', name: 'May 2025 FOMC' },
  { date: '2025-06-18', name: 'June 2025 FOMC' },
  { date: '2025-07-30', name: 'July 2025 FOMC' },
  { date: '2025-09-17', name: 'September 2025 FOMC' },
  { date: '2025-11-05', name: 'November 2025 FOMC' },
  { date: '2025-12-17', name: 'December 2025 FOMC' },
];

// Current Fed Funds rate (update as Fed changes rates)
const CURRENT_FED_RATE = 4.50; // As of late 2024

// Rate increments (Fed moves in 25bp increments)
const RATE_INCREMENT = 0.25;

// =============================================================================
// CME FEDWATCH SCRAPER
// =============================================================================

/**
 * Fetch FedWatch probabilities from CME website
 * Note: CME uses heavy JavaScript - this attempts to extract from embedded data
 */
export async function fetchFedWatch(): Promise<FedWatchData | null> {
  try {
    // CME FedWatch URL
    const url = 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
      },
    });

    if (!response.ok) {
      logger.warn(`FedWatch fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Try to extract JSON data embedded in the page
    const meetings = await parseFedWatchData(html);

    if (meetings.length === 0) {
      // Fallback to API endpoint if available
      return await fetchFedWatchAPI();
    }

    const nextMeeting = getNextMeeting(meetings);
    const yearEnd = meetings.find(m => m.meetingDate.includes('2025-12')) ?? null;

    return {
      currentRate: CURRENT_FED_RATE,
      meetings,
      nextMeeting,
      yearEndImpliedRate: yearEnd?.impliedRate ?? CURRENT_FED_RATE,
      totalCutsImplied: Math.round((CURRENT_FED_RATE - (yearEnd?.impliedRate ?? CURRENT_FED_RATE)) / RATE_INCREMENT),
      source: 'CME FedWatch',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`FedWatch fetch error: ${error}`);
    return null;
  }
}

/**
 * Try to fetch from CME's API endpoints
 */
async function fetchFedWatchAPI(): Promise<FedWatchData | null> {
  try {
    // CME has an API endpoint for FedWatch data
    const apiUrl = 'https://www.cmegroup.com/services/fed-funds-target-rate.json';

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`FedWatch API not accessible: ${response.status}`);
      return generateFallbackData();
    }

    const data = await response.json();
    return parseCMEApiResponse(data);
  } catch (error) {
    logger.debug(`FedWatch API error: ${error}`);
    return generateFallbackData();
  }
}

/**
 * Parse HTML for embedded FedWatch data
 */
async function parseFedWatchData(html: string): Promise<FedMeetingProbabilities[]> {
  const meetings: FedMeetingProbabilities[] = [];

  try {
    // Look for JSON data in script tags
    const jsonPattern = /"targetRateProbabilities":\s*(\[[^\]]+\])/;
    const match = html.match(jsonPattern);

    if (match) {
      const probData = JSON.parse(match[1]);
      // Parse the probability data structure
      for (const meeting of probData) {
        const probs = parseMeetingProbabilities(meeting);
        if (probs) {
          meetings.push(probs);
        }
      }
    }

    // Alternative: Look for table data
    if (meetings.length === 0) {
      const tablePattern = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d+\.?\d*%)<\/td>[\s\S]*?<\/tr>/gi;
      let tableMatch;
      while ((tableMatch = tablePattern.exec(html)) !== null) {
        // Extract probability percentages
        const pct = parseFloat(tableMatch[1]);
        if (!isNaN(pct)) {
          logger.debug(`Found rate probability: ${pct}%`);
        }
      }
    }
  } catch (error) {
    logger.debug(`FedWatch HTML parse error: ${error}`);
  }

  return meetings;
}

/**
 * Parse individual meeting probability data
 */
function parseMeetingProbabilities(data: Record<string, unknown>): FedMeetingProbabilities | null {
  try {
    const meetingDate = String(data.meetingDate ?? data.date ?? '');
    const meetingName = String(data.meetingName ?? data.name ?? meetingDate);

    const probabilities: FedRateProbability[] = [];
    let impliedRate = CURRENT_FED_RATE;
    let totalWeight = 0;

    // Parse rate probabilities
    const rateProbs = (data.probabilities ?? data.rates ?? []) as Array<{
      rate?: number;
      probability?: number;
      prob?: number;
    }>;

    for (const rp of rateProbs) {
      const rate = rp.rate ?? 0;
      const prob = (rp.probability ?? rp.prob ?? 0) / 100; // Convert % to decimal

      probabilities.push({ rate, probability: prob });
      impliedRate += rate * prob;
      totalWeight += prob;
    }

    if (totalWeight > 0) {
      impliedRate = impliedRate / totalWeight;
    }

    // Calculate cut/hold/hike probabilities
    let probCut = 0;
    let probHold = 0;
    let probHike = 0;

    for (const p of probabilities) {
      if (p.rate < CURRENT_FED_RATE) probCut += p.probability;
      else if (p.rate === CURRENT_FED_RATE) probHold += p.probability;
      else probHike += p.probability;
    }

    return {
      meetingDate,
      meetingName,
      currentRate: CURRENT_FED_RATE,
      probabilities,
      impliedRate,
      impliedCut: Math.round((CURRENT_FED_RATE - impliedRate) * 100), // In bps
      probCut,
      probHold,
      probHike,
      source: 'CME FedWatch',
      sourceUrl: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Parse CME API response
 */
function parseCMEApiResponse(data: unknown): FedWatchData | null {
  try {
    const meetings: FedMeetingProbabilities[] = [];

    // CME API structure varies - adapt as needed
    const apiData = data as {
      meetings?: Array<Record<string, unknown>>;
      probabilities?: Array<Record<string, unknown>>;
    };

    const rawMeetings = apiData.meetings ?? apiData.probabilities ?? [];

    for (const meeting of rawMeetings) {
      const parsed = parseMeetingProbabilities(meeting);
      if (parsed) {
        meetings.push(parsed);
      }
    }

    if (meetings.length === 0) {
      return generateFallbackData();
    }

    const nextMeeting = getNextMeeting(meetings);
    const yearEnd = meetings[meetings.length - 1];

    return {
      currentRate: CURRENT_FED_RATE,
      meetings,
      nextMeeting,
      yearEndImpliedRate: yearEnd?.impliedRate ?? CURRENT_FED_RATE,
      totalCutsImplied: Math.round((CURRENT_FED_RATE - (yearEnd?.impliedRate ?? CURRENT_FED_RATE)) / RATE_INCREMENT),
      source: 'CME FedWatch API',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`CME API parse error: ${error}`);
    return generateFallbackData();
  }
}

/**
 * Generate fallback data with manual input
 * Use this when scraping fails - update manually from FedWatch website
 */
function generateFallbackData(): FedWatchData {
  // Placeholder probabilities - update from actual FedWatch data
  const meetings: FedMeetingProbabilities[] = FOMC_MEETINGS_2025.map((meeting, idx) => {
    // Assume market expects gradual cuts
    const expectedCuts = Math.min(idx, 4); // Max 4 cuts by year end
    const impliedRate = CURRENT_FED_RATE - (expectedCuts * RATE_INCREMENT);

    return {
      meetingDate: meeting.date,
      meetingName: meeting.name,
      currentRate: CURRENT_FED_RATE,
      probabilities: [
        { rate: impliedRate - 0.25, probability: 0.1 },
        { rate: impliedRate, probability: 0.7 },
        { rate: impliedRate + 0.25, probability: 0.2 },
      ],
      impliedRate,
      impliedCut: expectedCuts * 25,
      probCut: idx > 0 ? 0.6 : 0.2,
      probHold: 0.3,
      probHike: 0.1,
      source: 'FedWatch Fallback (manual update needed)',
      sourceUrl: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
      fetchedAt: new Date().toISOString(),
    };
  });

  return {
    currentRate: CURRENT_FED_RATE,
    meetings,
    nextMeeting: meetings[0] ?? null,
    yearEndImpliedRate: meetings[meetings.length - 1]?.impliedRate ?? CURRENT_FED_RATE,
    totalCutsImplied: 4, // Placeholder
    source: 'FedWatch Fallback',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get the next upcoming FOMC meeting
 */
function getNextMeeting(meetings: FedMeetingProbabilities[]): FedMeetingProbabilities | null {
  const now = new Date();

  for (const meeting of meetings) {
    const meetingDate = new Date(meeting.meetingDate);
    if (meetingDate > now) {
      return meeting;
    }
  }

  return meetings[0] ?? null;
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Compare FedWatch probabilities to Kalshi market prices
 */
export function compareFedWatchToKalshi(
  fedWatch: FedWatchData,
  kalshiPrice: number,
  kalshiMarketType: 'cut' | 'hike' | 'hold'
): {
  fedWatchProb: number;
  kalshiPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no' | 'hold';
  confidence: number;
} {
  const nextMeeting = fedWatch.nextMeeting;
  if (!nextMeeting) {
    return {
      fedWatchProb: 0.5,
      kalshiPrice,
      edge: 0,
      direction: 'hold',
      confidence: 0,
    };
  }

  // Get FedWatch probability for the market type
  let fedWatchProb: number;
  switch (kalshiMarketType) {
    case 'cut':
      fedWatchProb = nextMeeting.probCut;
      break;
    case 'hike':
      fedWatchProb = nextMeeting.probHike;
      break;
    case 'hold':
      fedWatchProb = nextMeeting.probHold;
      break;
  }

  const edge = fedWatchProb - kalshiPrice;
  const absEdge = Math.abs(edge);

  // Determine direction
  let direction: 'buy_yes' | 'buy_no' | 'hold';
  if (absEdge < 0.03) {
    direction = 'hold';
  } else if (edge > 0) {
    direction = 'buy_yes';
  } else {
    direction = 'buy_no';
  }

  // Confidence based on how reliable FedWatch is (very high - it's derived from actual futures)
  const confidence = absEdge > 0.05 ? 0.9 : absEdge > 0.03 ? 0.7 : 0.5;

  return {
    fedWatchProb,
    kalshiPrice,
    edge,
    direction,
    confidence,
  };
}

/**
 * Format FedWatch data for display
 */
export function formatFedWatchReport(data: FedWatchData): string {
  const lines: string[] = [
    '**📊 Fed Rate Expectations (CME FedWatch)**',
    '',
    `Current Rate: ${data.currentRate.toFixed(2)}%`,
    `Year-End Implied: ${data.yearEndImpliedRate.toFixed(2)}%`,
    `Implied Cuts: ${data.totalCutsImplied} (${(data.totalCutsImplied * 25)}bp)`,
    '',
  ];

  if (data.nextMeeting) {
    const next = data.nextMeeting;
    lines.push('**Next Meeting:**');
    lines.push(`${next.meetingName} (${next.meetingDate})`);
    lines.push(`Cut: ${(next.probCut * 100).toFixed(0)}% | Hold: ${(next.probHold * 100).toFixed(0)}% | Hike: ${(next.probHike * 100).toFixed(0)}%`);
    lines.push('');
  }

  // Show upcoming meetings
  lines.push('**Upcoming Meetings:**');
  for (const meeting of data.meetings.slice(0, 4)) {
    const cutPct = (meeting.probCut * 100).toFixed(0);
    const impliedStr = meeting.impliedRate.toFixed(2);
    lines.push(`${meeting.meetingName.split(' ')[0]}: ${cutPct}% cut prob, implied ${impliedStr}%`);
  }

  return lines.join('\n');
}

/**
 * Detect significant shifts in Fed expectations
 */
export function detectFedShift(
  current: FedWatchData,
  previous: FedWatchData,
  thresholdPct: number = 10
): {
  hasShift: boolean;
  direction: 'more_dovish' | 'more_hawkish' | 'unchanged';
  magnitude: number;
  description: string;
} | null {
  if (!current.nextMeeting || !previous.nextMeeting) {
    return null;
  }

  const cutShift = current.nextMeeting.probCut - previous.nextMeeting.probCut;
  const absShift = Math.abs(cutShift) * 100;

  if (absShift < thresholdPct) {
    return {
      hasShift: false,
      direction: 'unchanged',
      magnitude: absShift,
      description: 'No significant shift in Fed expectations',
    };
  }

  const direction = cutShift > 0 ? 'more_dovish' : 'more_hawkish';
  const description = cutShift > 0
    ? `Rate cut probability increased by ${absShift.toFixed(0)}%`
    : `Rate cut probability decreased by ${absShift.toFixed(0)}%`;

  return {
    hasShift: true,
    direction,
    magnitude: absShift,
    description,
  };
}
