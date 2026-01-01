/**
 * Macro Edge Analysis
 *
 * Connects economic indicators to Kalshi market opportunities.
 * Identifies when market prices diverge from nowcast estimates.
 *
 * Key edges:
 * - Fed markets vs FedWatch futures
 * - CPI markets vs inflation nowcast
 * - Jobs markets vs leading indicators
 * - GDP/Recession markets vs GDPNow
 */

import { logger } from '../utils/index.js';
import type { Market, MacroEdgeSignal } from '../types/index.js';
import type {
  FedWatchData,
  InflationData,
  JobsData,
  GDPData,
} from '../types/index.js';

// =============================================================================
// MARKET MATCHING
// =============================================================================

/**
 * Identify what type of macro market a Kalshi market is
 */
export function classifyMacroMarket(market: Market): {
  type: 'fed' | 'cpi' | 'jobs' | 'gdp' | 'recession' | 'none';
  subtype?: string;
  threshold?: number;
  direction?: 'above' | 'below' | 'at';
} {
  const title = market.title?.toLowerCase() ?? '';
  const ticker = market.ticker?.toUpperCase() ?? '';

  // Fed rate markets
  if (title.includes('fed') || title.includes('fomc') || title.includes('interest rate') ||
      ticker.includes('FED') || ticker.includes('FOMC') || ticker.includes('RATE')) {

    // Determine type: cut, hike, hold, specific level
    if (title.includes('cut') || title.includes('lower')) {
      return { type: 'fed', subtype: 'cut' };
    }
    if (title.includes('hike') || title.includes('raise') || title.includes('increase')) {
      return { type: 'fed', subtype: 'hike' };
    }
    if (title.includes('hold') || title.includes('unchanged') || title.includes('same')) {
      return { type: 'fed', subtype: 'hold' };
    }

    // Extract specific rate threshold
    const rateMatch = title.match(/(\d+\.?\d*)%?\s*(?:percent|%)?/);
    if (rateMatch) {
      return { type: 'fed', subtype: 'level', threshold: parseFloat(rateMatch[1]) };
    }

    return { type: 'fed', subtype: 'general' };
  }

  // CPI/Inflation markets
  if (title.includes('cpi') || title.includes('inflation') || title.includes('price index') ||
      ticker.includes('CPI') || ticker.includes('INFL')) {

    // Extract threshold
    const pctMatch = title.match(/(?:above|below|over|under|at least|greater than|less than)\s*(\d+\.?\d*)%?/i);
    const threshold = pctMatch ? parseFloat(pctMatch[1]) : undefined;

    const direction = title.includes('above') || title.includes('over') || title.includes('greater') || title.includes('at least')
      ? 'above'
      : title.includes('below') || title.includes('under') || title.includes('less')
        ? 'below'
        : 'at';

    return { type: 'cpi', threshold, direction };
  }

  // Jobs markets
  if (title.includes('jobs') || title.includes('employment') || title.includes('payroll') ||
      title.includes('nfp') || title.includes('unemployment') ||
      ticker.includes('JOBS') || ticker.includes('NFP') || ticker.includes('UNEMP')) {

    // Extract threshold
    const numMatch = title.match(/(\d+(?:,\d+)?)\s*(?:k|K|thousand|jobs)?/);
    let threshold = numMatch ? parseFloat(numMatch[1].replace(/,/g, '')) : undefined;

    // Convert K to actual number
    if (threshold && threshold < 1000 && (title.includes('k') || title.includes('K') || title.includes('thousand'))) {
      threshold *= 1000;
    }

    const direction = title.includes('above') || title.includes('over') || title.includes('greater') || title.includes('add')
      ? 'above' : 'below';

    return { type: 'jobs', threshold, direction };
  }

  // GDP markets
  if (title.includes('gdp') || title.includes('gross domestic') || title.includes('economic growth') ||
      ticker.includes('GDP')) {

    const pctMatch = title.match(/(\d+\.?\d*)%/);
    const threshold = pctMatch ? parseFloat(pctMatch[1]) : undefined;

    const direction = title.includes('above') || title.includes('over') || title.includes('positive')
      ? 'above' : 'below';

    return { type: 'gdp', threshold, direction };
  }

  // Recession markets
  if (title.includes('recession') || ticker.includes('RECESS')) {
    return { type: 'recession' };
  }

  return { type: 'none' };
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Find edge in Fed markets using FedWatch data
 */
export function findFedEdge(
  market: Market,
  fedWatch: FedWatchData
): MacroEdgeSignal | null {
  const classification = classifyMacroMarket(market);
  if (classification.type !== 'fed') return null;

  const nextMeeting = fedWatch.nextMeeting;
  if (!nextMeeting) return null;

  let indicatorValue: number;
  let indicatorName: string;
  let impliedProbability: number;

  switch (classification.subtype) {
    case 'cut':
      indicatorValue = nextMeeting.probCut;
      indicatorName = 'FedWatch P(Cut)';
      impliedProbability = nextMeeting.probCut;
      break;
    case 'hike':
      indicatorValue = nextMeeting.probHike;
      indicatorName = 'FedWatch P(Hike)';
      impliedProbability = nextMeeting.probHike;
      break;
    case 'hold':
      indicatorValue = nextMeeting.probHold;
      indicatorName = 'FedWatch P(Hold)';
      impliedProbability = nextMeeting.probHold;
      break;
    default:
      indicatorValue = fedWatch.yearEndImpliedRate;
      indicatorName = 'FedWatch Year-End Rate';
      impliedProbability = 0.5; // Can't derive probability for generic
      return null;
  }

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  // Skip if edge is too small (lowered from 3% to 1%)
  if (absEdge < 0.01) return null;

  const direction = edge > 0 ? 'buy_yes' : 'buy_no';
  const signalStrength: 'strong' | 'moderate' | 'weak' =
    absEdge > 0.15 ? 'strong' : absEdge > 0.08 ? 'moderate' : 'weak';

  // FedWatch is very reliable - high confidence
  const confidence = 0.85;

  const reasoning = `FedWatch ${classification.subtype}: ${(impliedProbability * 100).toFixed(0)}% vs ` +
    `Kalshi ${(market.price * 100).toFixed(0)}%. Edge: ${(edge * 100).toFixed(1)}%`;

  return {
    marketId: market.id,
    marketTitle: market.title ?? '',
    marketPlatform: market.platform,
    marketPrice: market.price,
    marketUrl: market.url,
    indicatorType: 'fed',
    indicatorName,
    indicatorValue,
    indicatorSource: 'CME FedWatch',
    impliedProbability,
    edge,
    edgePercent: edge * 100,
    confidence,
    signalStrength,
    direction,
    reasoning,
    maxLoss: direction === 'buy_yes' ? market.price : (1 - market.price),
    expectedValue: edge * confidence,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Find edge in CPI markets using inflation nowcast
 */
export function findCPIEdge(
  market: Market,
  inflation: InflationData
): MacroEdgeSignal | null {
  const classification = classifyMacroMarket(market);
  if (classification.type !== 'cpi' || classification.threshold === undefined) return null;

  const estimate = inflation.aggregatedEstimate;
  const stdDev = 0.3; // Typical nowcast error

  // Calculate probability of being above/below threshold
  const zScore = (estimate - classification.threshold) / stdDev;
  const probAbove = normalCDF(zScore);

  const impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.02) return null;  // lowered from 5% to 2%

  const direction = edge > 0 ? 'buy_yes' : 'buy_no';
  const signalStrength: 'strong' | 'moderate' | 'weak' =
    absEdge > 0.15 ? 'strong' : absEdge > 0.08 ? 'moderate' : 'weak';

  const confidence = inflation.confidence * 0.8;

  const reasoning = `Inflation nowcast: ${estimate.toFixed(2)}% vs threshold ${classification.threshold}%. ` +
    `P(${classification.direction}): ${(impliedProbability * 100).toFixed(0)}% vs Kalshi ${(market.price * 100).toFixed(0)}%`;

  return {
    marketId: market.id,
    marketTitle: market.title ?? '',
    marketPlatform: market.platform,
    marketPrice: market.price,
    marketUrl: market.url,
    indicatorType: 'cpi',
    indicatorName: 'Aggregated Inflation Nowcast',
    indicatorValue: estimate,
    indicatorSource: 'Cleveland Fed + Truflation',
    impliedProbability,
    edge,
    edgePercent: edge * 100,
    confidence,
    signalStrength,
    direction,
    reasoning,
    maxLoss: direction === 'buy_yes' ? market.price : (1 - market.price),
    expectedValue: edge * confidence,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Find edge in Jobs markets using leading indicators
 */
export function findJobsEdge(
  market: Market,
  jobs: JobsData
): MacroEdgeSignal | null {
  const classification = classifyMacroMarket(market);
  if (classification.type !== 'jobs' || !jobs.nfpPrediction) return null;

  const estimate = jobs.nfpPrediction.estimate;
  const threshold = classification.threshold ?? 150000;
  const stdDev = 40000; // NFP typical error

  const zScore = (estimate - threshold) / stdDev;
  const probAbove = normalCDF(zScore);

  const impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.02) return null;  // lowered from 5% to 2%

  const direction = edge > 0 ? 'buy_yes' : 'buy_no';
  const signalStrength: 'strong' | 'moderate' | 'weak' =
    absEdge > 0.15 ? 'strong' : absEdge > 0.08 ? 'moderate' : 'weak';

  // Jobs prediction is less reliable than Fed/CPI
  const confidence = 0.6;

  const reasoning = `NFP estimate: ${Math.round(estimate / 1000)}K vs threshold ${Math.round(threshold / 1000)}K. ` +
    `${jobs.nfpPrediction.reasoning}`;

  return {
    marketId: market.id,
    marketTitle: market.title ?? '',
    marketPlatform: market.platform,
    marketPrice: market.price,
    marketUrl: market.url,
    indicatorType: 'jobs',
    indicatorName: 'NFP Leading Indicator Model',
    indicatorValue: estimate,
    indicatorSource: 'ADP + Claims + ISM',
    impliedProbability,
    edge,
    edgePercent: edge * 100,
    confidence,
    signalStrength,
    direction,
    reasoning,
    maxLoss: direction === 'buy_yes' ? market.price : (1 - market.price),
    expectedValue: edge * confidence,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Find edge in GDP/Recession markets using nowcast
 */
export function findGDPEdge(
  market: Market,
  gdp: GDPData
): MacroEdgeSignal | null {
  const classification = classifyMacroMarket(market);
  if (classification.type !== 'gdp' && classification.type !== 'recession') return null;

  const estimate = gdp.aggregatedEstimate;

  let impliedProbability: number;
  let indicatorName: string;

  if (classification.type === 'recession') {
    // Recession probability
    if (estimate < -1) {
      impliedProbability = 0.6;
    } else if (estimate < 0) {
      impliedProbability = 0.35;
    } else if (estimate < 1) {
      impliedProbability = 0.2;
    } else {
      impliedProbability = 0.1;
    }
    indicatorName = 'Recession Probability Model';
  } else {
    // GDP threshold
    const threshold = classification.threshold ?? 2.0;
    const stdDev = 1.0;
    const zScore = (estimate - threshold) / stdDev;
    const probAbove = normalCDF(zScore);

    impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);
    indicatorName = 'GDP Nowcast Model';
  }

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.02) return null;  // lowered from 5% to 2%

  const direction = edge > 0 ? 'buy_yes' : 'buy_no';
  const signalStrength: 'strong' | 'moderate' | 'weak' =
    absEdge > 0.15 ? 'strong' : absEdge > 0.08 ? 'moderate' : 'weak';

  const confidence = gdp.confidence * 0.75;

  const reasoning = `GDPNow: ${estimate.toFixed(1)}%. Implied ${classification.type} probability: ` +
    `${(impliedProbability * 100).toFixed(0)}% vs Kalshi ${(market.price * 100).toFixed(0)}%`;

  return {
    marketId: market.id,
    marketTitle: market.title ?? '',
    marketPlatform: market.platform,
    marketPrice: market.price,
    marketUrl: market.url,
    indicatorType: 'gdp',
    indicatorName,
    indicatorValue: estimate,
    indicatorSource: 'Atlanta Fed GDPNow',
    impliedProbability,
    edge,
    edgePercent: edge * 100,
    confidence,
    signalStrength,
    direction,
    reasoning,
    maxLoss: direction === 'buy_yes' ? market.price : (1 - market.price),
    expectedValue: edge * confidence,
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// AGGREGATE ANALYSIS
// =============================================================================

export interface MacroEdgeReport {
  signals: MacroEdgeSignal[];
  topOpportunity: MacroEdgeSignal | null;
  totalEdge: number;
  averageConfidence: number;
  byCategory: {
    fed: MacroEdgeSignal[];
    cpi: MacroEdgeSignal[];
    jobs: MacroEdgeSignal[];
    gdp: MacroEdgeSignal[];
  };
  generatedAt: string;
}

/**
 * Analyze all macro markets for edge
 */
export function analyzeMacroEdge(
  markets: Market[],
  data: {
    fedWatch: FedWatchData | null;
    inflation: InflationData;
    jobs: JobsData;
    gdp: GDPData;
  }
): MacroEdgeReport {
  const signals: MacroEdgeSignal[] = [];
  const byCategory = {
    fed: [] as MacroEdgeSignal[],
    cpi: [] as MacroEdgeSignal[],
    jobs: [] as MacroEdgeSignal[],
    gdp: [] as MacroEdgeSignal[],
  };

  for (const market of markets) {
    // Try each type of edge detection
    if (data.fedWatch) {
      const fedEdge = findFedEdge(market, data.fedWatch);
      if (fedEdge) {
        signals.push(fedEdge);
        byCategory.fed.push(fedEdge);
      }
    }

    const cpiEdge = findCPIEdge(market, data.inflation);
    if (cpiEdge) {
      signals.push(cpiEdge);
      byCategory.cpi.push(cpiEdge);
    }

    const jobsEdge = findJobsEdge(market, data.jobs);
    if (jobsEdge) {
      signals.push(jobsEdge);
      byCategory.jobs.push(jobsEdge);
    }

    const gdpEdge = findGDPEdge(market, data.gdp);
    if (gdpEdge) {
      signals.push(gdpEdge);
      byCategory.gdp.push(gdpEdge);
    }
  }

  // Sort by absolute edge
  signals.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  // Calculate aggregates
  const totalEdge = signals.reduce((sum, s) => sum + Math.abs(s.edge), 0);
  const averageConfidence = signals.length > 0
    ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
    : 0;

  return {
    signals,
    topOpportunity: signals[0] ?? null,
    totalEdge,
    averageConfidence,
    byCategory,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format macro edge report for display
 */
export function formatMacroEdgeReport(report: MacroEdgeReport): string {
  const lines: string[] = [
    '**🎯 Macro Edge Analysis**',
    '═══════════════════════════════',
    '',
  ];

  if (report.signals.length === 0) {
    lines.push('No significant macro edges detected.');
    return lines.join('\n');
  }

  lines.push(`Found ${report.signals.length} potential edges`);
  lines.push(`Avg Confidence: ${(report.averageConfidence * 100).toFixed(0)}%`);
  lines.push('');

  // Top opportunities
  lines.push('**Top Opportunities:**');
  for (const signal of report.signals.slice(0, 5)) {
    const dir = signal.direction === 'buy_yes' ? '🟢 BUY YES' : '🔴 BUY NO';
    const edgeStr = signal.edge > 0 ? `+${(signal.edge * 100).toFixed(1)}%` : `${(signal.edge * 100).toFixed(1)}%`;
    lines.push(`${dir} ${signal.marketTitle.slice(0, 40)}...`);
    lines.push(`   Edge: ${edgeStr} | Conf: ${(signal.confidence * 100).toFixed(0)}% | ${signal.signalStrength.toUpperCase()}`);
    lines.push(`   ${signal.reasoning.slice(0, 80)}`);
    lines.push('');
  }

  // By category summary
  lines.push('**By Category:**');
  if (report.byCategory.fed.length > 0) {
    lines.push(`Fed: ${report.byCategory.fed.length} opportunities`);
  }
  if (report.byCategory.cpi.length > 0) {
    lines.push(`CPI: ${report.byCategory.cpi.length} opportunities`);
  }
  if (report.byCategory.jobs.length > 0) {
    lines.push(`Jobs: ${report.byCategory.jobs.length} opportunities`);
  }
  if (report.byCategory.gdp.length > 0) {
    lines.push(`GDP: ${report.byCategory.gdp.length} opportunities`);
  }

  return lines.join('\n');
}

// =============================================================================
// UTILITY
// =============================================================================

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
