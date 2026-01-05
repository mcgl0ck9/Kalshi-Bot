/**
 * CDC Health Surveillance Source (v4)
 *
 * Fetches real-time health surveillance data from CDC public APIs:
 * - NWSS (National Wastewater Surveillance System) - COVID, Flu, RSV
 * - FluView - Weekly influenza surveillance
 *
 * Wastewater data leads case counts by 7-14 days, providing edge
 * on health-related prediction markets.
 *
 * All data sources are FREE and public.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WastewaterData {
  region: string;
  pathogen: 'covid' | 'flu' | 'rsv' | 'norovirus';
  level: 'very_high' | 'high' | 'moderate' | 'low' | 'minimal';
  percentChange: number;  // Week over week change
  trend: 'increasing' | 'decreasing' | 'stable';
  timestamp: string;
  rawValue?: number;
}

export interface FluData {
  region: string;
  week: number;
  year: number;
  iliRate: number;         // Influenza-Like Illness rate
  positivityRate: number;  // % of tests positive
  hospitalizations: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  activityLevel: 'very_high' | 'high' | 'moderate' | 'low' | 'minimal';
}

export interface CDCSurveillanceData {
  wastewater: WastewaterData[];
  flu: FluData[];
  nationalTrend: 'increasing' | 'decreasing' | 'stable';
  fetchedAt: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// CDC NWSS endpoint - SARS-CoV-2 Wastewater Metric Data
const CDC_WASTEWATER_URL = 'https://data.cdc.gov/resource/2ew6-ywp6.json';
// FluView ILINet data
const CDC_FLU_URL = 'https://data.cdc.gov/resource/ks3g-spdg.json';

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<CDCSurveillanceData>({
  name: 'cdc-surveillance',
  category: 'health',
  cacheTTL: 3600,  // 1 hour - CDC updates daily/weekly

  async fetch(): Promise<CDCSurveillanceData> {
    const [wastewater, flu] = await Promise.all([
      fetchWastewaterData(),
      fetchFluData(),
    ]);

    // Calculate national trend
    const nationalWastewater = wastewater.find(w =>
      w.region === 'National' || w.region === 'US'
    );
    const nationalTrend = nationalWastewater?.trend ?? 'stable';

    logger.info(`Fetched ${wastewater.length} wastewater + ${flu.length} flu data points`);

    return {
      wastewater,
      flu,
      nationalTrend,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// WASTEWATER FETCHER
// =============================================================================

async function fetchWastewaterData(): Promise<WastewaterData[]> {
  const results: WastewaterData[] = [];

  try {
    const response = await fetch(
      `${CDC_WASTEWATER_URL}?$order=date_end desc&$limit=500`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'KalshiEdgeDetector/4.0',
        },
      }
    );

    if (!response.ok) {
      logger.warn(`CDC wastewater API: ${response.status}`);
      return results;
    }

    const data = await response.json() as Array<Record<string, string>>;
    return processWastewaterData(data);
  } catch (error) {
    logger.error(`CDC wastewater fetch error: ${error}`);
  }

  return results;
}

function processWastewaterData(data: Array<Record<string, string>>): WastewaterData[] {
  const results: WastewaterData[] = [];
  const seen = new Set<string>();

  for (const row of data) {
    const jurisdiction = row.reporting_jurisdiction ?? row.wwtp_jurisdiction ?? row.state ?? 'Unknown';

    if (seen.has(jurisdiction)) continue;
    seen.add(jurisdiction);

    const percentChange = parseFloat(
      row.ptc_15d ?? row.percent_change ?? row.percentile ?? '0'
    );
    const percentile = parseFloat(
      row.percentile ?? row.detection_level ?? '50'
    );
    const activityLevel = row.activity_level ?? row.level ?? '';

    let level: WastewaterData['level'] = 'moderate';
    if (activityLevel) {
      const lvl = activityLevel.toLowerCase();
      if (lvl.includes('very high')) level = 'very_high';
      else if (lvl.includes('high')) level = 'high';
      else if (lvl.includes('moderate') || lvl.includes('medium')) level = 'moderate';
      else if (lvl.includes('low')) level = 'low';
      else if (lvl.includes('minimal')) level = 'minimal';
    } else if (percentile >= 90) level = 'very_high';
    else if (percentile >= 75) level = 'high';
    else if (percentile >= 50) level = 'moderate';
    else if (percentile >= 25) level = 'low';
    else level = 'minimal';

    let trend: WastewaterData['trend'] = 'stable';
    if (percentChange > 10) trend = 'increasing';
    else if (percentChange < -10) trend = 'decreasing';

    results.push({
      region: jurisdiction,
      pathogen: 'covid',
      level,
      percentChange,
      trend,
      timestamp: row.date ?? row.date_end ?? new Date().toISOString(),
      rawValue: percentile,
    });
  }

  return results;
}

// =============================================================================
// FLU FETCHER
// =============================================================================

async function fetchFluData(): Promise<FluData[]> {
  const results: FluData[] = [];

  try {
    const response = await fetch(
      `${CDC_FLU_URL}?$order=year desc, week desc&$limit=52`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'KalshiEdgeDetector/4.0',
        },
      }
    );

    if (!response.ok) {
      return await fetchFluDataFallback();
    }

    const data = await response.json() as Array<{
      year?: string;
      week?: string;
      region?: string;
      ilitotal?: string;
      total_patients?: string;
      percent_positive?: string;
    }>;

    for (const row of data.slice(0, 20)) {
      const iliRate = parseFloat(row.ilitotal ?? '0') /
                      parseFloat(row.total_patients ?? '1') * 100;
      const positivity = parseFloat(row.percent_positive ?? '0');

      let activityLevel: FluData['activityLevel'] = 'moderate';
      if (positivity >= 25) activityLevel = 'very_high';
      else if (positivity >= 15) activityLevel = 'high';
      else if (positivity >= 8) activityLevel = 'moderate';
      else if (positivity >= 3) activityLevel = 'low';
      else activityLevel = 'minimal';

      results.push({
        region: row.region ?? 'National',
        week: parseInt(row.week ?? '1'),
        year: parseInt(row.year ?? '2025'),
        iliRate,
        positivityRate: positivity,
        hospitalizations: 0,
        trend: 'stable',
        activityLevel,
      });
    }
  } catch (error) {
    logger.error(`CDC flu fetch error: ${error}`);
  }

  return results;
}

async function fetchFluDataFallback(): Promise<FluData[]> {
  const results: FluData[] = [];

  try {
    const url = 'https://data.cdc.gov/resource/aemt-mg7g.json?$order=week_end desc&$limit=20';
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KalshiEdgeDetector/4.0',
      },
    });

    if (!response.ok) return results;

    const data = await response.json() as Array<{
      week_end?: string;
      site?: string;
      weekly_rate?: string;
    }>;

    for (const row of data) {
      const weekEnd = row.week_end ? new Date(row.week_end) : new Date();

      results.push({
        region: row.site ?? 'National',
        week: getWeekNumber(weekEnd),
        year: weekEnd.getFullYear(),
        iliRate: parseFloat(row.weekly_rate ?? '0'),
        positivityRate: 0,
        hospitalizations: 0,
        trend: 'stable',
        activityLevel: 'moderate',
      });
    }
  } catch {
    // Silent fallback failure
  }

  return results;
}

function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
}

// =============================================================================
// ANALYSIS HELPERS
// =============================================================================

/**
 * Get wastewater data for a specific region.
 */
export function getRegionWastewater(
  data: CDCSurveillanceData,
  region: string
): WastewaterData | null {
  return data.wastewater.find(w =>
    w.region.toLowerCase().includes(region.toLowerCase())
  ) ?? null;
}

/**
 * Get regions with increasing wastewater levels.
 */
export function getIncreasingRegions(data: CDCSurveillanceData): WastewaterData[] {
  return data.wastewater.filter(w => w.trend === 'increasing');
}

/**
 * Get current flu activity level.
 */
export function getCurrentFluActivity(data: CDCSurveillanceData): FluData | null {
  return data.flu.length > 0 ? data.flu[0] : null;
}

/**
 * Analyze wastewater for health market edge.
 */
export function analyzeWastewaterEdge(
  wastewater: WastewaterData[],
  marketThreshold: number,
  currentCases: number
): {
  direction: 'BUY YES' | 'BUY NO' | null;
  confidence: number;
  reasoning: string;
} | null {
  const national = wastewater.find(w => w.region === 'National' || w.region === 'US');
  if (!national) return null;

  let projectedMultiplier = 1;
  if (national.trend === 'increasing') {
    projectedMultiplier = 1 + (national.percentChange / 100);
  } else if (national.trend === 'decreasing') {
    projectedMultiplier = 1 - Math.abs(national.percentChange / 100);
  }

  const projectedCases = Math.round(currentCases * projectedMultiplier);
  const willExceed = projectedCases > marketThreshold;
  const currentlyExceeds = currentCases > marketThreshold;

  if (willExceed === currentlyExceeds) return null;

  const confidence = Math.min(Math.abs(national.percentChange) / 30, 0.8);

  return {
    direction: willExceed ? 'BUY YES' : 'BUY NO',
    confidence,
    reasoning: `Wastewater ${national.trend} (${national.percentChange > 0 ? '+' : ''}${national.percentChange.toFixed(1)}% 15d) ` +
               `suggests cases will ${willExceed ? 'exceed' : 'stay under'} ${marketThreshold}`,
  };
}
