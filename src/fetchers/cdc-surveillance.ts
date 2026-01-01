/**
 * CDC Health Surveillance Data Fetcher
 *
 * Fetches real-time health surveillance data from CDC public APIs:
 * - NWSS (National Wastewater Surveillance System) - COVID, Flu, RSV
 * - FluView - Weekly influenza surveillance
 * - COVID Data Tracker
 *
 * Wastewater data leads case counts by 7-14 days, providing edge
 * on health-related prediction markets.
 *
 * All data sources are FREE and public.
 */

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

export interface HealthEdgeSignal {
  pathogen: string;
  market: string;
  currentLevel: string;
  projectedLevel: string;
  leadDays: number;        // How many days ahead wastewater leads cases
  confidence: number;
  direction: 'BUY YES' | 'BUY NO';
  reasoning: string;
}

// =============================================================================
// CDC NWSS WASTEWATER API
// =============================================================================

// Correct CDC NWSS endpoint - SARS-CoV-2 Wastewater Metric Data
// Source: https://data.cdc.gov/Public-Health-Surveillance/NWSS-Public-SARS-CoV-2-Wastewater-Metric-Data/2ew6-ywp6
const CDC_WASTEWATER_URL = 'https://data.cdc.gov/resource/2ew6-ywp6.json';
// FluView ILINet data
const CDC_FLU_URL = 'https://data.cdc.gov/resource/ks3g-spdg.json';
// Respiratory virus surveillance
const CDC_RESP_URL = 'https://data.cdc.gov/resource/mpgq-jmmr.json';

/**
 * Fetch national wastewater surveillance data
 * This provides early warning signals 7-14 days before case counts
 */
export async function fetchWastewaterData(): Promise<WastewaterData[]> {
  const results: WastewaterData[] = [];

  try {
    // Fetch COVID wastewater data - get recent data from all jurisdictions
    // API docs: https://data.cdc.gov/Public-Health-Surveillance/NWSS-Public-SARS-CoV-2-Wastewater-Metric-Data/2ew6-ywp6
    // Note: No national aggregate exists - we get state-level data and can aggregate
    const response = await fetch(
      `${CDC_WASTEWATER_URL}?$order=date_end desc&$limit=500`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'KalshiEdgeDetector/2.0',
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

  // Get unique jurisdictions from most recent data
  const seen = new Set<string>();

  for (const row of data) {
    const jurisdiction = row.reporting_jurisdiction ?? row.wwtp_jurisdiction ?? row.state ?? 'Unknown';

    // Skip duplicates
    if (seen.has(jurisdiction)) continue;
    seen.add(jurisdiction);

    // Parse various possible field names
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

  logger.info(`Fetched ${results.length} wastewater data points`);
  return results;
}

/**
 * Fetch weekly flu surveillance data from FluView
 */
export async function fetchFluData(): Promise<FluData[]> {
  const results: FluData[] = [];

  try {
    // Use CDC FluView data
    const response = await fetch(
      `${CDC_FLU_URL}?$order=year desc, week desc&$limit=52`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'KalshiEdgeDetector/2.0',
        },
      }
    );

    if (!response.ok) {
      // Fallback: try alternative endpoint
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
        hospitalizations: 0,  // Separate endpoint
        trend: 'stable',
        activityLevel,
      });
    }

    logger.info(`Fetched ${results.length} flu data points`);
  } catch (error) {
    logger.error(`CDC flu fetch error: ${error}`);
  }

  return results;
}

/**
 * Fallback flu data fetcher using alternative CDC endpoint
 */
async function fetchFluDataFallback(): Promise<FluData[]> {
  const results: FluData[] = [];

  try {
    // Alternative: Fetch from CDC COVID-NET which includes flu
    const url = 'https://data.cdc.gov/resource/aemt-mg7g.json?$order=week_end desc&$limit=20';
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KalshiEdgeDetector/2.0',
      },
    });

    if (!response.ok) return results;

    const data = await response.json() as Array<{
      week_end?: string;
      site?: string;
      weekly_rate?: string;
    }>;

    // Process data
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
// HEALTH EDGE DETECTION
// =============================================================================

/**
 * Analyze wastewater data to find edges on health markets
 * Wastewater leads reported cases by 7-14 days
 */
export function analyzeWastewaterEdge(
  wastewater: WastewaterData[],
  marketThreshold: number,  // e.g., 2000 cases
  currentCases: number
): HealthEdgeSignal | null {
  // Get national aggregate
  const national = wastewater.find(w => w.region === 'National' || w.region === 'US');
  if (!national) return null;

  // Project cases based on wastewater trend
  let projectedMultiplier = 1;
  if (national.trend === 'increasing') {
    projectedMultiplier = 1 + (national.percentChange / 100);
  } else if (national.trend === 'decreasing') {
    projectedMultiplier = 1 - Math.abs(national.percentChange / 100);
  }

  const projectedCases = Math.round(currentCases * projectedMultiplier);

  // Determine if market threshold will be exceeded
  const willExceed = projectedCases > marketThreshold;
  const currentlyExceeds = currentCases > marketThreshold;

  // Edge exists when wastewater contradicts market expectation
  if (willExceed === currentlyExceeds) return null;

  const confidence = Math.min(Math.abs(national.percentChange) / 30, 0.8);

  return {
    pathogen: national.pathogen,
    market: `Cases > ${marketThreshold}`,
    currentLevel: national.level,
    projectedLevel: willExceed ? 'likely_exceed' : 'likely_under',
    leadDays: 10,  // Average wastewater lead time
    confidence,
    direction: willExceed ? 'BUY YES' : 'BUY NO',
    reasoning: `Wastewater ${national.trend} (${national.percentChange > 0 ? '+' : ''}${national.percentChange.toFixed(1)}% 15d) ` +
               `suggests cases will ${willExceed ? 'exceed' : 'stay under'} ${marketThreshold}`,
  };
}

/**
 * Analyze flu data for seasonal flu markets
 */
export function analyzeFluEdge(
  fluData: FluData[],
  marketType: 'hospitalizations' | 'peak_week' | 'severity'
): HealthEdgeSignal | null {
  if (fluData.length < 2) return null;

  const latest = fluData[0];
  const previous = fluData[1];

  // Calculate trend
  const positivityChange = latest.positivityRate - previous.positivityRate;
  const trend = positivityChange > 2 ? 'increasing' :
                positivityChange < -2 ? 'decreasing' : 'stable';

  // Historical peak is typically weeks 50-10 (Dec-Feb)
  const currentWeek = latest.week;
  const isPrePeak = currentWeek < 50 && currentWeek > 10;
  const isPeakSeason = currentWeek >= 50 || currentWeek <= 10;

  if (marketType === 'severity') {
    // If activity is high pre-peak, likely to get worse
    if (isPrePeak && latest.activityLevel === 'high' && trend === 'increasing') {
      return {
        pathogen: 'flu',
        market: 'Flu severity',
        currentLevel: latest.activityLevel,
        projectedLevel: 'very_high',
        leadDays: 14,
        confidence: 0.65,
        direction: 'BUY YES',
        reasoning: `Flu activity ${latest.activityLevel} and ${trend} pre-peak season - historical patterns suggest escalation`,
      };
    }
  }

  return null;
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Fetch all health surveillance data
 */
export async function fetchAllHealthSurveillance(): Promise<{
  wastewater: WastewaterData[];
  flu: FluData[];
}> {
  const [wastewater, flu] = await Promise.all([
    fetchWastewaterData(),
    fetchFluData(),
  ]);

  return { wastewater, flu };
}
