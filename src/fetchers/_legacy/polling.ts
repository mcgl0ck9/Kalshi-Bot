/**
 * Political Polling Aggregator
 *
 * Fetches and aggregates polling data from multiple sources:
 * - FiveThirtyEight (538) - Nate Silver's original, now ABC-owned
 * - RealClearPolitics (RCP) - Polling averages
 * - Silver Bulletin - Nate Silver's new Substack with models
 * - The Economist - Election forecasts
 * - Race to the WH - Aggregated state-level data
 *
 * Integrates with existing RSS feeds for sentiment enrichment.
 */

import { logger } from '../../utils/index.js';
import { fetchWithFallback, createSource, type FetchResult } from '../../utils/resilient-fetch.js';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Sort candidates by percentage descending and return as array
 */
function getSortedCandidates(candidates: Record<string, number>): [string, number][] {
  return Object.entries(candidates).sort((a, b) => b[1] - a[1]);
}

// =============================================================================
// TYPES
// =============================================================================

export interface PollResult {
  pollster: string;
  date: string;
  sampleSize?: number;
  marginOfError?: number;
  population: 'lv' | 'rv' | 'a';  // Likely voters, Registered voters, Adults
  candidates: Record<string, number>;  // candidate name -> percentage
  spread?: number;  // leader's margin
  leader?: string;
}

export interface PollingAverage {
  race: string;
  raceType: 'president' | 'senate' | 'house' | 'governor' | 'primary' | 'approval';
  state?: string;  // undefined = national
  asOf: string;
  candidates: Record<string, number>;
  spread: number;
  leader: string;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    change7d?: number;
    change30d?: number;
  };
  source: string;
  recentPolls?: PollResult[];
}

export interface ElectionForecast {
  race: string;
  state?: string;
  asOf: string;
  candidates: Record<string, number>;  // candidate -> win probability
  favorite: string;
  favoriteOdds: number;
  tippingPoint?: number;  // For state-level: probability of being decisive
  source: string;
  modelType: 'polls-only' | 'polls-plus' | 'fundamentals' | 'ensemble';
}

export interface ApprovalRating {
  politician: string;
  office: string;
  approve: number;
  disapprove: number;
  netApproval: number;
  asOf: string;
  trend?: {
    change7d?: number;
    change30d?: number;
  };
  source: string;
}

export interface PollingData {
  presidentialAverage?: PollingAverage;
  stateAverages?: PollingAverage[];
  senateRaces?: PollingAverage[];
  governorRaces?: PollingAverage[];
  forecasts?: ElectionForecast[];
  approvalRatings?: ApprovalRating[];
  genericBallot?: PollingAverage;
  lastUpdated: string;
  sources: string[];
}

// =============================================================================
// SCRAPING UTILITIES
// =============================================================================

/**
 * Extract numbers from text (e.g., "45.2%" -> 45.2)
 */
function parsePercentage(text: string): number | null {
  const match = text.match(/([\d.]+)\s*%?/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Parse date strings in various formats
 */
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

// =============================================================================
// 538 (FIVETHIRTYEIGHT)
// =============================================================================

// 2025+ polling focuses on approval ratings and generic ballot (no presidential election)
const FIVETHIRTYEIGHT_URLS = {
  // Trump approval rating (active as of Jan 2025)
  trumpApproval: 'https://projects.fivethirtyeight.com/polls/approval/donald-trump/polls.json',
  trumpApprovalAvg: 'https://projects.fivethirtyeight.com/polls/approval/donald-trump/polling-average.json',
  // Generic congressional ballot for 2026 midterms
  genericBallot: 'https://projects.fivethirtyeight.com/polls/generic-ballot/polls.json',
  genericBallotAvg: 'https://projects.fivethirtyeight.com/polls/generic-ballot/polling-average.json',
  // State gubernatorial races (NJ, VA in 2025)
  governorNJ: 'https://projects.fivethirtyeight.com/polls/governor/2025/new-jersey/polls.json',
  governorVA: 'https://projects.fivethirtyeight.com/polls/governor/2025/virginia/polls.json',
  // Legacy 2024 (for historical reference)
  president2024: 'https://projects.fivethirtyeight.com/polls/president-general/2024/national/polling-average.json',
};

interface FiveThirtyEightPoll {
  poll_id: number;
  pollster: string;
  display_name: string;
  end_date: string;
  sample_size?: number;
  population?: string;
  answers: Array<{
    choice: string;
    pct: number;
  }>;
}

interface FiveThirtyEightAverage {
  date: string;
  candidate: string;
  pct_estimate: number;
  pct_trend_adjusted: number;
}

interface FiveThirtyEightApproval {
  date: string;
  subgroup: string;
  approve_estimate: number;
  disapprove_estimate: number;
}

/**
 * Fetch polling data from FiveThirtyEight
 * 2025+: Focuses on Trump approval and generic ballot
 */
async function fetch538Data(): Promise<Partial<PollingData> | null> {
  const approvalRatings: ApprovalRating[] = [];
  let genericBallot: PollingAverage | undefined;

  // Fetch Trump approval rating
  try {
    const response = await fetch(FIVETHIRTYEIGHT_URLS.trumpApprovalAvg, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)' },
    });

    if (response.ok) {
      const data = await response.json() as FiveThirtyEightApproval[];

      if (Array.isArray(data) && data.length > 0) {
        // Get most recent "All polls" entry
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
          logger.debug(`538 Trump approval: ${latest.approve_estimate.toFixed(1)}% approve`);
        }
      }
    }
  } catch (error) {
    logger.debug(`538 Trump approval fetch error: ${error}`);
  }

  // Fetch generic ballot
  try {
    const response = await fetch(FIVETHIRTYEIGHT_URLS.genericBallotAvg, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)' },
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

  return {
    approvalRatings: approvalRatings.length > 0 ? approvalRatings : undefined,
    genericBallot,
    sources: ['FiveThirtyEight'],
    lastUpdated: new Date().toISOString(),
  };
}

// =============================================================================
// REALCLEARPOLITICS
// =============================================================================

// 2025+ RCP URLs - approval ratings and generic ballot
const RCP_URLS = {
  trumpApproval: 'https://www.realclearpolling.com/polls/approval/donald-trump',
  genericBallot: 'https://www.realclearpolling.com/polls/other/generic-congressional-vote',
  senateOverview: 'https://www.realclearpolling.com/elections/senate/2026',
  // 2025 gubernatorial races
  governorNJ: 'https://www.realclearpolling.com/elections/governor/2025/new-jersey',
  governorVA: 'https://www.realclearpolling.com/elections/governor/2025/virginia',
};

/**
 * Fetch polling averages from RealClearPolitics
 * 2025+: Focuses on Trump approval rating
 * Note: RCP doesn't have a public API, so we scrape the page
 */
async function fetchRCPData(): Promise<Partial<PollingData> | null> {
  const approvalRatings: ApprovalRating[] = [];

  // Fetch Trump approval
  try {
    const response = await fetch(RCP_URLS.trumpApproval, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (response.ok) {
      const html = await response.text();

      // Look for approval/disapproval percentages
      // RCP format varies, try multiple patterns
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
        logger.debug(`RCP Trump approval: ${approve}% approve, ${disapprove}% disapprove`);
      }
    }
  } catch (error) {
    logger.debug(`RCP approval fetch error: ${error}`);
  }

  if (approvalRatings.length === 0) {
    return null;
  }

  return {
    approvalRatings,
    sources: ['RealClearPolitics'],
    lastUpdated: new Date().toISOString(),
  };
}

// =============================================================================
// SILVER BULLETIN (Nate Silver's Substack)
// =============================================================================

const SILVER_BULLETIN_URL = 'https://www.natesilver.net/';

/**
 * Fetch forecast data from Silver Bulletin
 * Note: Most data is behind paywall, but headlines/summaries are useful
 */
async function fetchSilverBulletinData(): Promise<Partial<PollingData> | null> {
  try {
    const response = await fetch(SILVER_BULLETIN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      logger.debug(`Silver Bulletin fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Look for forecast probabilities in the content
    // Nate often posts win probabilities like "Trump 52%, Harris 48%"
    const forecasts: ElectionForecast[] = [];

    // Try to extract win probabilities
    const trumpWinMatch = html.match(/Trump[:\s]*(\d+\.?\d*)%?\s*(?:chance|odds|probability)/i);
    const harrisWinMatch = html.match(/Harris[:\s]*(\d+\.?\d*)%?\s*(?:chance|odds|probability)/i);

    if (trumpWinMatch || harrisWinMatch) {
      const candidates: Record<string, number> = {};

      if (trumpWinMatch) {
        candidates['Trump'] = parseFloat(trumpWinMatch[1]);
      }
      if (harrisWinMatch) {
        candidates['Harris'] = parseFloat(harrisWinMatch[1]);
      }

      // If we only have one, estimate the other
      if (Object.keys(candidates).length === 1) {
        const [name, prob] = Object.entries(candidates)[0];
        const other = name === 'Trump' ? 'Harris' : 'Trump';
        candidates[other] = 100 - prob;
      }

      const sorted = getSortedCandidates(candidates);

      forecasts.push({
        race: 'President 2024',
        asOf: new Date().toISOString().split('T')[0],
        candidates,
        favorite: sorted[0][0],
        favoriteOdds: sorted[0][1],
        source: 'Silver Bulletin',
        modelType: 'ensemble',
      });
    }

    if (forecasts.length === 0) {
      return null;
    }

    return {
      forecasts,
      sources: ['Silver Bulletin'],
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.debug(`Silver Bulletin fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// THE ECONOMIST
// =============================================================================

const ECONOMIST_FORECAST_URL = 'https://www.economist.com/interactive/us-2024-election/prediction-model/president';

/**
 * Fetch forecast from The Economist
 */
async function fetchEconomistData(): Promise<Partial<PollingData> | null> {
  try {
    const response = await fetch(ECONOMIST_FORECAST_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      logger.debug(`Economist fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Look for win probability patterns
    const forecasts: ElectionForecast[] = [];

    // Try to find probabilities in the page
    const demWinMatch = html.match(/Democrats?[:\s]*(\d+)[:\s]*(?:in|%)/i);
    const repWinMatch = html.match(/Republicans?[:\s]*(\d+)[:\s]*(?:in|%)/i);

    // Also try percentage patterns
    const demPctMatch = html.match(/Harris[:\s]*(\d+\.?\d*)\s*%/i);
    const repPctMatch = html.match(/Trump[:\s]*(\d+\.?\d*)\s*%/i);

    const candidates: Record<string, number> = {};

    if (demPctMatch) {
      candidates['Harris'] = parseFloat(demPctMatch[1]);
    }
    if (repPctMatch) {
      candidates['Trump'] = parseFloat(repPctMatch[1]);
    }

    if (Object.keys(candidates).length >= 2) {
      const sorted = getSortedCandidates(candidates);

      forecasts.push({
        race: 'President 2024',
        asOf: new Date().toISOString().split('T')[0],
        candidates,
        favorite: sorted[0][0],
        favoriteOdds: sorted[0][1],
        source: 'The Economist',
        modelType: 'ensemble',
      });
    }

    if (forecasts.length === 0) {
      return null;
    }

    return {
      forecasts,
      sources: ['The Economist'],
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    logger.debug(`Economist fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// AGGREGATED POLLING FETCH
// =============================================================================

/**
 * Fetch polling data from all sources with fallback
 */
export async function fetchPollingData(): Promise<FetchResult<PollingData> | null> {
  const sources = [
    createSource('FiveThirtyEight', fetch538Data, 1),
    createSource('RealClearPolitics', fetchRCPData, 2),
    createSource('Silver Bulletin', fetchSilverBulletinData, 3),
    createSource('The Economist', fetchEconomistData, 4),
  ];

  // Try to get data from multiple sources and merge
  const results: Partial<PollingData>[] = [];
  const successfulSources: string[] = [];

  for (const source of sources) {
    try {
      const data = await source.fetch();
      if (data) {
        results.push(data);
        successfulSources.push(source.name);
        logger.debug(`Polling: ${source.name} succeeded`);
      }
    } catch (error) {
      logger.debug(`Polling: ${source.name} failed: ${error}`);
    }
  }

  if (results.length === 0) {
    // Expected between election cycles - 538 API endpoints deprecated
    // Don't log as error - polling is optional and often unavailable
    return null;
  }

  // Merge results, preferring earlier sources
  const merged: PollingData = {
    lastUpdated: new Date().toISOString(),
    sources: successfulSources,
  };

  for (const result of results) {
    if (result.presidentialAverage && !merged.presidentialAverage) {
      merged.presidentialAverage = result.presidentialAverage;
    }
    if (result.stateAverages) {
      merged.stateAverages = [...(merged.stateAverages ?? []), ...result.stateAverages];
    }
    if (result.senateRaces) {
      merged.senateRaces = [...(merged.senateRaces ?? []), ...result.senateRaces];
    }
    if (result.governorRaces) {
      merged.governorRaces = [...(merged.governorRaces ?? []), ...result.governorRaces];
    }
    if (result.forecasts) {
      merged.forecasts = [...(merged.forecasts ?? []), ...result.forecasts];
    }
    if (result.approvalRatings) {
      merged.approvalRatings = [...(merged.approvalRatings ?? []), ...result.approvalRatings];
    }
    if (result.genericBallot && !merged.genericBallot) {
      merged.genericBallot = result.genericBallot;
    }
  }

  return {
    data: merged,
    source: successfulSources.join(', '),
    fromCache: false,
    timestamp: Date.now(),
  };
}

/**
 * Fetch polling data with caching
 * Note: Polling sources (538, RCP) are often unavailable between election cycles
 * This function suppresses errors to avoid log noise during non-election periods
 */
export async function fetchPollingDataCached(): Promise<FetchResult<PollingData> | null> {
  try {
    // Try direct fetch first (bypasses error logging in fetchWithFallback)
    const directResult = await fetchPollingData();
    if (directResult) {
      return directResult;
    }
    // No data available - this is normal between election cycles
    return null;
  } catch {
    // Silently fail - polling is optional and often unavailable
    return null;
  }
}

// =============================================================================
// MARKET COMPARISON
// =============================================================================

/**
 * Compare polling data to prediction market prices
 * Returns edge opportunities where polls diverge from markets
 */
export function comparePollingToMarket(
  polling: PollingData,
  marketPrices: Record<string, number>  // candidate -> price (0-100)
): Array<{
  candidate: string;
  pollingAvg: number;
  pollingImplied: number;  // Converted to win probability
  marketPrice: number;
  edge: number;
  direction: 'buy' | 'sell';
  confidence: number;
  source: string;
}> {
  const edges: Array<{
    candidate: string;
    pollingAvg: number;
    pollingImplied: number;
    marketPrice: number;
    edge: number;
    direction: 'buy' | 'sell';
    confidence: number;
    source: string;
  }> = [];

  // Use forecast probabilities if available, otherwise estimate from polling average
  let impliedProbabilities: Record<string, number> = {};

  if (polling.forecasts && polling.forecasts.length > 0) {
    // Use forecast model probabilities
    const forecast = polling.forecasts[0];
    impliedProbabilities = forecast.candidates;
  } else if (polling.presidentialAverage) {
    // Estimate from polling average using simple heuristic
    // Polling lead -> win probability is non-linear
    const avg = polling.presidentialAverage;
    const spread = avg.spread;

    // Simple model: each point of polling lead ≈ 5-7% extra win probability
    // Capped at 95%
    const baseProb = 50;
    const spreadMultiplier = 6;  // 6% per polling point

    for (const [candidate, pct] of Object.entries(avg.candidates)) {
      const diff = pct - (100 - pct) / (Object.keys(avg.candidates).length - 1);
      const adjustedProb = Math.min(95, Math.max(5, baseProb + (diff * spreadMultiplier / 2)));
      impliedProbabilities[candidate] = adjustedProb;
    }
  }

  // Compare to market prices
  for (const [candidate, impliedProb] of Object.entries(impliedProbabilities)) {
    // Try to match candidate name to market prices
    const marketPrice = findMarketPrice(candidate, marketPrices);

    if (marketPrice !== null) {
      const edge = impliedProb - marketPrice;
      const absEdge = Math.abs(edge);

      if (absEdge >= 3) {  // 3% minimum edge to surface
        // Confidence based on how many sources agree
        const confidence = Math.min(0.85, 0.5 + (polling.sources.length * 0.1));

        edges.push({
          candidate,
          pollingAvg: polling.presidentialAverage?.candidates[candidate] ?? impliedProb,
          pollingImplied: impliedProb,
          marketPrice,
          edge: absEdge,
          direction: edge > 0 ? 'buy' : 'sell',
          confidence,
          source: polling.sources.join(', '),
        });
      }
    }
  }

  return edges.sort((a, b) => b.edge - a.edge);
}

/**
 * Try to match candidate name to market price keys
 */
function findMarketPrice(candidate: string, prices: Record<string, number>): number | null {
  const candidateLower = candidate.toLowerCase();

  // Direct match
  if (prices[candidate] !== undefined) return prices[candidate];
  if (prices[candidateLower] !== undefined) return prices[candidateLower];

  // Try common variations
  const variations = [
    candidate,
    candidateLower,
    `donald trump`,
    `trump`,
    `kamala harris`,
    `harris`,
    `joe biden`,
    `biden`,
  ];

  for (const variation of variations) {
    if (candidateLower.includes(variation) || variation.includes(candidateLower)) {
      for (const [key, value] of Object.entries(prices)) {
        if (key.toLowerCase().includes(variation) || variation.includes(key.toLowerCase())) {
          return value;
        }
      }
    }
  }

  return null;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format polling data for display
 */
export function formatPollingData(polling: PollingData): string {
  const lines: string[] = ['**📊 Polling Update**\n'];

  if (polling.presidentialAverage) {
    const avg = polling.presidentialAverage;
    lines.push(`**${avg.race}** (${avg.source})`);

    const sortedCandidates = Object.entries(avg.candidates)
      .sort((a, b) => b[1] - a[1]);

    for (const [candidate, pct] of sortedCandidates) {
      const isLeader = candidate === avg.leader;
      const icon = isLeader ? '🥇' : '🥈';
      lines.push(`${icon} ${candidate}: ${pct.toFixed(1)}%`);
    }

    lines.push(`📈 Spread: ${avg.leader} +${avg.spread.toFixed(1)}`);
    lines.push('');
  }

  if (polling.forecasts && polling.forecasts.length > 0) {
    lines.push('**🎯 Win Probabilities**');
    for (const forecast of polling.forecasts) {
      const sortedCandidates = Object.entries(forecast.candidates)
        .sort((a, b) => b[1] - a[1]);

      lines.push(`_${forecast.source}:_`);
      for (const [candidate, prob] of sortedCandidates) {
        lines.push(`  ${candidate}: ${prob.toFixed(0)}%`);
      }
    }
    lines.push('');
  }

  if (polling.approvalRatings && polling.approvalRatings.length > 0) {
    lines.push('**👍 Approval Ratings**');
    for (const approval of polling.approvalRatings) {
      lines.push(`${approval.politician}: ${approval.approve}% approve, ${approval.disapprove}% disapprove (Net: ${approval.netApproval > 0 ? '+' : ''}${approval.netApproval})`);
    }
    lines.push('');
  }

  lines.push(`_Sources: ${polling.sources.join(', ')}_`);
  lines.push(`_Updated: ${new Date(polling.lastUpdated).toLocaleString()}_`);

  return lines.join('\n');
}

/**
 * Format polling edge for Discord alert
 */
export function formatPollingEdge(edge: {
  candidate: string;
  pollingImplied: number;
  marketPrice: number;
  edge: number;
  direction: 'buy' | 'sell';
  source: string;
}): string {
  const action = edge.direction === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const lines = [
    `**Polling Edge Detected**`,
    '',
    `${action} ${edge.candidate.toUpperCase()}`,
    '',
    `📊 Polling Implied: ${edge.pollingImplied.toFixed(0)}%`,
    `💹 Market Price: ${edge.marketPrice.toFixed(0)}¢`,
    `📈 Edge: ${edge.edge.toFixed(1)}%`,
    '',
    `_Source: ${edge.source}_`,
  ];

  return lines.join('\n');
}

// =============================================================================
// INTEGRATION WITH RSS
// =============================================================================

export interface PoliticalSignal {
  type: 'polling' | 'news' | 'combined';
  candidate?: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;  // 0-1
  sources: string[];
  summary: string;
}

/**
 * Combine polling data with RSS news sentiment
 * for comprehensive political signal
 */
export function combinePollingWithNews(
  polling: PollingData,
  newsSentiment: Record<string, number>  // candidate -> sentiment score
): PoliticalSignal[] {
  const signals: PoliticalSignal[] = [];

  // Add polling signals
  if (polling.presidentialAverage) {
    const avg = polling.presidentialAverage;
    const trend = avg.trend;

    for (const [candidate, pct] of Object.entries(avg.candidates)) {
      let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let strength = 0.5;

      // Determine direction from trend
      if (trend) {
        if (trend.direction === 'up' && (trend.change7d ?? 0) > 0.5) {
          direction = 'bullish';
          strength = Math.min(0.8, 0.5 + (trend.change7d ?? 0) * 0.1);
        } else if (trend.direction === 'down' && (trend.change7d ?? 0) < -0.5) {
          direction = 'bearish';
          strength = Math.min(0.8, 0.5 + Math.abs(trend.change7d ?? 0) * 0.1);
        }
      }

      // Check if leading
      if (candidate === avg.leader && avg.spread > 3) {
        direction = 'bullish';
        strength = Math.min(0.9, strength + 0.1);
      }

      signals.push({
        type: 'polling',
        candidate,
        direction,
        strength,
        sources: [avg.source],
        summary: `${candidate} at ${pct.toFixed(1)}% (${avg.spread > 0 && candidate === avg.leader ? `+${avg.spread.toFixed(1)}` : ''})`,
      });
    }
  }

  // Combine with news sentiment
  for (const [candidate, sentiment] of Object.entries(newsSentiment)) {
    const pollingSignal = signals.find(s => s.candidate?.toLowerCase() === candidate.toLowerCase());

    if (pollingSignal) {
      // Combine signals
      const newsDirection: 'bullish' | 'bearish' | 'neutral' =
        sentiment > 0.1 ? 'bullish' : sentiment < -0.1 ? 'bearish' : 'neutral';

      if (newsDirection === pollingSignal.direction) {
        // Signals align - increase strength
        pollingSignal.strength = Math.min(0.95, pollingSignal.strength + 0.15);
        pollingSignal.type = 'combined';
        pollingSignal.sources.push('News Sentiment');
        pollingSignal.summary += ` | News: ${newsDirection}`;
      } else if (newsDirection !== 'neutral' && pollingSignal.direction !== 'neutral') {
        // Signals conflict - reduce strength
        pollingSignal.strength = Math.max(0.3, pollingSignal.strength - 0.1);
        pollingSignal.summary += ` | ⚠️ News: ${newsDirection} (conflicting)`;
      }
    } else {
      // News-only signal
      signals.push({
        type: 'news',
        candidate,
        direction: sentiment > 0.1 ? 'bullish' : sentiment < -0.1 ? 'bearish' : 'neutral',
        strength: Math.min(0.7, 0.4 + Math.abs(sentiment)),
        sources: ['News Sentiment'],
        summary: `News sentiment: ${sentiment > 0 ? '+' : ''}${sentiment.toFixed(2)}`,
      });
    }
  }

  return signals.sort((a, b) => b.strength - a.strength);
}
