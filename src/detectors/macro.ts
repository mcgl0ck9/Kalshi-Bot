/**
 * Macro Edge Detector - v4 Architecture
 *
 * Detects edges in macroeconomic markets by comparing:
 * - Fed markets vs FedWatch futures
 * - CPI markets vs inflation nowcast
 * - Jobs markets vs leading indicators
 * - GDP/Recession markets vs GDPNow
 *
 * Uses defineDetector() pattern for auto-registration.
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import {
  ECON_CONFIG,
  analyzeTimeHorizon,
  meetsTimeHorizonThreshold,
  preFilterMarkets,
} from '../utils/time-horizon.js';
import type { FedNowcastData, GDPNowcast, InflationNowcast } from '../sources/fed-nowcasts.js';
import type { OptionsImpliedData, FedFundsImplied } from '../sources/options-implied.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.02;          // 2% minimum edge
const FED_CONFIDENCE = 0.85;    // FedWatch is very reliable
const CPI_CONFIDENCE = 0.70;    // Nowcast has some uncertainty
const GDP_CONFIDENCE = 0.65;    // GDP nowcast has wider error bars
const JOBS_CONFIDENCE = 0.60;   // Jobs prediction less reliable

// =============================================================================
// TYPES
// =============================================================================

type MacroType = 'fed' | 'cpi' | 'jobs' | 'gdp' | 'recession' | 'none';

interface MacroClassification {
  type: MacroType;
  subtype?: string;
  threshold?: number;
  direction?: 'above' | 'below' | 'at';
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export const macroDetector = defineDetector({
  name: 'macro',
  description: 'Detects edges in macroeconomic markets (GDP, CPI, Jobs, Fed)',
  sources: ['kalshi', 'fed-nowcasts', 'options-implied'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Get source data
    const fedNowcasts = data['fed-nowcasts'] as FedNowcastData | undefined;
    const optionsData = data['options-implied'] as OptionsImpliedData | undefined;

    if (!fedNowcasts && !optionsData) {
      logger.debug('Macro detector: No nowcast or options data available');
      return edges;
    }

    // Filter to macro category markets
    const allMacroMarkets = markets.filter(m =>
      m.category === 'macro' ||
      classifyMacroMarket(m).type !== 'none'
    );

    // Apply time horizon pre-filter (3 weeks, with futures requiring extreme edge)
    const macroMarkets = preFilterMarkets(allMacroMarkets, ECON_CONFIG, 60);
    const filteredCount = allMacroMarkets.length - macroMarkets.length;
    if (filteredCount > 0) {
      logger.info(`Macro detector: Filtered ${filteredCount} far-dated markets`);
    }

    logger.debug(`Macro detector: Analyzing ${macroMarkets.length} macro markets`);

    for (const market of macroMarkets) {
      const classification = classifyMacroMarket(market);

      if (classification.type === 'none') continue;

      let edge: Edge | null = null;

      switch (classification.type) {
        case 'fed':
          edge = findFedEdge(market, classification, optionsData?.fedFunds ?? null);
          break;
        case 'cpi':
          edge = findCPIEdge(market, classification, fedNowcasts?.inflation ?? null);
          break;
        case 'gdp':
        case 'recession':
          edge = findGDPEdge(market, classification, fedNowcasts?.gdp ?? null, optionsData?.treasury ?? null);
          break;
        case 'jobs':
          edge = findJobsEdge(market, classification, fedNowcasts?.gdp ?? null);
          break;
      }

      // Apply time horizon threshold check
      if (edge && edge.edge >= MIN_EDGE && meetsTimeHorizonThreshold(market, edge.edge, ECON_CONFIG, 'Macro')) {
        edges.push(edge);
      }
    }

    logger.info(`Macro detector: Found ${edges.length} edges (after time horizon filtering)`);
    return edges;
  },
});

export default macroDetector;

// =============================================================================
// MARKET CLASSIFICATION
// =============================================================================

/**
 * Identify what type of macro market a Kalshi market is
 */
function classifyMacroMarket(market: Market): MacroClassification {
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
// EDGE DETECTION FUNCTIONS
// =============================================================================

/**
 * Find edge in Fed markets using FedWatch data
 */
function findFedEdge(
  market: Market,
  classification: MacroClassification,
  fedFunds: FedFundsImplied | null
): Edge | null {
  if (!fedFunds) return null;

  let impliedProbability: number;
  let indicatorName: string;

  switch (classification.subtype) {
    case 'cut':
      impliedProbability = fedFunds.probCut25 + fedFunds.probCut50;
      indicatorName = 'FedWatch P(Cut)';
      break;
    case 'hike':
      impliedProbability = fedFunds.probHike25 + fedFunds.probHike50;
      indicatorName = 'FedWatch P(Hike)';
      break;
    case 'hold':
      impliedProbability = fedFunds.probHold;
      indicatorName = 'FedWatch P(Hold)';
      break;
    default:
      // Can't derive probability for generic fed markets
      return null;
  }

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < MIN_EDGE) return null;

  const direction = edge > 0 ? 'YES' : 'NO';

  const reason = `FedWatch ${classification.subtype}: ${(impliedProbability * 100).toFixed(0)}% vs ` +
    `Kalshi ${(market.price * 100).toFixed(0)}%. Edge: ${(edge * 100).toFixed(1)}%`;

  return createEdge(
    market,
    direction,
    absEdge,
    FED_CONFIDENCE,
    reason,
    {
      type: 'macro',
      subtype: 'fed',
      indicatorName,
      indicatorValue: impliedProbability,
      indicatorSource: fedFunds.source === 'cme' ? 'CME FedWatch' : 'Treasury Implied',
      impliedProbability,
      meetingDate: fedFunds.meetingDate,
    }
  );
}

/**
 * Find edge in CPI markets using inflation nowcast
 */
function findCPIEdge(
  market: Market,
  classification: MacroClassification,
  inflation: InflationNowcast | null
): Edge | null {
  if (!inflation || classification.threshold === undefined) return null;

  const estimate = inflation.headline;
  const stdDev = 0.3; // Typical nowcast error

  // Calculate probability of being above/below threshold
  const zScore = (estimate - classification.threshold) / stdDev;
  const probAbove = normalCDF(zScore);

  const impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < MIN_EDGE) return null;

  const direction = edge > 0 ? 'YES' : 'NO';

  const reason = `Inflation nowcast: ${estimate.toFixed(2)}% vs threshold ${classification.threshold}%. ` +
    `P(${classification.direction}): ${(impliedProbability * 100).toFixed(0)}% vs Kalshi ${(market.price * 100).toFixed(0)}%`;

  return createEdge(
    market,
    direction,
    absEdge,
    CPI_CONFIDENCE,
    reason,
    {
      type: 'macro',
      subtype: 'cpi',
      indicatorName: 'Inflation Nowcast',
      indicatorValue: estimate,
      indicatorSource: 'Cleveland Fed / FRED',
      impliedProbability,
      threshold: classification.threshold,
    }
  );
}

/**
 * Find edge in GDP/Recession markets using nowcast
 */
function findGDPEdge(
  market: Market,
  classification: MacroClassification,
  gdp: GDPNowcast | null,
  treasury: { recessionProb12m: number; curve2s10s: number; curve3m10y: number } | null
): Edge | null {
  let impliedProbability: number;
  let indicatorName: string;
  let indicatorValue: number;
  let indicatorSource: string;

  if (classification.type === 'recession') {
    // Use treasury curve for recession probability
    if (treasury) {
      impliedProbability = treasury.recessionProb12m;
      indicatorName = 'Yield Curve Recession Model';
      indicatorValue = treasury.curve3m10y;
      indicatorSource = 'NY Fed Recession Model';
    } else if (gdp) {
      // Fallback: derive from GDP
      if (gdp.estimate < -1) {
        impliedProbability = 0.6;
      } else if (gdp.estimate < 0) {
        impliedProbability = 0.35;
      } else if (gdp.estimate < 1) {
        impliedProbability = 0.2;
      } else {
        impliedProbability = 0.1;
      }
      indicatorName = 'GDP-Derived Recession Probability';
      indicatorValue = gdp.estimate;
      indicatorSource = 'Atlanta Fed GDPNow';
    } else {
      return null;
    }
  } else {
    // GDP threshold market
    if (!gdp) return null;

    const threshold = classification.threshold ?? 2.0;
    const stdDev = 1.0;
    const zScore = (gdp.estimate - threshold) / stdDev;
    const probAbove = normalCDF(zScore);

    impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);
    indicatorName = 'GDP Nowcast Model';
    indicatorValue = gdp.estimate;
    indicatorSource = 'Atlanta Fed GDPNow';
  }

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < MIN_EDGE) return null;

  const direction = edge > 0 ? 'YES' : 'NO';

  const reason = `${indicatorName}: ${indicatorValue.toFixed(1)}. Implied probability: ` +
    `${(impliedProbability * 100).toFixed(0)}% vs Kalshi ${(market.price * 100).toFixed(0)}%`;

  return createEdge(
    market,
    direction,
    absEdge,
    GDP_CONFIDENCE,
    reason,
    {
      type: 'macro',
      subtype: classification.type,
      indicatorName,
      indicatorValue,
      indicatorSource,
      impliedProbability,
    }
  );
}

/**
 * Find edge in Jobs markets using GDP as leading indicator
 * (Jobs data often correlates with economic growth)
 */
function findJobsEdge(
  market: Market,
  classification: MacroClassification,
  gdp: GDPNowcast | null
): Edge | null {
  if (!gdp) return null;

  // Use GDP as proxy for jobs expectation
  // Higher GDP growth = stronger jobs
  const threshold = classification.threshold ?? 150000;

  // Map GDP to expected NFP range
  // GDP 3%+ -> ~200K jobs, GDP 2% -> ~150K, GDP 1% -> ~100K, GDP 0% -> ~50K
  const expectedJobs = 50000 + (gdp.estimate * 50000);
  const stdDev = 40000; // NFP typical error

  const zScore = (expectedJobs - threshold) / stdDev;
  const probAbove = normalCDF(zScore);

  const impliedProbability = classification.direction === 'above' ? probAbove : (1 - probAbove);

  const edge = impliedProbability - market.price;
  const absEdge = Math.abs(edge);

  if (absEdge < MIN_EDGE) return null;

  const direction = edge > 0 ? 'YES' : 'NO';

  const reason = `GDP-implied NFP estimate: ${Math.round(expectedJobs / 1000)}K vs threshold ${Math.round(threshold / 1000)}K. ` +
    `GDPNow at ${gdp.estimate.toFixed(1)}% suggests ${classification.direction === 'above' ? 'stronger' : 'weaker'} jobs.`;

  return createEdge(
    market,
    direction,
    absEdge,
    JOBS_CONFIDENCE,
    reason,
    {
      type: 'macro',
      subtype: 'jobs',
      indicatorName: 'GDP-Derived NFP Model',
      indicatorValue: expectedJobs,
      indicatorSource: 'Atlanta Fed GDPNow (derived)',
      impliedProbability,
      threshold,
    }
  );
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
  const absZ = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);

  return 0.5 * (1.0 + sign * y);
}
