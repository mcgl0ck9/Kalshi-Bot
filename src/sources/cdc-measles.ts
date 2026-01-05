/**
 * CDC Measles Data Source
 *
 * Fetches current measles case counts from CDC for edge detection
 * against Kalshi health markets.
 */

import { defineSource } from '../core/index.js';
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
  projectedYearEnd: number;
  projectionConfidence: number;
  historicalAverage: number;
  lastYearTotal: number;
}

// =============================================================================
// HISTORICAL DATA
// =============================================================================

const HISTORICAL_CASES: Record<number, number> = {
  2019: 1282,
  2020: 13,
  2021: 49,
  2022: 121,
  2023: 58,
  2024: 2041,  // Final 2024 count
};

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
// SOURCE DEFINITION
// =============================================================================

export default defineSource<MeaslesData>({
  name: 'cdc-measles',
  category: 'health',
  cacheTTL: 3600,  // 1 hour cache (data updates weekly)

  async fetch(): Promise<MeaslesData> {
    const currentYear = new Date().getFullYear();
    const currentWeek = getWeekNumber(new Date());

    let casesYTD: number | null = null;
    let source = 'estimated';

    // Try scraping CDC page
    try {
      const cdcResult = await scrapeCDCPage();
      if (cdcResult && cdcResult.year === currentYear) {
        casesYTD = cdcResult.count;
        source = 'cdc_page';
        logger.info(`Fetched ${casesYTD} measles cases from CDC`);
      }
    } catch (error) {
      logger.debug(`CDC scrape failed: ${error}`);
    }

    // Fallback to estimation
    if (casesYTD === null) {
      casesYTD = estimateCurrentCases(currentWeek);
      source = 'estimated';
    }

    const projectedYearEnd = projectYearEnd(casesYTD, currentWeek);
    const historicalAverage = calculateAverage(5);

    return {
      year: currentYear,
      casesYTD,
      weekNumber: currentWeek,
      lastUpdated: new Date().toISOString(),
      source,
      projectedYearEnd,
      projectionConfidence: getConfidence(currentWeek),
      historicalAverage,
      lastYearTotal: HISTORICAL_CASES[currentYear - 1] ?? 0,
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS (kept under 50 lines each)
// =============================================================================

async function scrapeCDCPage(): Promise<{ count: number; year: number } | null> {
  const response = await fetch('https://www.cdc.gov/measles/data-research/index.html', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/1.0)' },
  });

  if (!response.ok) return null;

  const html = await response.text();
  const yearMatch = html.match(/[Mm]easles\s+cases\s+in\s+(20\d{2})/);
  const countMatch = html.match(/(\d{1,2},?\d{3})\s*measles\s*cases/i);

  if (!countMatch) return null;

  return {
    count: parseInt(countMatch[1].replace(/,/g, ''), 10),
    year: yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear(),
  };
}

function estimateCurrentCases(week: number): number {
  if (week <= 2) return week * 20;
  const baseline = HISTORICAL_CASES[new Date().getFullYear() - 1] ?? 500;
  let cumulativeWeight = 0;
  for (let w = 1; w <= week; w++) {
    cumulativeWeight += SEASONAL_WEIGHTS[w] ?? 0.019;
  }
  return Math.round(baseline * cumulativeWeight);
}

function projectYearEnd(casesYTD: number, week: number): number {
  if (week >= 52) return casesYTD;
  let cumulativeWeight = 0;
  for (let w = 1; w <= week; w++) {
    cumulativeWeight += SEASONAL_WEIGHTS[w] ?? 0.019;
  }
  return cumulativeWeight > 0 ? Math.round(casesYTD / cumulativeWeight) : casesYTD;
}

function getConfidence(week: number): number {
  if (week >= 50) return 0.95;
  if (week >= 40) return 0.75;
  if (week >= 30) return 0.65;
  if (week >= 20) return 0.55;
  return 0.45;
}

function calculateAverage(years: number): number {
  const currentYear = new Date().getFullYear();
  const cases = Object.entries(HISTORICAL_CASES)
    .filter(([y]) => parseInt(y) >= currentYear - years && parseInt(y) < currentYear)
    .map(([, c]) => c);
  return cases.length > 0 ? Math.round(cases.reduce((a, b) => a + b, 0) / cases.length) : 500;
}

function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
  return Math.min(Math.ceil(dayOfYear / 7), 52);
}

// =============================================================================
// EXPORTS FOR EDGE DETECTION
// =============================================================================

/**
 * Calculate probability of exceeding a threshold.
 * Uses simple ratio-based heuristic.
 */
export function calculateExceedanceProbability(
  data: MeaslesData,
  threshold: number
): { probability: number; confidence: number } {
  const { casesYTD, projectedYearEnd, projectionConfidence, lastYearTotal } = data;

  // Already exceeded
  if (casesYTD >= threshold) {
    return { probability: 1.0, confidence: 0.99 };
  }

  const baseline = Math.max(lastYearTotal, data.historicalAverage);
  const ratio = threshold / baseline;

  let probability: number;
  if (ratio <= 0.5) probability = 0.95;
  else if (ratio <= 0.75) probability = 0.85;
  else if (ratio <= 1.0) probability = 0.60;
  else if (ratio <= 1.5) probability = 0.30;
  else if (ratio <= 2.0) probability = 0.10;
  else probability = 0.05;

  // Blend with projection as year progresses
  const projRatio = threshold / projectedYearEnd;
  const projProb = projRatio <= 1.0 ? 0.7 : 0.3;
  const weight = data.weekNumber / 52;

  const blended = (1 - weight) * probability + weight * projProb;
  return {
    probability: Math.max(0.02, Math.min(0.98, blended)),
    confidence: projectionConfidence,
  };
}
