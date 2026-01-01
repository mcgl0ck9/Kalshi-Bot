/**
 * Health Data Trackers
 *
 * Fetches public health data for disease-related prediction markets:
 * - Flu (CDC FluView)
 * - COVID-19 (CDC COVID Data Tracker)
 * - Mpox (CDC Mpox case counts)
 *
 * Similar to measles tracking but for additional diseases.
 */

import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DiseaseData {
  disease: 'flu' | 'covid' | 'mpox';
  year: number;
  casesYTD: number;
  hospitalizationsYTD?: number;
  deathsYTD?: number;
  weekNumber: number;
  lastUpdated: string;
  source: string;

  // Projections
  projectedYearEnd: number;
  projectionConfidence: number;

  // Context
  historicalAverage: number;
  lastYearTotal: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface HealthMarketEdge {
  disease: 'flu' | 'covid' | 'mpox';
  threshold: number;
  thresholdType: 'cases' | 'hospitalizations' | 'deaths';
  currentValue: number;
  projectedValue: number;
  probability: number;
  confidence: number;
  reasoning: string;
}

// =============================================================================
// FLU DATA (CDC FluView)
// =============================================================================

// Historical flu hospitalization data (per 100k, cumulative season)
const FLU_HISTORICAL: Record<string, number> = {
  '2019-2020': 67.3,   // Pre-COVID season
  '2020-2021': 0.7,    // COVID measures suppressed flu
  '2021-2022': 25.0,
  '2022-2023': 68.0,
  '2023-2024': 45.2,
  '2024-2025': 35.0,   // Estimated
};

/**
 * Fetch flu data from CDC FluView
 * Note: CDC API requires specific formatting
 */
export async function fetchFluData(): Promise<DiseaseData | null> {
  try {
    // CDC FluView doesn't have a simple API, so we use estimates
    // In production, would scrape or use CDC Wonder API

    const currentYear = new Date().getFullYear();
    const currentWeek = Math.floor((Date.now() - new Date(currentYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Use recent averages for estimation
    const historicalAvg = (67.3 + 25.0 + 68.0 + 45.2) / 4; // ~51 per 100k

    // Seasonal pattern: flu peaks in Dec-Feb
    const month = new Date().getMonth();
    let seasonalMultiplier = 1.0;
    if (month >= 11 || month <= 1) {
      seasonalMultiplier = 1.3; // Peak season
    } else if (month >= 9 || month <= 2) {
      seasonalMultiplier = 1.1; // Shoulder season
    } else {
      seasonalMultiplier = 0.5; // Off-season
    }

    // Estimate current hospitalization rate (per 100k)
    const estimatedRate = (currentWeek / 52) * historicalAvg * seasonalMultiplier;

    return {
      disease: 'flu',
      year: currentYear,
      casesYTD: 0, // Not tracked for flu
      hospitalizationsYTD: Math.round(estimatedRate * 3.3), // ~330M US pop / 100k
      weekNumber: currentWeek,
      lastUpdated: new Date().toISOString(),
      source: 'CDC FluView (estimated)',
      projectedYearEnd: Math.round(historicalAvg * seasonalMultiplier),
      projectionConfidence: 0.65,
      historicalAverage: historicalAvg,
      lastYearTotal: 45.2,
      trend: month >= 9 && month <= 2 ? 'increasing' : 'decreasing',
    };
  } catch (error) {
    logger.warn(`Failed to fetch flu data: ${error}`);
    return null;
  }
}

// =============================================================================
// COVID DATA (CDC COVID Tracker)
// =============================================================================

// Historical COVID hospitalizations (weekly averages)
const COVID_HISTORICAL: Record<number, number> = {
  2020: 120000, // Peak hospitalizations
  2021: 95000,
  2022: 45000,
  2023: 25000,
  2024: 15000,
};

/**
 * Fetch COVID data from CDC
 */
export async function fetchCovidData(): Promise<DiseaseData | null> {
  try {
    // CDC COVID data tracker
    // In production, use the CDC API or scrape the tracker

    const currentYear = new Date().getFullYear();
    const currentWeek = Math.floor((Date.now() - new Date(currentYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // COVID has been declining but has seasonal bumps
    const baseRate = 15000; // Current baseline weekly hospitalizations

    // Winter surge pattern
    const month = new Date().getMonth();
    let seasonalMultiplier = 1.0;
    if (month >= 11 || month <= 1) {
      seasonalMultiplier = 1.4;
    } else if (month >= 6 && month <= 8) {
      seasonalMultiplier = 1.2; // Summer wave
    }

    const weeklyHospitalizations = Math.round(baseRate * seasonalMultiplier);
    const ytdHospitalizations = weeklyHospitalizations * currentWeek;

    return {
      disease: 'covid',
      year: currentYear,
      casesYTD: ytdHospitalizations * 10, // Rough case estimate
      hospitalizationsYTD: ytdHospitalizations,
      weekNumber: currentWeek,
      lastUpdated: new Date().toISOString(),
      source: 'CDC COVID Tracker (estimated)',
      projectedYearEnd: weeklyHospitalizations * 52,
      projectionConfidence: 0.55, // Lower confidence for COVID
      historicalAverage: 35000,
      lastYearTotal: 15000 * 52,
      trend: seasonalMultiplier > 1.0 ? 'increasing' : 'stable',
    };
  } catch (error) {
    logger.warn(`Failed to fetch COVID data: ${error}`);
    return null;
  }
}

// =============================================================================
// MPOX DATA (CDC Mpox Tracker)
// =============================================================================

// Historical mpox cases
const MPOX_HISTORICAL: Record<number, number> = {
  2022: 29917, // 2022 outbreak
  2023: 1498,
  2024: 3200, // Clade I concerns
};

/**
 * Fetch mpox data from CDC
 */
export async function fetchMpoxData(): Promise<DiseaseData | null> {
  try {
    // CDC Mpox data
    const currentYear = new Date().getFullYear();
    const currentWeek = Math.floor((Date.now() - new Date(currentYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Mpox has been at low endemic levels with occasional spikes
    const weeklyRate = 50; // Approximate weekly case rate
    const ytdCases = weeklyRate * currentWeek;

    // Check for outbreak signals
    const isOutbreakLikely = false; // Would check news/alerts

    return {
      disease: 'mpox',
      year: currentYear,
      casesYTD: ytdCases,
      weekNumber: currentWeek,
      lastUpdated: new Date().toISOString(),
      source: 'CDC Mpox Tracker (estimated)',
      projectedYearEnd: weeklyRate * 52,
      projectionConfidence: isOutbreakLikely ? 0.4 : 0.7,
      historicalAverage: 2500,
      lastYearTotal: MPOX_HISTORICAL[2024] ?? 3200,
      trend: 'stable',
    };
  } catch (error) {
    logger.warn(`Failed to fetch mpox data: ${error}`);
    return null;
  }
}

// =============================================================================
// UNIFIED API
// =============================================================================

/**
 * Fetch all health data
 */
export async function fetchAllHealthData(): Promise<Map<string, DiseaseData>> {
  const data = new Map<string, DiseaseData>();

  const [flu, covid, mpox] = await Promise.all([
    fetchFluData(),
    fetchCovidData(),
    fetchMpoxData(),
  ]);

  if (flu) data.set('flu', flu);
  if (covid) data.set('covid', covid);
  if (mpox) data.set('mpox', mpox);

  return data;
}

/**
 * Calculate probability of exceeding a threshold
 */
export function calculateDiseaseThresholdProbability(
  data: DiseaseData,
  threshold: number,
  thresholdType: 'cases' | 'hospitalizations' = 'cases'
): HealthMarketEdge {
  const currentValue = thresholdType === 'hospitalizations'
    ? (data.hospitalizationsYTD ?? 0)
    : data.casesYTD;

  const projectedValue = thresholdType === 'hospitalizations'
    ? (data.projectedYearEnd * 3.3) // Convert rate to absolute
    : data.projectedYearEnd;

  // Calculate probability
  let probability: number;
  const ratio = projectedValue / threshold;

  if (currentValue >= threshold) {
    probability = 0.99; // Already exceeded
  } else if (ratio >= 1.3) {
    probability = 0.90;
  } else if (ratio >= 1.1) {
    probability = 0.75;
  } else if (ratio >= 1.0) {
    probability = 0.55;
  } else if (ratio >= 0.85) {
    probability = 0.35;
  } else if (ratio >= 0.7) {
    probability = 0.20;
  } else {
    probability = 0.10;
  }

  // Adjust for trend
  if (data.trend === 'increasing') {
    probability = Math.min(0.99, probability * 1.15);
  } else if (data.trend === 'decreasing') {
    probability = Math.max(0.01, probability * 0.85);
  }

  return {
    disease: data.disease,
    threshold,
    thresholdType,
    currentValue,
    projectedValue,
    probability,
    confidence: data.projectionConfidence,
    reasoning: `${data.disease.toUpperCase()}: ${currentValue.toLocaleString()} ${thresholdType} YTD, projected ${projectedValue.toLocaleString()} year-end. Threshold: ${threshold.toLocaleString()}`,
  };
}

/**
 * Get health tracking stats
 */
export function getHealthTrackingStats(): {
  diseasesTracked: number;
  lastUpdated: string;
} {
  return {
    diseasesTracked: 3, // flu, covid, mpox
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Format health data for Discord
 */
export function formatHealthReport(data: Map<string, DiseaseData>): string {
  const lines: string[] = ['**Health Tracker Report**\n'];

  for (const [disease, info] of data) {
    const emoji = disease === 'flu' ? '🤧' : disease === 'covid' ? '🦠' : '🔬';
    lines.push(`${emoji} **${disease.toUpperCase()}**`);
    lines.push(`  Cases YTD: ${info.casesYTD.toLocaleString()}`);
    if (info.hospitalizationsYTD) {
      lines.push(`  Hospitalizations YTD: ${info.hospitalizationsYTD.toLocaleString()}`);
    }
    lines.push(`  Trend: ${info.trend}`);
    lines.push(`  Projected Year-End: ${info.projectedYearEnd.toLocaleString()}`);
    lines.push('');
  }

  return lines.join('\n');
}
