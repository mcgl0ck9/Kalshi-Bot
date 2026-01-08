/**
 * Health Edge Detector
 *
 * Detects edges in health markets (measles, flu, etc.) by comparing
 * CDC surveillance data against Kalshi market prices.
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
  HEALTH_CONFIG,
  analyzeTimeHorizon,
  meetsTimeHorizonThreshold,
  preFilterMarkets,
} from '../utils/time-horizon.js';
import { calculateExceedanceProbability, type MeaslesData } from '../sources/cdc-measles.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.08;  // Require 8% edge for health markets
const MIN_CONFIDENCE = 0.50;

// Measles threshold patterns in Kalshi titles
const MEASLES_PATTERNS = [
  /measles.*?(\d+,?\d*)\s*(?:cases|or more)/i,
  /(\d+,?\d*)\s*(?:or more\s*)?measles/i,
  />?\s*(\d+,?\d*)\s*cases/i,
];

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'health',
  description: 'Detects edges in health markets using CDC surveillance data',
  sources: ['kalshi', 'cdc-measles'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const measlesData = data['cdc-measles'] as MeaslesData | undefined;
    if (!measlesData) {
      logger.debug('Health detector: No CDC measles data available');
      return edges;
    }

    // Find health-related markets
    const allHealthMarkets = markets.filter(m =>
      m.category === 'health' ||
      m.title.toLowerCase().includes('measles') ||
      m.title.toLowerCase().includes('disease')
    );

    // Apply time horizon pre-filter (filter vague long-term predictions)
    const healthMarkets = preFilterMarkets(allHealthMarkets, HEALTH_CONFIG, 180);
    const filteredCount = allHealthMarkets.length - healthMarkets.length;
    if (filteredCount > 0) {
      logger.info(`Health detector: Filtered ${filteredCount} far-dated health markets`);
    }

    if (healthMarkets.length === 0) {
      logger.debug('Health detector: No health markets found');
      return edges;
    }

    logger.info(`Health detector: Analyzing ${healthMarkets.length} health markets`);

    for (const market of healthMarkets) {
      const edge = analyzeMeaslesMarket(market, measlesData);
      if (edge && meetsTimeHorizonThreshold(market, edge.edge, HEALTH_CONFIG, 'Health')) {
        edges.push(edge);
      }
    }

    if (edges.length > 0) {
      logger.info(`Health detector: Found ${edges.length} edges (after time horizon filtering)`);
    }

    return edges;
  },
});

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

function analyzeMeaslesMarket(market: Market, data: MeaslesData): Edge | null {
  // Extract threshold from market title
  const threshold = extractThreshold(market.title);
  if (!threshold) {
    logger.debug(`Health: Could not extract threshold from "${market.title}"`);
    return null;
  }

  // Calculate probability of exceeding threshold
  const { probability, confidence } = calculateExceedanceProbability(data, threshold);

  if (confidence < MIN_CONFIDENCE) {
    logger.debug(`Health: Low confidence (${confidence}) for ${market.title}`);
    return null;
  }

  // Calculate edge: difference between our probability and market price
  const marketPrice = market.price;  // YES price
  const edge = Math.abs(probability - marketPrice);

  if (edge < MIN_EDGE) {
    return null;
  }

  // Determine direction
  const direction = probability > marketPrice ? 'YES' : 'NO';

  // Build reason with time horizon context
  const reason = buildReason(market, data, threshold, probability, marketPrice, direction, edge);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'health',
      threshold,
      cdcCasesYTD: data.casesYTD,
      projectedYearEnd: data.projectedYearEnd,
      probability,
      marketPrice,
    }
  );
}

function extractThreshold(title: string): number | null {
  for (const pattern of MEASLES_PATTERNS) {
    const match = title.match(pattern);
    if (match && match[1]) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseInt(numStr, 10);
      if (num > 0 && num < 100000) {
        return num;
      }
    }
  }
  return null;
}

function buildReason(
  market: Market,
  data: MeaslesData,
  threshold: number,
  probability: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  edge: number
): string {
  const probPct = (probability * 100).toFixed(0);
  const pricePct = (marketPrice * 100).toFixed(0);
  const edgePct = (edge * 100).toFixed(1);

  // Get time horizon context
  const { label: timeLabel } = analyzeTimeHorizon(market, HEALTH_CONFIG);

  if (direction === 'YES') {
    return `${timeLabel} | **HEALTH** CDC Surveillance | ` +
      `${data.casesYTD} cases YTD (week ${data.weekNumber}) → ${data.projectedYearEnd} projected | ` +
      `${probPct}% exceeds ${threshold} vs ${pricePct}% mkt | ` +
      `→ **${edgePct}% edge**`;
  } else {
    return `${timeLabel} | **HEALTH** CDC Surveillance | ` +
      `${data.casesYTD} cases YTD (week ${data.weekNumber}) → ${data.projectedYearEnd} projected | ` +
      `Only ${probPct}% exceeds ${threshold}, mkt ${pricePct}% | ` +
      `→ **${edgePct}% edge**`;
  }
}
