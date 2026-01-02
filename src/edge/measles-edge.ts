/**
 * Measles Edge Detection
 *
 * Compares CDC measles case data to Kalshi market thresholds to find edges.
 *
 * Edge thesis: CDC publishes weekly case counts. The market may:
 * 1. Underreact to current trajectory (if cases are accelerating)
 * 2. Overreact to recent news (if outbreak is contained)
 * 3. Misprice thresholds based on historical averages vs current data
 */

import { logger } from '../utils/index.js';
import { kalshiFetchJson } from '../utils/kalshi-auth.js';
import {
  fetchMeaslesCases,
  calculateExceedanceProbability,
  type MeaslesData,
} from '../fetchers/cdc-measles.js';
import type { Market } from '../types/index.js';
import { EDGE_THRESHOLDS } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MeaslesEdge {
  market: Market;
  ticker: string;
  threshold: number;
  year: number;

  // Current data
  currentCases: number;
  projectedYearEnd: number;
  weekNumber: number;

  // Edge calculation
  kalshiPrice: number;
  cdcImpliedPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;

  // Signal strength
  signalStrength: 'critical' | 'actionable' | 'watchlist';
  reasoning: string;
}

// =============================================================================
// MAIN DETECTION
// =============================================================================

/**
 * Detect edges in measles markets
 */
export async function detectMeaslesEdges(): Promise<MeaslesEdge[]> {
  const edges: MeaslesEdge[] = [];

  // Fetch current CDC data
  const measlesData = await fetchMeaslesCases();
  if (!measlesData) {
    logger.warn('Could not fetch CDC measles data');
    return edges;
  }

  logger.info(`CDC Measles: ${measlesData.casesYTD} cases YTD (week ${measlesData.weekNumber}), projected ${measlesData.projectedYearEnd} year-end`);

  // Fetch measles markets from Kalshi
  const markets = await fetchMeaslesMarkets();
  if (markets.length === 0) {
    logger.debug('No active measles markets found');
    return edges;
  }

  logger.info(`Found ${markets.length} active measles markets`);

  // Analyze each market for edges
  for (const market of markets) {
    const edge = analyzeMeaslesMarket(market, measlesData);
    if (edge) {
      edges.push(edge);
    }
  }

  // Sort by edge magnitude
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  logger.info(`Found ${edges.length} measles market edges`);
  return edges;
}

/**
 * Fetch measles-related markets from Kalshi
 */
async function fetchMeaslesMarkets(): Promise<Market[]> {
  const markets: Market[] = [];
  const series = ['KXMEASLES', 'MEASLES', 'KXAVGMEASLESDJT'];

  for (const seriesTicker of series) {
    const data = await kalshiFetchJson<{ markets?: unknown[] }>(
      `/trade-api/v2/markets?series_ticker=${seriesTicker}&limit=50`
    );

    if (!data?.markets) continue;

    for (const m of data.markets) {
      const market = m as Record<string, unknown>;
      const status = market.status as string;

      if (status !== 'active') continue;

      const ticker = market.ticker as string;
      const title = market.title as string;
      const subtitle = market.subtitle as string ?? '';
      const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;

      markets.push({
        platform: 'kalshi',
        id: ticker,
        ticker,
        title: subtitle ? `${title} ${subtitle}` : title,
        description: market.rules_primary as string,
        category: 'other',
        price: yesPrice / 100,
        volume: (market.volume as number) ?? 0,
        volume24h: (market.volume_24h as number) ?? 0,
        liquidity: (market.open_interest as number) ?? 0,
        url: `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${ticker.toLowerCase()}`,
        closeTime: market.close_time as string,
      });
    }
  }

  return markets;
}

/**
 * Analyze a single measles market for edge
 */
function analyzeMeaslesMarket(
  market: Market,
  data: MeaslesData
): MeaslesEdge | null {
  const { ticker, title, price: kalshiPrice } = market;

  // Skip if no ticker
  if (!ticker) {
    return null;
  }

  // Parse threshold from ticker or title
  // Ticker format: KXMEASLES-26-1750 (year 26, threshold 1750)
  // Or title: "Will there be more than 1750 measles cases in 2026?"
  const parsed = parseThreshold(ticker, title);
  if (!parsed) {
    logger.debug(`Could not parse threshold from ${ticker}`);
    return null;
  }

  const { threshold, year } = parsed;

  // Check if this is for current or future year
  const currentYear = new Date().getFullYear();
  const yearFull = year < 100 ? 2000 + year : year;

  // Only analyze current year and next year
  if (yearFull < currentYear || yearFull > currentYear + 1) {
    return null;
  }

  // Calculate CDC-implied probability
  let cdcImpliedPrice: number;

  if (yearFull === currentYear) {
    // Current year - use actual YTD data
    const thresholdResult = calculateExceedanceProbability(data, threshold);
    cdcImpliedPrice = thresholdResult.probability;
  } else {
    // Future year - use historical average and variance
    cdcImpliedPrice = calculateFutureYearProbability(threshold, data);
  }

  // Calculate edge
  const edge = cdcImpliedPrice - kalshiPrice;
  const absEdge = Math.abs(edge);

  // Skip if edge is too small
  if (absEdge < EDGE_THRESHOLDS.minimum) {
    return null;
  }

  // CRITICAL: Require minimum confidence for large edges
  // Early in year (weeks 1-8), projections are unreliable
  // Don't generate 50%+ edge signals with <30% confidence
  if (absEdge > 0.50 && data.projectionConfidence < 0.30) {
    logger.debug(`Skipping ${ticker}: ${(absEdge * 100).toFixed(0)}% edge but only ${(data.projectionConfidence * 100).toFixed(0)}% confidence (week ${data.weekNumber})`);
    return null;
  }

  // For large edges (>30%), require at least 40% confidence
  if (absEdge > 0.30 && data.projectionConfidence < 0.40) {
    logger.debug(`Skipping ${ticker}: ${(absEdge * 100).toFixed(0)}% edge but only ${(data.projectionConfidence * 100).toFixed(0)}% confidence`);
    return null;
  }

  // Determine direction and signal strength
  const direction: 'buy_yes' | 'buy_no' = edge > 0 ? 'buy_yes' : 'buy_no';

  let signalStrength: 'critical' | 'actionable' | 'watchlist';
  if (absEdge >= EDGE_THRESHOLDS.critical) {
    signalStrength = 'critical';
  } else if (absEdge >= EDGE_THRESHOLDS.actionable) {
    signalStrength = 'actionable';
  } else {
    signalStrength = 'watchlist';
  }

  // Generate reasoning
  const reasoning = generateReasoning(
    direction,
    threshold,
    yearFull,
    data,
    kalshiPrice,
    cdcImpliedPrice
  );

  return {
    market,
    ticker,
    threshold,
    year: yearFull,
    currentCases: data.casesYTD,
    projectedYearEnd: data.projectedYearEnd,
    weekNumber: data.weekNumber,
    kalshiPrice,
    cdcImpliedPrice,
    edge,
    direction,
    confidence: data.projectionConfidence,
    signalStrength,
    reasoning,
  };
}

/**
 * Parse threshold and year from ticker or title
 */
function parseThreshold(
  ticker: string,
  title: string
): { threshold: number; year: number } | null {
  // Try ticker first: KXMEASLES-26-1750 or KXMEASLES-2531-2100
  const tickerMatch = ticker.match(/MEASLES-(\d+)-(\d+)/i);
  if (tickerMatch) {
    const yearPart = tickerMatch[1];
    const threshold = parseInt(tickerMatch[2], 10);

    // Year could be "26" or "2531" (week 31 of 2025)
    let year: number;
    if (yearPart.length === 2) {
      year = parseInt(yearPart, 10);
    } else if (yearPart.length === 4) {
      // Format: YYWW (year + week), extract year
      year = parseInt(yearPart.substring(0, 2), 10);
    } else {
      year = parseInt(yearPart, 10);
    }

    return { threshold, year };
  }

  // Try title: "Will there be more than 1750 measles cases in 2026?"
  const titleMatch = title.match(/more\s+than\s+(\d+)\s+measles\s+cases\s+in\s+20(\d{2})/i);
  if (titleMatch) {
    const threshold = parseInt(titleMatch[1], 10);
    const year = parseInt(titleMatch[2], 10);
    return { threshold, year };
  }

  // Try "Above X" subtitle
  const subtitleMatch = title.match(/Above\s+(\d+)/i);
  if (subtitleMatch) {
    const threshold = parseInt(subtitleMatch[1], 10);
    // Try to get year from rest of title
    const yearMatch = title.match(/20(\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 25;
    return { threshold, year };
  }

  return null;
}

/**
 * Calculate probability for future year based on historical data
 */
function calculateFutureYearProbability(
  threshold: number,
  data: MeaslesData
): number {
  // Use log-normal distribution based on historical data
  const { historicalAverage } = data;

  // Standard deviation roughly 150% of mean for measles (high variance)
  const stdDev = historicalAverage * 1.5;

  // Use log-normal approximation
  const logMean = Math.log(historicalAverage);
  const logStd = Math.log(1 + (stdDev / historicalAverage) ** 2) ** 0.5;

  // Probability of exceeding threshold
  const logThreshold = Math.log(threshold);
  const z = (logThreshold - logMean) / logStd;

  // Normal CDF
  const probability = 1 - normalCDF(z);

  return Math.max(0.01, Math.min(0.99, probability));
}

/**
 * Normal CDF approximation
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Generate human-readable reasoning for the edge
 */
function generateReasoning(
  direction: 'buy_yes' | 'buy_no',
  threshold: number,
  year: number,
  data: MeaslesData,
  kalshiPrice: number,
  cdcPrice: number
): string {
  const currentYear = new Date().getFullYear();

  if (year === currentYear) {
    if (data.casesYTD >= threshold) {
      return `Already exceeded: ${data.casesYTD} cases vs ${threshold} threshold. Market at ${(kalshiPrice * 100).toFixed(0)}¢ should be ~99¢.`;
    }

    const casesNeeded = threshold - data.casesYTD;
    const weeksLeft = 52 - data.weekNumber;

    // Early in year (weeks 1-8): probability based on historical data, not YTD projection
    if (data.weekNumber <= 8) {
      const baseline = Math.max(data.lastYearTotal, data.historicalAverage);
      if (direction === 'buy_yes') {
        return `Week ${data.weekNumber} of ${year}. Last year had ${data.lastYearTotal} cases. ` +
          `Based on historical patterns, ${(cdcPrice * 100).toFixed(0)}% chance of exceeding ${threshold}. ` +
          `Kalshi at ${(kalshiPrice * 100).toFixed(0)}¢.`;
      } else {
        return `Week ${data.weekNumber} of ${year}. Last year: ${data.lastYearTotal} cases, threshold: ${threshold}. ` +
          `Market at ${(kalshiPrice * 100).toFixed(0)}¢ overstates probability vs ${(cdcPrice * 100).toFixed(0)}% historical.`;
      }
    }

    const avgWeekly = data.casesYTD / data.weekNumber;

    if (direction === 'buy_yes') {
      return `Current: ${data.casesYTD} cases (wk ${data.weekNumber}). Need ${casesNeeded} more to exceed ${threshold}. ` +
        `At ${avgWeekly.toFixed(0)}/wk rate, projected ${data.projectedYearEnd}. ` +
        `CDC implies ${(cdcPrice * 100).toFixed(0)}¢ vs Kalshi ${(kalshiPrice * 100).toFixed(0)}¢.`;
    } else {
      return `Current: ${data.casesYTD} cases. ${weeksLeft} weeks left, need ${casesNeeded} more for ${threshold}. ` +
        `Historical suggests slower late-year spread. Market overpricing probability.`;
    }
  } else {
    // Future year
    return `${year} projection: Historical avg ${data.historicalAverage} cases. ` +
      `Threshold ${threshold} has ${(cdcPrice * 100).toFixed(0)}% historical probability. ` +
      `Kalshi at ${(kalshiPrice * 100).toFixed(0)}¢.`;
  }
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format measles edge for Discord
 */
export function formatMeaslesEdge(edge: MeaslesEdge): string {
  const actionEmoji = edge.direction === 'buy_yes' ? '🟢' : '🔴';
  const strengthEmoji = edge.signalStrength === 'critical' ? '🔴' :
                        edge.signalStrength === 'actionable' ? '🟡' : '🟢';

  const lines = [
    `${strengthEmoji} **MEASLES EDGE** | ${actionEmoji} **${edge.direction.toUpperCase()}** @ ${(edge.kalshiPrice * 100).toFixed(0)}¢`,
    `${edge.market.title?.slice(0, 60)}`,
    `Edge: **+${(Math.abs(edge.edge) * 100).toFixed(1)}%** | CDC: ${(edge.cdcImpliedPrice * 100).toFixed(0)}¢ | Conf: ${(edge.confidence * 100).toFixed(0)}%`,
    `Cases: ${edge.currentCases} YTD (wk ${edge.weekNumber}) → ${edge.projectedYearEnd} projected`,
    edge.market.url ? `[Trade](${edge.market.url})` : '',
  ];

  return lines.filter(Boolean).join('\n');
}
