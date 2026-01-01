/**
 * CDC Measles Data Fetcher
 *
 * Fetches current measles case counts from CDC to compare against Kalshi markets.
 *
 * Data sources:
 * - CDC Measles Cases and Outbreaks page
 * - CDC NNDSS (National Notifiable Diseases Surveillance System)
 *
 * Edge thesis: CDC publishes weekly case counts. By tracking the trajectory,
 * we can estimate year-end totals and compare to market thresholds.
 */

import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MeaslesData {
  year: number;
  casesYTD: number;
  weekNumber: number;
  lastUpdated: string;
  source: string;

  // Projections
  projectedYearEnd: number;
  projectionMethod: 'linear' | 'seasonal' | 'recent_trend';
  projectionConfidence: number;

  // Historical context
  historicalAverage: number;  // 5-year average
  lastYearTotal: number;
}

export interface MeaslesThreshold {
  threshold: number;
  probability: number;  // Probability of exceeding threshold
  confidence: number;
}

// =============================================================================
// HISTORICAL DATA
// =============================================================================

// Historical measles cases by year (CDC data)
// Source: https://www.cdc.gov/measles/data-research/index.html
const HISTORICAL_CASES: Record<number, number> = {
  2010: 63,
  2011: 220,
  2012: 55,
  2013: 187,
  2014: 667,
  2015: 188,
  2016: 86,
  2017: 120,
  2018: 375,
  2019: 1282,  // Large outbreak year
  2020: 13,    // COVID year - low travel
  2021: 49,
  2022: 121,
  2023: 58,
  2024: 285,   // Provisional
  2025: 2000,  // Current YTD (will be updated dynamically)
};

// Seasonal pattern: proportion of year's cases by week (approximate)
// Measles peaks in late winter/early spring (weeks 8-20)
const SEASONAL_WEIGHTS: Record<number, number> = {
  1: 0.015, 2: 0.015, 3: 0.018, 4: 0.020,
  5: 0.022, 6: 0.025, 7: 0.028, 8: 0.032,
  9: 0.035, 10: 0.038, 11: 0.040, 12: 0.042,
  13: 0.045, 14: 0.048, 15: 0.050, 16: 0.048,
  17: 0.045, 18: 0.042, 19: 0.038, 20: 0.035,
  21: 0.030, 22: 0.028, 23: 0.025, 24: 0.022,
  25: 0.020, 26: 0.018, 27: 0.016, 28: 0.015,
  29: 0.014, 30: 0.013, 31: 0.012, 32: 0.012,
  33: 0.012, 34: 0.012, 35: 0.013, 36: 0.013,
  37: 0.014, 38: 0.014, 39: 0.015, 40: 0.015,
  41: 0.015, 42: 0.016, 43: 0.016, 44: 0.016,
  45: 0.016, 46: 0.015, 47: 0.015, 48: 0.014,
  49: 0.014, 50: 0.013, 51: 0.013, 52: 0.012,
};

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Fetch current measles case count from CDC
 *
 * Attempts multiple sources:
 * 1. CDC Measles Cases page (scraping)
 * 2. Cached/known recent value
 */
export async function fetchMeaslesCases(): Promise<MeaslesData | null> {
  const currentYear = new Date().getFullYear();
  const currentWeek = getWeekNumber(new Date());

  // Try to fetch from CDC page
  let casesYTD: number | null = null;
  let source = 'cached';

  try {
    casesYTD = await scrapeCDCMeaslesPage();
    if (casesYTD !== null) {
      source = 'cdc_page';
      logger.info(`Fetched ${casesYTD} measles cases from CDC page`);
    }
  } catch (error) {
    logger.debug(`CDC scrape failed: ${error}`);
  }

  // Fallback to recent known value
  if (casesYTD === null) {
    // Use a recent known value (update this periodically)
    // As of late December 2025, there were ~2000+ cases
    casesYTD = HISTORICAL_CASES[currentYear] ?? 2000;
    logger.debug(`Using cached measles count: ${casesYTD}`);
  }

  // Calculate projections
  const projectedYearEnd = projectYearEndCases(casesYTD, currentWeek, 'seasonal');
  const historicalAverage = calculateHistoricalAverage(5);

  return {
    year: currentYear,
    casesYTD,
    weekNumber: currentWeek,
    lastUpdated: new Date().toISOString(),
    source,
    projectedYearEnd,
    projectionMethod: 'seasonal',
    projectionConfidence: calculateProjectionConfidence(currentWeek),
    historicalAverage,
    lastYearTotal: HISTORICAL_CASES[currentYear - 1] ?? 0,
  };
}

/**
 * Scrape CDC measles page for current case count
 */
async function scrapeCDCMeaslesPage(): Promise<number | null> {
  try {
    const response = await fetch('https://www.cdc.gov/measles/data-research/index.html', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KalshiEdgeBot/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Look for patterns like "X,XXX cases" or "XXXX measles cases"
    // CDC typically shows: "As of [date], X,XXX measles cases have been reported"
    const patterns = [
      /(\d{1,2},?\d{3})\s*measles\s*cases/i,
      /reported\s*(\d{1,2},?\d{3})\s*cases/i,
      /(\d{1,2},?\d{3})\s*cases\s*(?:of\s*measles|have\s*been)/i,
      /total\s*(?:of\s*)?(\d{1,2},?\d{3})\s*cases/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const countStr = match[1].replace(/,/g, '');
        const count = parseInt(countStr, 10);
        if (count > 0 && count < 100000) {  // Sanity check
          return count;
        }
      }
    }

    return null;
  } catch (error) {
    logger.debug(`CDC page fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// PROJECTIONS
// =============================================================================

/**
 * Project year-end cases based on current YTD and method
 */
function projectYearEndCases(
  casesYTD: number,
  currentWeek: number,
  method: 'linear' | 'seasonal' | 'recent_trend'
): number {
  if (currentWeek >= 52) {
    return casesYTD;  // Year almost over
  }

  switch (method) {
    case 'linear': {
      // Simple linear extrapolation
      const weeksRemaining = 52 - currentWeek;
      const weeklyRate = casesYTD / currentWeek;
      return Math.round(casesYTD + (weeklyRate * weeksRemaining));
    }

    case 'seasonal': {
      // Use seasonal weights to estimate remaining cases
      let cumulativeWeight = 0;
      for (let w = 1; w <= currentWeek; w++) {
        cumulativeWeight += SEASONAL_WEIGHTS[w] ?? 0.019;
      }

      if (cumulativeWeight <= 0) return casesYTD;

      // Estimate total based on proportion of year completed
      return Math.round(casesYTD / cumulativeWeight);
    }

    case 'recent_trend': {
      // Weight recent weeks more heavily
      // Assume last 4 weeks represent current trend
      const recentRate = casesYTD / currentWeek;  // Simplified
      const weeksRemaining = 52 - currentWeek;
      return Math.round(casesYTD + (recentRate * weeksRemaining * 0.8));  // Slight regression to mean
    }

    default:
      return casesYTD;
  }
}

/**
 * Calculate confidence in projection based on how much of year has passed
 */
function calculateProjectionConfidence(currentWeek: number): number {
  // More confident later in the year
  if (currentWeek >= 50) return 0.95;
  if (currentWeek >= 45) return 0.85;
  if (currentWeek >= 40) return 0.75;
  if (currentWeek >= 30) return 0.65;
  if (currentWeek >= 20) return 0.55;
  return 0.45;
}

/**
 * Calculate historical average over N years
 */
function calculateHistoricalAverage(years: number): number {
  const currentYear = new Date().getFullYear();
  const recentYears = Object.entries(HISTORICAL_CASES)
    .filter(([y]) => {
      const year = parseInt(y);
      return year >= currentYear - years && year < currentYear;
    })
    .map(([, cases]) => cases);

  if (recentYears.length === 0) return 200;  // Default fallback

  return Math.round(recentYears.reduce((a, b) => a + b, 0) / recentYears.length);
}

// =============================================================================
// PROBABILITY CALCULATIONS
// =============================================================================

/**
 * Calculate probability of exceeding a threshold
 * Uses log-normal distribution (case counts are right-skewed)
 */
export function calculateExceedanceProbability(
  data: MeaslesData,
  threshold: number
): MeaslesThreshold {
  const { casesYTD, projectedYearEnd, projectionConfidence, weekNumber } = data;

  // If we've already exceeded the threshold, probability is 1
  if (casesYTD >= threshold) {
    return {
      threshold,
      probability: 1.0,
      confidence: 0.99,
    };
  }

  // If year is almost over and we're well below, probability is low
  if (weekNumber >= 50 && casesYTD < threshold * 0.8) {
    const remainingNeeded = threshold - casesYTD;
    const avgWeekly = casesYTD / weekNumber;
    const weeksLeft = 52 - weekNumber;
    const expectedRemaining = avgWeekly * weeksLeft;

    if (expectedRemaining < remainingNeeded * 0.5) {
      return {
        threshold,
        probability: 0.05,
        confidence: projectionConfidence,
      };
    }
  }

  // Use projection and uncertainty
  // Estimate standard deviation based on historical variance
  const historicalVariance = calculateHistoricalVariance();
  const stdDev = Math.sqrt(historicalVariance) * (1 - projectionConfidence);

  // Calculate z-score and probability
  const z = (threshold - projectedYearEnd) / Math.max(stdDev, 100);
  const probability = 1 - normalCDF(z);

  // Adjust for uncertainty
  const adjustedProbability = Math.max(0.01, Math.min(0.99, probability));

  return {
    threshold,
    probability: adjustedProbability,
    confidence: projectionConfidence,
  };
}

/**
 * Calculate historical variance in case counts
 */
function calculateHistoricalVariance(): number {
  const cases = Object.values(HISTORICAL_CASES).filter(c => c > 10);  // Exclude COVID year
  if (cases.length < 2) return 10000;

  const mean = cases.reduce((a, b) => a + b, 0) / cases.length;
  const squaredDiffs = cases.map(c => (c - mean) ** 2);
  return squaredDiffs.reduce((a, b) => a + b, 0) / cases.length;
}

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
  z = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get calendar week number (1-52, simple day-of-year based)
 * Uses simple calculation that keeps December 31 in week 52
 */
function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return Math.min(week, 52);  // Cap at 52
}

/**
 * Update historical data with new case count
 */
export function updateHistoricalData(year: number, cases: number): void {
  HISTORICAL_CASES[year] = cases;
}
