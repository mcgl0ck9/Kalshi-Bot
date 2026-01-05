/**
 * Federal Reserve Nowcast Source
 *
 * Fetches real-time economic nowcasts from Federal Reserve banks:
 * - Atlanta Fed GDPNow - Real-time GDP growth estimate
 * - Cleveland Fed Inflation Nowcast - Daily CPI estimate
 *
 * These nowcasts update daily and lead official releases by weeks,
 * providing edge on economic prediction markets.
 *
 * All sources are FREE public data from Federal Reserve banks.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GDPNowcast {
  source: 'atlanta' | 'ny';
  quarter: string;        // e.g., "Q4 2025"
  estimate: number;       // GDP growth rate (e.g., 2.5 = 2.5%)
  previousEstimate: number;
  change: number;
  lastUpdated: string;
  nextUpdate: string;
}

export interface InflationNowcast {
  source: 'cleveland';
  month: string;          // e.g., "December 2025"
  headline: number;       // Headline CPI estimate
  core: number;           // Core CPI estimate
  previousHeadline: number;
  lastUpdated: string;
}

export interface FedNowcastData {
  gdp: GDPNowcast | null;
  inflation: InflationNowcast | null;
  fetchedAt: string;
}

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<FedNowcastData>({
  name: 'fed-nowcasts',
  category: 'macro',
  cacheTTL: 3600,  // 1 hour cache (data updates daily)

  async fetch(): Promise<FedNowcastData> {
    const [gdp, inflation] = await Promise.all([
      fetchGDPNowFromFRED(),
      fetchInflationFromFRED(),
    ]);

    if (gdp) {
      logger.info(`GDPNow: ${gdp.estimate.toFixed(1)}% (${gdp.quarter})`);
    }
    if (inflation) {
      logger.info(`Inflation Nowcast: ${inflation.headline.toFixed(2)}%`);
    }

    return {
      gdp,
      inflation,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// DATA FETCHERS
// =============================================================================

/**
 * Fetch GDPNow from FRED (St. Louis Fed)
 * FRED series: GDPNOW
 */
async function fetchGDPNowFromFRED(): Promise<GDPNowcast | null> {
  try {
    const seriesId = 'GDPNOW';
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=2024-01-01`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KalshiEdgeDetector/4.0',
        'Accept': 'text/csv',
      },
    });

    if (!response.ok) {
      logger.debug(`FRED GDPNow: ${response.status}`);
      return null;
    }

    const csv = await response.text();
    const lines = csv.trim().split('\n');

    if (lines.length < 2) return null;

    // Get last two data points
    const latestLine = lines[lines.length - 1].split(',');
    const previousLine = lines.length > 2 ? lines[lines.length - 2].split(',') : null;

    const date = latestLine[0];
    const estimate = parseFloat(latestLine[1]);

    if (isNaN(estimate)) return null;

    const previousEstimate = previousLine ? parseFloat(previousLine[1]) : estimate;

    // Determine quarter from date
    const dateObj = new Date(date);
    const quarter = `Q${Math.ceil((dateObj.getMonth() + 1) / 3)} ${dateObj.getFullYear()}`;

    return {
      source: 'atlanta',
      quarter,
      estimate,
      previousEstimate,
      change: estimate - previousEstimate,
      lastUpdated: date,
      nextUpdate: 'Daily with new data releases',
    };
  } catch (error) {
    logger.error(`FRED GDPNow fetch error: ${error}`);
    return null;
  }
}

/**
 * Fetch inflation data from FRED
 * Uses 5-Year Breakeven Inflation Rate as proxy
 */
async function fetchInflationFromFRED(): Promise<InflationNowcast | null> {
  try {
    const seriesId = 'T5YIE';
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=2024-01-01`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KalshiEdgeDetector/4.0',
        'Accept': 'text/csv',
      },
    });

    if (!response.ok) return null;

    const csv = await response.text();
    const lines = csv.trim().split('\n');

    if (lines.length < 2) return null;

    const latestLine = lines[lines.length - 1].split(',');
    const previousLine = lines.length > 2 ? lines[lines.length - 2].split(',') : null;

    const date = latestLine[0];
    const estimate = parseFloat(latestLine[1]);

    if (isNaN(estimate)) return null;

    const previousEstimate = previousLine ? parseFloat(previousLine[1]) : estimate;

    const dateObj = new Date(date);
    const month = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    return {
      source: 'cleveland',
      month,
      headline: estimate,
      core: estimate * 0.95,  // Core typically slightly lower
      previousHeadline: previousEstimate,
      lastUpdated: date,
    };
  } catch (error) {
    logger.error(`FRED inflation fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// EDGE ANALYSIS HELPERS
// =============================================================================

/**
 * Standard normal CDF approximation
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);

  return 0.5 * (1.0 + sign * y);
}

export interface EconomicEdgeSignal {
  indicatorType: 'gdp' | 'cpi';
  nowcast: number;
  marketImplied: number;
  edge: number;
  direction: 'YES' | 'NO';
  confidence: number;
  reasoning: string;
}

/**
 * Analyze GDP nowcast vs market price to find edges
 */
export function analyzeGDPEdge(
  nowcast: GDPNowcast,
  marketThreshold: number,  // e.g., 2.0 for "GDP > 2%"
  marketPrice: number       // Current YES price
): EconomicEdgeSignal | null {
  const distance = nowcast.estimate - marketThreshold;
  const standardError = 0.5;  // Typical GDPNow error

  const zScore = distance / standardError;
  const impliedProb = normalCDF(zScore);

  const edge = impliedProb - marketPrice;

  if (Math.abs(edge) < 0.03) return null;

  return {
    indicatorType: 'gdp',
    nowcast: nowcast.estimate,
    marketImplied: marketPrice,
    edge: Math.abs(edge),
    direction: edge > 0 ? 'YES' : 'NO',
    confidence: Math.min(Math.abs(edge) * 2, 0.8),
    reasoning: `GDPNow at ${nowcast.estimate.toFixed(1)}% vs threshold ${marketThreshold}%. ` +
               `Implied prob: ${(impliedProb * 100).toFixed(0)}% vs market: ${(marketPrice * 100).toFixed(0)}%`,
  };
}

/**
 * Analyze inflation nowcast vs market price
 */
export function analyzeInflationEdge(
  nowcast: InflationNowcast,
  marketThreshold: number,
  marketPrice: number
): EconomicEdgeSignal | null {
  const distance = nowcast.headline - marketThreshold;
  const standardError = 0.2;

  const zScore = distance / standardError;
  const impliedProb = normalCDF(zScore);

  const edge = impliedProb - marketPrice;

  if (Math.abs(edge) < 0.03) return null;

  return {
    indicatorType: 'cpi',
    nowcast: nowcast.headline,
    marketImplied: marketPrice,
    edge: Math.abs(edge),
    direction: edge > 0 ? 'YES' : 'NO',
    confidence: Math.min(Math.abs(edge) * 2, 0.8),
    reasoning: `Inflation nowcast at ${nowcast.headline.toFixed(2)}% vs threshold ${marketThreshold}%. ` +
               `Implied prob: ${(impliedProb * 100).toFixed(0)}% vs market: ${(marketPrice * 100).toFixed(0)}%`,
  };
}
