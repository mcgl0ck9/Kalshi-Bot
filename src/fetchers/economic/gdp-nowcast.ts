/**
 * GDP Nowcast Fetchers
 *
 * Fetches real-time GDP estimates from:
 * - Atlanta Fed GDPNow (most widely followed)
 * - NY Fed Nowcast
 *
 * Use cases:
 * - Compare to Kalshi GDP/recession markets
 * - Track economic growth trajectory
 * - Early signal on economic conditions
 */

import { logger } from '../../utils/index.js';
import type { GDPNowcast, GDPData } from '../../types/index.js';

// =============================================================================
// ATLANTA FED GDPNOW
// =============================================================================

/**
 * Fetch Atlanta Fed GDPNow
 * The gold standard for real-time GDP nowcasting
 * https://www.atlantafed.org/cqer/research/gdpnow
 */
export async function fetchAtlantaFedGDPNow(): Promise<GDPNowcast | null> {
  try {
    const url = 'https://www.atlantafed.org/cqer/research/gdpnow';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`Atlanta Fed fetch failed: ${response.status}`);
      return generateAtlantaFedFallback();
    }

    const html = await response.text();

    // GDPNow displays: "The GDPNow model estimate for real GDP growth (SAAR) in Q4 2024 is X.X percent"
    const gdpPattern = /(?:GDPNow|GDP\s*Now)\s*(?:model\s+)?(?:estimate|forecast)[^-\d]*(-?\d+\.?\d*)\s*percent/i;
    const simplePattern = /(?:Q[1-4]\s+\d{4})[^-\d]*(-?\d+\.?\d*)\s*percent/i;
    const numberPattern = /estimate[:\s]+(-?\d+\.?\d*)%/i;

    let estimate: number | undefined;

    const match = html.match(gdpPattern) || html.match(simplePattern) || html.match(numberPattern);
    if (match) {
      estimate = parseFloat(match[1]);
    }

    // Extract quarter
    const quarterPattern = /(Q[1-4])\s*(\d{4})/i;
    const quarterMatch = html.match(quarterPattern);
    const quarter = quarterMatch ? `${quarterMatch[1]} ${quarterMatch[2]}` : getCurrentQuarter();

    // Extract components if available
    const consumptionPattern = /(?:personal\s+)?consumption[:\s]+(-?\d+\.?\d*)/i;
    const investmentPattern = /(?:gross\s+private\s+)?investment[:\s]+(-?\d+\.?\d*)/i;
    const netExportsPattern = /net\s+exports?[:\s]+(-?\d+\.?\d*)/i;
    const governmentPattern = /government[:\s]+(-?\d+\.?\d*)/i;

    const components: GDPNowcast['components'] = {};
    const consumptionMatch = html.match(consumptionPattern);
    const investmentMatch = html.match(investmentPattern);
    const netExportsMatch = html.match(netExportsPattern);
    const governmentMatch = html.match(governmentPattern);

    if (consumptionMatch) components.personalConsumption = parseFloat(consumptionMatch[1]);
    if (investmentMatch) components.grossPrivateInvestment = parseFloat(investmentMatch[1]);
    if (netExportsMatch) components.netExports = parseFloat(netExportsMatch[1]);
    if (governmentMatch) components.governmentSpending = parseFloat(governmentMatch[1]);

    // Extract date of estimate
    const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s*(\d{4})/i;
    const dateMatch = html.match(datePattern);
    const asOfDate = dateMatch
      ? `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`
      : new Date().toISOString().split('T')[0];

    if (estimate === undefined) {
      return generateAtlantaFedFallback();
    }

    return {
      quarter,
      estimate,
      components: Object.keys(components).length > 0 ? components : undefined,
      source: 'Atlanta Fed GDPNow',
      sourceUrl: url,
      asOfDate,
      nextUpdate: getNextGDPNowUpdate(),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Atlanta Fed GDPNow error: ${error}`);
    return generateAtlantaFedFallback();
  }
}

/**
 * Generate fallback Atlanta Fed data
 */
function generateAtlantaFedFallback(): GDPNowcast {
  return {
    quarter: getCurrentQuarter(),
    estimate: 2.5, // Placeholder - UPDATE FROM ACTUAL DATA
    source: 'Atlanta Fed GDPNow Fallback (manual update needed)',
    sourceUrl: 'https://www.atlantafed.org/cqer/research/gdpnow',
    asOfDate: new Date().toISOString().split('T')[0],
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// NY FED NOWCAST
// =============================================================================

/**
 * Fetch NY Fed Staff Nowcast
 * https://www.newyorkfed.org/research/policy/nowcast
 */
export async function fetchNYFedNowcast(): Promise<GDPNowcast | null> {
  try {
    const url = 'https://www.newyorkfed.org/research/policy/nowcast';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      logger.warn(`NY Fed fetch failed: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // NY Fed Nowcast format varies
    const gdpPattern = /(?:nowcast|forecast|estimate)[^-\d]*(-?\d+\.?\d*)(?:\s*%|\s*percent)/i;
    const quarterPattern = /(Q[1-4])\s*(\d{4})/i;

    const gdpMatch = html.match(gdpPattern);
    const quarterMatch = html.match(quarterPattern);

    if (!gdpMatch) {
      logger.debug('Could not extract NY Fed nowcast value');
      return null;
    }

    return {
      quarter: quarterMatch ? `${quarterMatch[1]} ${quarterMatch[2]}` : getCurrentQuarter(),
      estimate: parseFloat(gdpMatch[1]),
      source: 'NY Fed Staff Nowcast',
      sourceUrl: url,
      asOfDate: new Date().toISOString().split('T')[0],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`NY Fed nowcast error: ${error}`);
    return null;
  }
}

// =============================================================================
// AGGREGATED GDP DATA
// =============================================================================

/**
 * Fetch all GDP nowcast sources
 */
export async function fetchGDPData(): Promise<GDPData> {
  const [atlantaFed, nyFed] = await Promise.all([
    fetchAtlantaFedGDPNow(),
    fetchNYFedNowcast(),
  ]);

  // Aggregate estimates
  const estimates: number[] = [];
  const weights: number[] = [];

  if (atlantaFed) {
    estimates.push(atlantaFed.estimate);
    weights.push(0.6); // Atlanta Fed is more widely followed
  }

  if (nyFed) {
    estimates.push(nyFed.estimate);
    weights.push(0.4);
  }

  let aggregatedEstimate = 0;
  let totalWeight = 0;

  for (let i = 0; i < estimates.length; i++) {
    aggregatedEstimate += estimates[i] * weights[i];
    totalWeight += weights[i];
  }

  if (totalWeight > 0) {
    aggregatedEstimate /= totalWeight;
  } else {
    aggregatedEstimate = 2.0; // Fallback
  }

  // Confidence based on agreement
  const variance = estimates.length > 1
    ? Math.pow(estimates[0] - estimates[1], 2)
    : 0;
  const confidence = Math.max(0.5, 1 - (variance / 10));

  return {
    atlantaFed: atlantaFed ?? undefined,
    nyFed: nyFed ?? undefined,
    aggregatedEstimate,
    confidence,
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Compare GDP nowcast to Kalshi GDP/recession markets
 */
export function compareGDPToKalshi(
  data: GDPData,
  kalshiPrice: number,
  kalshiThreshold: number,
  marketType: 'above' | 'below' | 'recession'
): {
  gdpEstimate: number;
  impliedProbability: number;
  kalshiPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no' | 'hold';
  confidence: number;
  reasoning: string;
} {
  const estimate = data.aggregatedEstimate;
  const stdDev = 1.0; // GDP nowcast typical error

  let impliedProbability: number;
  let reasoning: string;

  if (marketType === 'recession') {
    // Recession defined as 2 consecutive quarters of negative growth
    // Single quarter nowcast gives partial signal
    const probNegative = normalCDF(-estimate / stdDev);

    // If current quarter negative, need to estimate next quarter
    // Simplified: if current nowcast is very negative, recession more likely
    if (estimate < -1) {
      impliedProbability = 0.6 + (-estimate * 0.1); // Higher as more negative
    } else if (estimate < 0) {
      impliedProbability = 0.3 + (-estimate * 0.2);
    } else {
      impliedProbability = 0.1 + (probNegative * 0.3);
    }
    impliedProbability = Math.min(0.9, Math.max(0.05, impliedProbability));

    reasoning = `GDPNow: ${estimate.toFixed(1)}%. Recession signal: ${estimate < 0 ? 'Warning' : 'Low risk'}`;
  } else {
    // Above/below specific threshold
    const zScore = (estimate - kalshiThreshold) / stdDev;
    const probAbove = normalCDF(zScore);

    impliedProbability = marketType === 'above' ? probAbove : (1 - probAbove);

    reasoning = `GDPNow: ${estimate.toFixed(1)}% vs threshold ${kalshiThreshold}%. ` +
      `${marketType === 'above' ? 'Above' : 'Below'} probability: ${(impliedProbability * 100).toFixed(0)}%`;
  }

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

  return {
    gdpEstimate: estimate,
    impliedProbability,
    kalshiPrice,
    edge,
    direction,
    confidence: data.confidence * (absEdge > 0.1 ? 0.85 : 0.65),
    reasoning,
  };
}

/**
 * Analyze GDP trajectory for recession risk
 */
export function analyzeRecessionRisk(
  currentGDP: GDPData,
  previousQuarterGDP?: number
): {
  riskLevel: 'low' | 'moderate' | 'high' | 'recession';
  probability: number;
  reasoning: string;
  signals: string[];
} {
  const estimate = currentGDP.aggregatedEstimate;
  const signals: string[] = [];
  let riskScore = 0;

  // Signal 1: Current quarter estimate
  if (estimate < -1) {
    riskScore += 3;
    signals.push(`Current Q estimate negative: ${estimate.toFixed(1)}%`);
  } else if (estimate < 0.5) {
    riskScore += 2;
    signals.push(`Current Q estimate weak: ${estimate.toFixed(1)}%`);
  } else if (estimate < 1.5) {
    riskScore += 1;
    signals.push(`Current Q estimate below trend: ${estimate.toFixed(1)}%`);
  } else {
    signals.push(`Current Q estimate solid: ${estimate.toFixed(1)}%`);
  }

  // Signal 2: Previous quarter (if available)
  if (previousQuarterGDP !== undefined) {
    if (previousQuarterGDP < 0 && estimate < 0) {
      riskScore += 5; // Two negative quarters = technical recession
      signals.push('Two consecutive negative quarters!');
    } else if (previousQuarterGDP < 0) {
      riskScore += 2;
      signals.push(`Previous Q was negative: ${previousQuarterGDP.toFixed(1)}%`);
    }
  }

  // Signal 3: Atlanta Fed vs NY Fed disagreement
  if (currentGDP.atlantaFed && currentGDP.nyFed) {
    const disagreement = Math.abs(currentGDP.atlantaFed.estimate - currentGDP.nyFed.estimate);
    if (disagreement > 1) {
      riskScore += 1;
      signals.push(`High uncertainty: ATL ${currentGDP.atlantaFed.estimate.toFixed(1)}% vs NY ${currentGDP.nyFed.estimate.toFixed(1)}%`);
    }
  }

  // Determine risk level
  let riskLevel: 'low' | 'moderate' | 'high' | 'recession';
  let probability: number;

  if (riskScore >= 5) {
    riskLevel = 'recession';
    probability = 0.7;
  } else if (riskScore >= 3) {
    riskLevel = 'high';
    probability = 0.4;
  } else if (riskScore >= 2) {
    riskLevel = 'moderate';
    probability = 0.2;
  } else {
    riskLevel = 'low';
    probability = 0.1;
  }

  const reasoning = `Recession risk: ${riskLevel.toUpperCase()} (${(probability * 100).toFixed(0)}% probability)`;

  return {
    riskLevel,
    probability,
    reasoning,
    signals,
  };
}

/**
 * Format GDP data for display
 */
export function formatGDPReport(data: GDPData): string {
  const lines: string[] = [
    '**📊 GDP Nowcast**',
    '',
    `Aggregated Estimate: ${data.aggregatedEstimate.toFixed(2)}%`,
    `Confidence: ${(data.confidence * 100).toFixed(0)}%`,
    '',
  ];

  if (data.atlantaFed) {
    lines.push('**Atlanta Fed GDPNow:**');
    lines.push(`${data.atlantaFed.quarter}: ${data.atlantaFed.estimate.toFixed(1)}%`);
    lines.push(`As of: ${data.atlantaFed.asOfDate}`);

    if (data.atlantaFed.components) {
      const c = data.atlantaFed.components;
      lines.push('Components:');
      if (c.personalConsumption !== undefined) lines.push(`  Consumption: ${c.personalConsumption.toFixed(1)}pp`);
      if (c.grossPrivateInvestment !== undefined) lines.push(`  Investment: ${c.grossPrivateInvestment.toFixed(1)}pp`);
      if (c.netExports !== undefined) lines.push(`  Net Exports: ${c.netExports.toFixed(1)}pp`);
      if (c.governmentSpending !== undefined) lines.push(`  Government: ${c.governmentSpending.toFixed(1)}pp`);
    }
    lines.push('');
  }

  if (data.nyFed) {
    lines.push('**NY Fed Nowcast:**');
    lines.push(`${data.nyFed.quarter}: ${data.nyFed.estimate.toFixed(1)}%`);
    lines.push('');
  }

  // Add recession analysis
  const recession = analyzeRecessionRisk(data);
  lines.push('**Recession Risk:**');
  lines.push(`${recession.reasoning}`);
  for (const signal of recession.signals) {
    lines.push(`• ${signal}`);
  }

  return lines.join('\n');
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function getCurrentQuarter(): string {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  let quarter: number;
  if (month < 3) quarter = 1;
  else if (month < 6) quarter = 2;
  else if (month < 9) quarter = 3;
  else quarter = 4;

  return `Q${quarter} ${year}`;
}

function getNextGDPNowUpdate(): string {
  // GDPNow typically updates on specific days after data releases
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  return `${months[tomorrow.getMonth()]} ${tomorrow.getDate()}, ${tomorrow.getFullYear()}`;
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
