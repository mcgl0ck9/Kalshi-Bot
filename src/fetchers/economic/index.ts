/**
 * Economic Indicators Module
 *
 * Aggregates all economic data fetchers for macro edge detection:
 * - Fed Watch: Rate expectations from CME
 * - CPI Nowcast: Real-time inflation estimates
 * - Jobs Leading: ADP, Claims, ISM employment
 * - GDP Nowcast: Atlanta Fed, NY Fed growth estimates
 */

// Fed Watch
export {
  fetchFedWatch,
  compareFedWatchToKalshi,
  formatFedWatchReport,
  detectFedShift,
} from './fed-watch.js';

// CPI Nowcast
export {
  fetchClevelandFedNowcast,
  fetchTruflation,
  fetchBreakevenInflation,
  fetchInflationData,
  compareInflationToKalshi,
  formatInflationReport,
} from './cpi-nowcast.js';

// Jobs Leading Indicators
export {
  fetchADPReport,
  fetchJoblessClaims,
  fetchISMEmployment,
  fetchJobsData,
  compareJobsToKalshi,
  formatJobsReport,
} from './jobs-leading.js';

// GDP Nowcast
export {
  fetchAtlantaFedGDPNow,
  fetchNYFedNowcast,
  fetchGDPData,
  compareGDPToKalshi,
  analyzeRecessionRisk,
  formatGDPReport,
} from './gdp-nowcast.js';

// =============================================================================
// AGGREGATED FUNCTIONS
// =============================================================================

import { fetchFedWatch } from './fed-watch.js';
import { fetchInflationData } from './cpi-nowcast.js';
import { fetchJobsData } from './jobs-leading.js';
import { fetchGDPData } from './gdp-nowcast.js';
import type {
  FedWatchData,
  InflationData,
  JobsData,
  GDPData,
} from '../../types/index.js';

export interface AllEconomicData {
  fedWatch: FedWatchData | null;
  inflation: InflationData;
  jobs: JobsData;
  gdp: GDPData;
  fetchedAt: string;
}

/**
 * Fetch all economic indicators at once
 */
export async function fetchAllEconomicData(): Promise<AllEconomicData> {
  const [fedWatch, inflation, jobs, gdp] = await Promise.all([
    fetchFedWatch(),
    fetchInflationData(),
    fetchJobsData(),
    fetchGDPData(),
  ]);

  return {
    fedWatch,
    inflation,
    jobs,
    gdp,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Format all economic data for Discord report
 */
export function formatEconomicSummary(data: AllEconomicData): string {
  const lines: string[] = [
    '**📈 Economic Dashboard**',
    '═══════════════════════════════',
    '',
  ];

  // Fed rates
  if (data.fedWatch) {
    const fw = data.fedWatch;
    lines.push(`**🏦 Fed Funds:** ${fw.currentRate}% → ${fw.yearEndImpliedRate.toFixed(2)}% (${fw.totalCutsImplied} cuts priced)`);
    if (fw.nextMeeting) {
      lines.push(`Next FOMC: Cut ${(fw.nextMeeting.probCut * 100).toFixed(0)}% | Hold ${(fw.nextMeeting.probHold * 100).toFixed(0)}%`);
    }
    lines.push('');
  }

  // Inflation
  lines.push(`**📊 Inflation:** ${data.inflation.aggregatedEstimate.toFixed(2)}% YoY (${(data.inflation.confidence * 100).toFixed(0)}% confidence)`);
  if (data.inflation.clevelandFed?.coreCPI) {
    lines.push(`Core CPI: ${data.inflation.clevelandFed.coreCPI.toFixed(2)}%`);
  }
  lines.push('');

  // Jobs
  if (data.jobs.nfpPrediction) {
    const nfpK = Math.round(data.jobs.nfpPrediction.estimate / 1000);
    lines.push(`**👷 Jobs:** NFP est ${nfpK}K (${data.jobs.nfpPrediction.direction})`);
  }
  if (data.jobs.initialClaims) {
    const claimsK = Math.round(data.jobs.initialClaims.value / 1000);
    lines.push(`Initial Claims: ${claimsK}K`);
  }
  lines.push('');

  // GDP
  lines.push(`**📉 GDP:** ${data.gdp.aggregatedEstimate.toFixed(1)}% (${data.gdp.atlantaFed?.quarter ?? 'current quarter'})`);

  return lines.join('\n');
}
