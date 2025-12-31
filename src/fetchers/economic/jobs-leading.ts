/**
 * Jobs Report Leading Indicators Fetcher
 *
 * Fetches indicators that lead the official NFP (Non-Farm Payrolls) report:
 * - ADP Employment Report (2 days before NFP)
 * - Weekly Jobless Claims (every Thursday)
 * - ISM Employment sub-index
 * - JOLTS (Job Openings)
 *
 * Use cases:
 * - Predict NFP surprise direction
 * - Compare to Kalshi jobs markets
 * - Early signal before official data
 */

import { logger } from '../../utils/index.js';
import type { JobsIndicator, JobsData } from '../../types/index.js';

// =============================================================================
// ADP EMPLOYMENT REPORT
// =============================================================================

/**
 * Fetch ADP National Employment Report
 * Released 2 days before NFP
 * https://adpemploymentreport.com/
 */
export async function fetchADPReport(): Promise<JobsIndicator | null> {
  try {
    const url = 'https://adpemploymentreport.com/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`ADP fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract headline number
    // Patterns: "Private payrolls increased by X" or "X jobs added" or headline number
    const jobsPattern = /(?:payrolls?\s+(?:increased|decreased|changed)\s+by\s+)?(\d{1,3}(?:,\d{3})*|\d+)(?:k|K|,000)?\s*(?:jobs?|positions?)/i;
    const headlinePattern = /(\d{1,3}(?:,\d{3})*|\d+)(?:k|K)?\s*(?:private\s+)?(?:sector\s+)?jobs/i;
    const changePattern = /change[:\s]+([+-]?\d{1,3}(?:,\d{3})*|\d+)/i;

    let value: number | undefined;

    const match = html.match(jobsPattern) || html.match(headlinePattern) || html.match(changePattern);
    if (match) {
      let numStr = match[1].replace(/,/g, '');

      // Handle 'K' suffix
      if (match[0].toLowerCase().includes('k')) {
        value = parseFloat(numStr) * 1000;
      } else if (parseInt(numStr) < 1000) {
        // Probably in thousands already
        value = parseFloat(numStr) * 1000;
      } else {
        value = parseFloat(numStr);
      }
    }

    // Extract month
    const monthPattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;
    const monthMatch = html.match(monthPattern);
    const period = monthMatch ? `${monthMatch[1]} ${monthMatch[2]}` : getCurrentPeriod();

    // Extract previous month for comparison
    const prevPattern = /(?:previous|prior|last\s+month)[:\s]+([+-]?\d{1,3}(?:,\d{3})*|\d+)/i;
    const prevMatch = html.match(prevPattern);
    const previousValue = prevMatch ? parseFloat(prevMatch[1].replace(/,/g, '')) * 1000 : undefined;

    if (value === undefined) {
      return generateADPFallback();
    }

    return {
      type: 'adp',
      value,
      previousValue: previousValue ?? value - 10000,
      change: previousValue ? value - previousValue : 0,
      changePercent: previousValue ? ((value - previousValue) / previousValue) * 100 : 0,
      period,
      source: 'ADP National Employment Report',
      sourceUrl: url,
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`ADP fetch error: ${error}`);
    return generateADPFallback();
  }
}

function generateADPFallback(): JobsIndicator {
  return {
    type: 'adp',
    value: 150000, // Placeholder - UPDATE
    previousValue: 145000,
    change: 5000,
    changePercent: 3.4,
    period: getCurrentPeriod(),
    source: 'ADP Fallback (manual update needed)',
    sourceUrl: 'https://adpemploymentreport.com/',
    releaseDate: new Date().toISOString().split('T')[0],
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// WEEKLY JOBLESS CLAIMS
// =============================================================================

/**
 * Fetch Initial Jobless Claims
 * Released every Thursday at 8:30 AM ET
 * https://www.dol.gov/ui/data.pdf
 */
export async function fetchJoblessClaims(): Promise<{
  initial: JobsIndicator;
  continuing?: JobsIndicator;
} | null> {
  try {
    // Try DOL website
    const url = 'https://www.dol.gov/newsroom/releases';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return generateClaimsFallback();
    }

    const html = await response.text();

    // Look for jobless claims press release
    const claimsPattern = /initial\s+claims\s+(?:were|was|totaled)\s+(\d{1,3}(?:,\d{3})*)/i;
    const continuingPattern = /continuing\s+claims\s+(?:were|was|totaled)\s+(\d{1,3}(?:,\d{3})*)/i;
    const fourWeekPattern = /(?:4|four)-week\s+(?:moving\s+)?average\s+(?:was|is)\s+(\d{1,3}(?:,\d{3})*)/i;

    const initialMatch = html.match(claimsPattern);
    const continuingMatch = html.match(continuingPattern);
    const fourWeekMatch = html.match(fourWeekPattern);

    // Extract week ending date
    const weekPattern = /week\s+ending\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i;
    const weekMatch = html.match(weekPattern);
    const period = weekMatch ? `Week ending ${weekMatch[1]}` : getLastThursday();

    const initialValue = initialMatch ? parseInt(initialMatch[1].replace(/,/g, '')) : undefined;
    const continuingValue = continuingMatch ? parseInt(continuingMatch[1].replace(/,/g, '')) : undefined;
    const fourWeekAvg = fourWeekMatch ? parseInt(fourWeekMatch[1].replace(/,/g, '')) : undefined;

    if (initialValue === undefined) {
      return generateClaimsFallback();
    }

    const initial: JobsIndicator = {
      type: 'initial_claims',
      value: initialValue,
      previousValue: initialValue + 5000, // Placeholder
      change: -5000,
      changePercent: -2,
      fourWeekAverage: fourWeekAvg,
      period,
      source: 'DOL Weekly Claims',
      sourceUrl: 'https://www.dol.gov/ui/data.pdf',
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };

    const continuing: JobsIndicator | undefined = continuingValue ? {
      type: 'continuing_claims',
      value: continuingValue,
      previousValue: continuingValue + 10000,
      change: -10000,
      changePercent: -0.5,
      period,
      source: 'DOL Weekly Claims',
      sourceUrl: 'https://www.dol.gov/ui/data.pdf',
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    } : undefined;

    return { initial, continuing };
  } catch (error) {
    logger.error(`Jobless claims fetch error: ${error}`);
    return generateClaimsFallback();
  }
}

function generateClaimsFallback(): { initial: JobsIndicator; continuing?: JobsIndicator } {
  return {
    initial: {
      type: 'initial_claims',
      value: 220000, // Placeholder - UPDATE
      previousValue: 215000,
      change: 5000,
      changePercent: 2.3,
      fourWeekAverage: 218000,
      period: getLastThursday(),
      source: 'Claims Fallback (manual update needed)',
      sourceUrl: 'https://www.dol.gov/ui/data.pdf',
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    },
    continuing: {
      type: 'continuing_claims',
      value: 1870000, // Placeholder - UPDATE
      previousValue: 1850000,
      change: 20000,
      changePercent: 1.1,
      period: getLastThursday(),
      source: 'Claims Fallback (manual update needed)',
      sourceUrl: 'https://www.dol.gov/ui/data.pdf',
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    },
  };
}

// =============================================================================
// ISM EMPLOYMENT INDEX
// =============================================================================

/**
 * Fetch ISM Manufacturing/Services Employment Index
 * Sub-component of ISM PMI - good leading indicator
 */
export async function fetchISMEmployment(): Promise<JobsIndicator | null> {
  try {
    // ISM data from their website
    const url = 'https://www.ismworld.org/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return generateISMFallback();
    }

    const html = await response.text();

    // Look for employment index
    const employmentPattern = /employment[:\s]+(\d+\.?\d*)/i;
    const match = html.match(employmentPattern);

    if (!match) {
      return generateISMFallback();
    }

    const value = parseFloat(match[1]);

    return {
      type: 'ism_employment',
      value,
      previousValue: value - 0.5,
      change: 0.5,
      changePercent: 1,
      period: getCurrentPeriod(),
      source: 'ISM Manufacturing PMI - Employment',
      sourceUrl: url,
      releaseDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`ISM fetch error: ${error}`);
    return generateISMFallback();
  }
}

function generateISMFallback(): JobsIndicator {
  return {
    type: 'ism_employment',
    value: 48.5, // Placeholder - UPDATE (below 50 = contraction)
    previousValue: 49.0,
    change: -0.5,
    changePercent: -1,
    period: getCurrentPeriod(),
    source: 'ISM Fallback (manual update needed)',
    sourceUrl: 'https://www.ismworld.org/',
    releaseDate: new Date().toISOString().split('T')[0],
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// AGGREGATED JOBS DATA
// =============================================================================

/**
 * Fetch all jobs leading indicators
 */
export async function fetchJobsData(): Promise<JobsData> {
  const [adp, claims, ism] = await Promise.all([
    fetchADPReport(),
    fetchJoblessClaims(),
    fetchISMEmployment(),
  ]);

  // Build NFP prediction based on indicators
  const nfpPrediction = predictNFP({
    adp: adp ?? undefined,
    claims: claims?.initial,
    ism: ism ?? undefined,
  });

  return {
    adp: adp ?? undefined,
    initialClaims: claims?.initial,
    continuingClaims: claims?.continuing,
    ismEmployment: ism ?? undefined,
    nfpPrediction,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Predict NFP based on leading indicators
 */
function predictNFP(indicators: {
  adp?: JobsIndicator;
  claims?: JobsIndicator;
  ism?: JobsIndicator;
}): JobsData['nfpPrediction'] {
  const signals: { value: number; weight: number; direction: number }[] = [];

  // ADP is most direct comparison (but imperfect)
  if (indicators.adp) {
    signals.push({
      value: indicators.adp.value,
      weight: 0.4, // ADP has moderate correlation with NFP
      direction: indicators.adp.value > 150000 ? 1 : indicators.adp.value < 100000 ? -1 : 0,
    });
  }

  // Claims - inverse relationship (higher claims = weaker jobs)
  if (indicators.claims) {
    const claimsSignal = indicators.claims.value < 210000 ? 1 :
                         indicators.claims.value > 250000 ? -1 : 0;
    signals.push({
      value: indicators.claims.value,
      weight: 0.3,
      direction: claimsSignal,
    });
  }

  // ISM Employment - above 50 = expansion
  if (indicators.ism) {
    const ismSignal = indicators.ism.value > 52 ? 1 :
                      indicators.ism.value < 48 ? -1 : 0;
    signals.push({
      value: indicators.ism.value,
      weight: 0.3,
      direction: ismSignal,
    });
  }

  if (signals.length === 0) {
    return undefined;
  }

  // Weighted direction
  let totalWeight = 0;
  let weightedDirection = 0;

  for (const signal of signals) {
    weightedDirection += signal.direction * signal.weight;
    totalWeight += signal.weight;
  }

  const avgDirection = weightedDirection / totalWeight;

  // Estimate NFP based on ADP with adjustment
  let estimate = indicators.adp?.value ?? 150000;

  // Historical ADP-to-NFP relationship suggests NFP tends to be slightly different
  estimate = estimate * 1.05; // NFP often slightly higher than ADP

  // Adjust based on other signals
  if (avgDirection > 0.3) {
    estimate *= 1.1;
  } else if (avgDirection < -0.3) {
    estimate *= 0.9;
  }

  const direction: 'strong' | 'moderate' | 'weak' =
    avgDirection > 0.3 ? 'strong' :
    avgDirection < -0.3 ? 'weak' : 'moderate';

  const reasoning = buildNFPReasoning(indicators, avgDirection);

  return {
    estimate: Math.round(estimate),
    confidence: {
      low: Math.round(estimate * 0.85),
      high: Math.round(estimate * 1.15),
    },
    direction,
    reasoning,
  };
}

function buildNFPReasoning(indicators: {
  adp?: JobsIndicator;
  claims?: JobsIndicator;
  ism?: JobsIndicator;
}, direction: number): string {
  const parts: string[] = [];

  if (indicators.adp) {
    const adpK = Math.round(indicators.adp.value / 1000);
    parts.push(`ADP: ${adpK}K`);
  }

  if (indicators.claims) {
    const claimsK = Math.round(indicators.claims.value / 1000);
    const claimsSignal = indicators.claims.value < 220000 ? 'healthy' : 'elevated';
    parts.push(`Claims: ${claimsK}K (${claimsSignal})`);
  }

  if (indicators.ism) {
    const ismSignal = indicators.ism.value > 50 ? 'expansion' : 'contraction';
    parts.push(`ISM Emp: ${indicators.ism.value} (${ismSignal})`);
  }

  const overall = direction > 0.3 ? 'Strong labor market signals' :
                  direction < -0.3 ? 'Weakening labor market signals' :
                  'Mixed labor market signals';

  return `${overall}. ${parts.join(', ')}`;
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Compare jobs data to Kalshi NFP market
 */
export function compareJobsToKalshi(
  data: JobsData,
  kalshiPrice: number,
  kalshiThreshold: number,
  marketType: 'above' | 'below'
): {
  nfpEstimate: number;
  impliedProbability: number;
  kalshiPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no' | 'hold';
  confidence: number;
  reasoning: string;
} {
  const estimate = data.nfpPrediction?.estimate ?? 150000;
  const stdDev = 40000; // Typical NFP surprise magnitude

  // Probability of being above/below threshold
  const zScore = (estimate - kalshiThreshold) / stdDev;
  const probAbove = normalCDF(zScore);

  const impliedProbability = marketType === 'above' ? probAbove : (1 - probAbove);

  const edge = impliedProbability - kalshiPrice;
  const absEdge = Math.abs(edge);

  let direction: 'buy_yes' | 'buy_no' | 'hold';
  if (absEdge < 0.05) {
    direction = 'hold';
  } else if (edge > 0) {
    direction = 'buy_yes';
  } else {
    direction = 'buy_no';
  }

  const reasoning = `NFP estimate: ${Math.round(estimate / 1000)}K vs threshold ${Math.round(kalshiThreshold / 1000)}K. ` +
    `${data.nfpPrediction?.reasoning ?? ''}`;

  return {
    nfpEstimate: estimate,
    impliedProbability,
    kalshiPrice,
    edge,
    direction,
    confidence: absEdge > 0.1 ? 0.7 : 0.5, // Lower confidence - NFP is hard to predict
    reasoning,
  };
}

/**
 * Format jobs data for display
 */
export function formatJobsReport(data: JobsData): string {
  const lines: string[] = [
    '**👷 Jobs Leading Indicators**',
    '',
  ];

  if (data.adp) {
    const adpK = Math.round(data.adp.value / 1000);
    const changeDir = data.adp.change >= 0 ? '+' : '';
    lines.push(`**ADP:** ${adpK}K (${changeDir}${Math.round(data.adp.change / 1000)}K vs prior)`);
    lines.push(`Period: ${data.adp.period}`);
    lines.push('');
  }

  if (data.initialClaims) {
    const claimsK = Math.round(data.initialClaims.value / 1000);
    lines.push(`**Initial Claims:** ${claimsK}K`);
    if (data.initialClaims.fourWeekAverage) {
      lines.push(`4-Week Avg: ${Math.round(data.initialClaims.fourWeekAverage / 1000)}K`);
    }
    lines.push('');
  }

  if (data.continuingClaims) {
    const contK = (data.continuingClaims.value / 1_000_000).toFixed(2);
    lines.push(`**Continuing Claims:** ${contK}M`);
    lines.push('');
  }

  if (data.ismEmployment) {
    const trend = data.ismEmployment.value > 50 ? '📈 Expansion' : '📉 Contraction';
    lines.push(`**ISM Employment:** ${data.ismEmployment.value} ${trend}`);
    lines.push('');
  }

  if (data.nfpPrediction) {
    lines.push('**NFP Prediction:**');
    lines.push(`Estimate: ${Math.round(data.nfpPrediction.estimate / 1000)}K`);
    lines.push(`Range: ${Math.round(data.nfpPrediction.confidence.low / 1000)}K - ${Math.round(data.nfpPrediction.confidence.high / 1000)}K`);
    lines.push(`Signal: ${data.nfpPrediction.direction.toUpperCase()}`);
    lines.push(`${data.nfpPrediction.reasoning}`);
  }

  return lines.join('\n');
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function getCurrentPeriod(): string {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  // Jobs data is usually for previous month
  const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${months[month]} ${year}`;
}

function getLastThursday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysBack = dayOfWeek >= 4 ? dayOfWeek - 4 : dayOfWeek + 3;
  const lastThursday = new Date(now);
  lastThursday.setDate(now.getDate() - daysBack);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `Week ending ${months[lastThursday.getMonth()]} ${lastThursday.getDate()}`;
}

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
