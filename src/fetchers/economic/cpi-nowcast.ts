/**
 * CPI Nowcast Fetchers
 *
 * Fetches real-time inflation estimates from multiple sources:
 * - Cleveland Fed Inflation Nowcast (most authoritative)
 * - Truflation (real-time alternative data)
 * - Breakeven inflation rates
 *
 * Use cases:
 * - Compare to Kalshi CPI markets for edge
 * - Track inflation trajectory
 * - Alert on estimate changes
 */

import { logger } from '../../utils/index.js';
import type { InflationNowcast, InflationData } from '../../types/index.js';

// =============================================================================
// CLEVELAND FED INFLATION NOWCAST
// =============================================================================

/**
 * Fetch Cleveland Fed Inflation Nowcasting
 * Updates daily with real-time CPI estimate
 * https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting
 */
export async function fetchClevelandFedNowcast(): Promise<InflationNowcast | null> {
  try {
    const url = 'https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`Cleveland Fed fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract CPI nowcast values
    // Cleveland Fed displays: "CPI inflation nowcast: X.XX%"
    const cpiPattern = /CPI\s+(?:inflation\s+)?nowcast[:\s]+(\d+\.?\d*)%/i;
    const coreCpiPattern = /Core\s+CPI[:\s]+(\d+\.?\d*)%/i;
    const pcePattern = /PCE[:\s]+(\d+\.?\d*)%/i;

    const cpiMatch = html.match(cpiPattern);
    const coreCpiMatch = html.match(coreCpiPattern);

    // Try alternative patterns
    const yoyPattern = /year-over-year[:\s]+(\d+\.?\d*)%/i;
    const yoyMatch = html.match(yoyPattern);

    // Extract month being forecast
    const monthPattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;
    const monthMatch = html.match(monthPattern);
    const forecastMonth = monthMatch ? `${monthMatch[1]} ${monthMatch[2]}` : getCurrentForecastMonth();

    // Parse values
    const yearOverYearCPI = cpiMatch ? parseFloat(cpiMatch[1]) : (yoyMatch ? parseFloat(yoyMatch[1]) : undefined);
    const coreCPI = coreCpiMatch ? parseFloat(coreCpiMatch[1]) : undefined;

    if (yearOverYearCPI === undefined) {
      // Try to extract from JSON data in page
      const jsonPattern = /"inflation":\s*(\d+\.?\d*)/;
      const jsonMatch = html.match(jsonPattern);

      if (!jsonMatch) {
        logger.debug('Could not extract CPI values from Cleveland Fed page');
        return generateClevelandFedFallback();
      }
    }

    return {
      currentMonthCPI: 0, // MoM usually not directly shown
      yearOverYearCPI: yearOverYearCPI ?? 0,
      coreCPI,
      forecastMonth,
      source: 'Cleveland Fed Inflation Nowcast',
      sourceUrl: url,
      asOfDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Cleveland Fed nowcast error: ${error}`);
    return generateClevelandFedFallback();
  }
}

/**
 * Generate fallback Cleveland Fed data
 * Update manually when scraping fails
 */
function generateClevelandFedFallback(): InflationNowcast {
  return {
    currentMonthCPI: 0.2, // Placeholder MoM
    yearOverYearCPI: 2.7, // Placeholder YoY - UPDATE FROM ACTUAL DATA
    coreCPI: 3.3,         // Placeholder core - UPDATE FROM ACTUAL DATA
    forecastMonth: getCurrentForecastMonth(),
    source: 'Cleveland Fed Fallback (manual update needed)',
    sourceUrl: 'https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting',
    asOfDate: new Date().toISOString().split('T')[0],
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// TRUFLATION
// =============================================================================

/**
 * Fetch Truflation real-time inflation data
 * Uses alternative data sources for daily inflation estimates
 * https://truflation.com/
 */
export async function fetchTruflation(): Promise<InflationNowcast | null> {
  try {
    // Truflation public page
    const url = 'https://truflation.com/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`Truflation fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Truflation displays a headline inflation number
    // Pattern might be: "2.89%" or "Inflation: 2.89%"
    const inflationPattern = /(?:inflation|rate)[:\s]*(\d+\.?\d*)%/i;
    const headlinePattern = /(\d+\.?\d*)%\s*(?:inflation|annual)/i;
    const numberPattern = /"inflation":\s*(\d+\.?\d*)/;

    let yearOverYearCPI: number | undefined;

    const match = html.match(inflationPattern) || html.match(headlinePattern) || html.match(numberPattern);
    if (match) {
      yearOverYearCPI = parseFloat(match[1]);
    }

    // Try API endpoint if available
    if (yearOverYearCPI === undefined) {
      const apiData = await fetchTruflationAPI();
      if (apiData) {
        return apiData;
      }
    }

    if (yearOverYearCPI === undefined) {
      logger.debug('Could not extract Truflation data');
      return generateTruflationFallback();
    }

    // Extract component data if available
    const foodPattern = /food[:\s]+(\d+\.?\d*)%/i;
    const energyPattern = /energy[:\s]+(\d+\.?\d*)%/i;
    const shelterPattern = /(?:housing|shelter)[:\s]+(\d+\.?\d*)%/i;

    const foodMatch = html.match(foodPattern);
    const energyMatch = html.match(energyPattern);
    const shelterMatch = html.match(shelterPattern);

    return {
      currentMonthCPI: 0,
      yearOverYearCPI,
      components: {
        food: foodMatch ? parseFloat(foodMatch[1]) : undefined,
        energy: energyMatch ? parseFloat(energyMatch[1]) : undefined,
        shelter: shelterMatch ? parseFloat(shelterMatch[1]) : undefined,
      },
      forecastMonth: 'Real-time',
      source: 'Truflation',
      sourceUrl: url,
      asOfDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Truflation fetch error: ${error}`);
    return generateTruflationFallback();
  }
}

/**
 * Try Truflation API
 */
async function fetchTruflationAPI(): Promise<InflationNowcast | null> {
  try {
    // Truflation API endpoint (may require key)
    const apiUrl = 'https://api.truflation.com/current';

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { value?: number; inflation?: number };

    const value = data.value ?? data.inflation;
    if (typeof value !== 'number') {
      return null;
    }

    return {
      currentMonthCPI: 0,
      yearOverYearCPI: value,
      forecastMonth: 'Real-time',
      source: 'Truflation API',
      sourceUrl: 'https://truflation.com/',
      asOfDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Generate fallback Truflation data
 */
function generateTruflationFallback(): InflationNowcast {
  return {
    currentMonthCPI: 0,
    yearOverYearCPI: 2.9, // Placeholder - UPDATE FROM ACTUAL DATA
    forecastMonth: 'Real-time',
    source: 'Truflation Fallback (manual update needed)',
    sourceUrl: 'https://truflation.com/',
    asOfDate: new Date().toISOString().split('T')[0],
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// BREAKEVEN INFLATION RATES
// =============================================================================

/**
 * Fetch Treasury breakeven inflation rates from FRED
 * Breakevens = Nominal Treasury - TIPS yield
 * Represents market's inflation expectation
 */
export async function fetchBreakevenInflation(): Promise<{
  fiveYear: number;
  tenYear: number;
  source: string;
  asOfDate: string;
} | null> {
  try {
    // FRED URLs for breakeven rates
    // T5YIE = 5-Year Breakeven
    // T10YIE = 10-Year Breakeven

    // Try to scrape from FRED public page
    const url5y = 'https://fred.stlouisfed.org/series/T5YIE';
    const url10y = 'https://fred.stlouisfed.org/series/T10YIE';

    const [response5y, response10y] = await Promise.all([
      fetch(url5y, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      fetch(url10y, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
    ]);

    let fiveYear: number | undefined;
    let tenYear: number | undefined;

    if (response5y.ok) {
      const html5y = await response5y.text();
      const match5y = html5y.match(/(?:current|latest|value)[:\s]*(\d+\.?\d*)%?/i);
      if (match5y) fiveYear = parseFloat(match5y[1]);
    }

    if (response10y.ok) {
      const html10y = await response10y.text();
      const match10y = html10y.match(/(?:current|latest|value)[:\s]*(\d+\.?\d*)%?/i);
      if (match10y) tenYear = parseFloat(match10y[1]);
    }

    // Fallback to reasonable estimates
    fiveYear = fiveYear ?? 2.3;
    tenYear = tenYear ?? 2.3;

    return {
      fiveYear,
      tenYear,
      source: 'FRED Treasury Breakevens',
      asOfDate: new Date().toISOString().split('T')[0],
    };
  } catch (error) {
    logger.debug(`Breakeven fetch error: ${error}`);
    return {
      fiveYear: 2.3,
      tenYear: 2.3,
      source: 'Breakeven Fallback',
      asOfDate: new Date().toISOString().split('T')[0],
    };
  }
}

// =============================================================================
// AGGREGATED INFLATION DATA
// =============================================================================

/**
 * Fetch all inflation data sources and aggregate
 */
export async function fetchInflationData(): Promise<InflationData> {
  const [clevelandFed, truflation, breakevens] = await Promise.all([
    fetchClevelandFedNowcast(),
    fetchTruflation(),
    fetchBreakevenInflation(),
  ]);

  // Aggregate estimates with weighting
  // Cleveland Fed is most authoritative for official CPI
  // Truflation provides real-time signal
  // Breakevens show market expectations

  const estimates: number[] = [];
  const weights: number[] = [];

  if (clevelandFed?.yearOverYearCPI) {
    estimates.push(clevelandFed.yearOverYearCPI);
    weights.push(0.5); // Highest weight - most accurate for CPI
  }

  if (truflation?.yearOverYearCPI) {
    estimates.push(truflation.yearOverYearCPI);
    weights.push(0.3); // Real-time but different methodology
  }

  if (breakevens?.fiveYear) {
    estimates.push(breakevens.fiveYear);
    weights.push(0.2); // Market expectation, not actual CPI
  }

  // Weighted average
  let aggregatedEstimate = 0;
  let totalWeight = 0;

  for (let i = 0; i < estimates.length; i++) {
    aggregatedEstimate += estimates[i] * weights[i];
    totalWeight += weights[i];
  }

  if (totalWeight > 0) {
    aggregatedEstimate /= totalWeight;
  } else {
    aggregatedEstimate = 2.5; // Fallback
  }

  // Confidence based on agreement between sources
  const variance = calculateVariance(estimates);
  const confidence = Math.max(0.3, 1 - (variance / 2)); // Lower variance = higher confidence

  return {
    clevelandFed: clevelandFed ?? undefined,
    truflation: truflation ?? undefined,
    breakevens: breakevens ?? undefined,
    aggregatedEstimate,
    confidence,
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Compare inflation nowcast to Kalshi CPI market
 */
export function compareInflationToKalshi(
  data: InflationData,
  kalshiPrice: number,
  kalshiThreshold: number,
  marketType: 'above' | 'below'
): {
  nowcastEstimate: number;
  impliedProbability: number;
  kalshiPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no' | 'hold';
  confidence: number;
  reasoning: string;
} {
  const estimate = data.aggregatedEstimate;

  // Simple probability model based on distance from threshold
  // More sophisticated: use historical nowcast error distribution
  const distanceFromThreshold = estimate - kalshiThreshold;
  const stdDev = 0.3; // Typical nowcast standard error

  // Normal CDF approximation
  const zScore = distanceFromThreshold / stdDev;
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

  const reasoning = `Nowcast: ${estimate.toFixed(2)}% vs threshold ${kalshiThreshold}%. ` +
    `${marketType === 'above' ? 'Above' : 'Below'} probability: ${(impliedProbability * 100).toFixed(0)}% ` +
    `vs market ${(kalshiPrice * 100).toFixed(0)}%`;

  return {
    nowcastEstimate: estimate,
    impliedProbability,
    kalshiPrice,
    edge,
    direction,
    confidence: data.confidence * (absEdge > 0.1 ? 0.9 : 0.7),
    reasoning,
  };
}

/**
 * Format inflation data for display
 */
export function formatInflationReport(data: InflationData): string {
  const lines: string[] = [
    '**📈 Inflation Nowcast**',
    '',
    `Aggregated Estimate: ${data.aggregatedEstimate.toFixed(2)}% YoY`,
    `Confidence: ${(data.confidence * 100).toFixed(0)}%`,
    '',
  ];

  if (data.clevelandFed) {
    lines.push('**Cleveland Fed:**');
    lines.push(`YoY CPI: ${data.clevelandFed.yearOverYearCPI?.toFixed(2) ?? 'N/A'}%`);
    if (data.clevelandFed.coreCPI) {
      lines.push(`Core CPI: ${data.clevelandFed.coreCPI.toFixed(2)}%`);
    }
    lines.push(`Forecast: ${data.clevelandFed.forecastMonth}`);
    lines.push('');
  }

  if (data.truflation) {
    lines.push('**Truflation (Real-time):**');
    lines.push(`YoY: ${data.truflation.yearOverYearCPI?.toFixed(2) ?? 'N/A'}%`);
    if (data.truflation.components) {
      const c = data.truflation.components;
      if (c.food) lines.push(`Food: ${c.food.toFixed(1)}%`);
      if (c.energy) lines.push(`Energy: ${c.energy.toFixed(1)}%`);
      if (c.shelter) lines.push(`Shelter: ${c.shelter.toFixed(1)}%`);
    }
    lines.push('');
  }

  if (data.breakevens) {
    lines.push('**Market Expectations (Breakevens):**');
    lines.push(`5Y: ${data.breakevens.fiveYear.toFixed(2)}% | 10Y: ${data.breakevens.tenYear.toFixed(2)}%`);
  }

  return lines.join('\n');
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function getCurrentForecastMonth(): string {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
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
