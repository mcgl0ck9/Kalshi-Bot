/**
 * Polling Edge Detection
 *
 * Detects opportunities where prediction market prices diverge from
 * polling averages and election forecasts.
 *
 * Edge thesis: Polling aggregators (538, RCP, Silver Bulletin) provide
 * relatively unbiased probability estimates. When markets diverge
 * significantly from these estimates, there may be an edge.
 *
 * Caveats:
 * - Polls have error margins (typically ±3-4%)
 * - Markets may have information not yet in polls
 * - "Herding" can make polls too similar
 * - Likely voter screens may miss turnout shifts
 */

import { logger } from '../utils/index.js';
import {
  fetchPollingDataCached,
  comparePollingToMarket,
  combinePollingWithNews,
  formatPollingData,
  formatPollingEdge,
  type PollingData,
  type PoliticalSignal,
} from '../fetchers/polling.js';
import type { Market } from '../types/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Minimum edge to surface (percentage points)
 */
const MIN_POLLING_EDGE = 5;

/**
 * Keywords that identify political/election markets
 */
const POLITICAL_KEYWORDS = [
  'president',
  'election',
  'electoral',
  'trump',
  'harris',
  'biden',
  'republican',
  'democrat',
  'gop',
  'dnc',
  'rnc',
  'senate',
  'congress',
  'governor',
  'primary',
  'caucus',
  'nomination',
  'nominee',
  'popular vote',
  'swing state',
  'battleground',
];

/**
 * State abbreviations for state-level matching
 */
const SWING_STATES = [
  'arizona', 'az',
  'georgia', 'ga',
  'michigan', 'mi',
  'nevada', 'nv',
  'north carolina', 'nc',
  'pennsylvania', 'pa',
  'wisconsin', 'wi',
];

// =============================================================================
// MARKET MATCHING
// =============================================================================

/**
 * Check if a market is a political/election market
 */
export function isPoliticalMarket(market: Market): boolean {
  const title = market.title.toLowerCase();
  const description = (market.description ?? '').toLowerCase();
  const text = `${title} ${description}`;

  return POLITICAL_KEYWORDS.some(keyword => text.includes(keyword));
}

/**
 * Check if market is a presidential election market
 */
export function isPresidentialMarket(market: Market): boolean {
  const title = market.title.toLowerCase();

  // Must be about president and 2024
  const isPresidential = title.includes('president') ||
    title.includes('electoral') ||
    (title.includes('win') && (title.includes('trump') || title.includes('harris')));

  const is2024 = title.includes('2024') || title.includes('next president');

  return isPresidential && is2024;
}

/**
 * Extract candidate from market title
 */
export function extractCandidate(market: Market): string | null {
  const title = market.title.toLowerCase();

  if (title.includes('trump')) return 'Trump';
  if (title.includes('harris')) return 'Harris';
  if (title.includes('biden')) return 'Biden';
  if (title.includes('republican') || title.includes('gop')) return 'Republican';
  if (title.includes('democrat') || title.includes('democratic')) return 'Democrat';

  return null;
}

/**
 * Extract state from market title if it's a state-level market
 */
export function extractState(market: Market): string | null {
  const title = market.title.toLowerCase();

  for (let i = 0; i < SWING_STATES.length; i += 2) {
    const stateName = SWING_STATES[i];
    const stateAbbr = SWING_STATES[i + 1];

    if (title.includes(stateName) || title.includes(` ${stateAbbr} `)) {
      return stateName.charAt(0).toUpperCase() + stateName.slice(1);
    }
  }

  return null;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

export interface PollingEdge {
  market: Market;
  type: 'polling';
  direction: 'buy_yes' | 'sell_yes';
  edge: number;
  confidence: number;
  reason: string;
  details?: Record<string, unknown>;
  pollingImplied: number;
  marketPrice: number;
  pollingSpread: number;
  candidate: string;
  pollingSources: string[];
  forecastAvailable: boolean;
}

/**
 * Detect edges between polling data and market prices
 */
export async function detectPollingEdges(
  markets: Market[],
  newsSentiment?: Record<string, number>
): Promise<PollingEdge[]> {
  const edges: PollingEdge[] = [];

  // Fetch polling data
  const pollingResult = await fetchPollingDataCached();

  if (!pollingResult) {
    logger.warn('Could not fetch polling data for edge detection');
    return edges;
  }

  const polling = pollingResult.data;
  logger.debug(`Polling data from: ${polling.sources.join(', ')}`);

  // Find presidential markets
  const presidentialMarkets = markets.filter(isPresidentialMarket);

  if (presidentialMarkets.length === 0) {
    logger.debug('No presidential markets found for polling comparison');
    return edges;
  }

  // Build market price map
  const marketPrices: Record<string, number> = {};

  for (const market of presidentialMarkets) {
    const candidate = extractCandidate(market);
    if (candidate && market.price !== undefined) {
      // Convert to percentage (0-100)
      const price = market.price > 1 ? market.price : market.price * 100;
      marketPrices[candidate] = price;
    }
  }

  // Compare to polling
  const pollingEdges = comparePollingToMarket(polling, marketPrices);

  // Convert to Edge format
  for (const pe of pollingEdges) {
    if (pe.edge < MIN_POLLING_EDGE) continue;

    // Find the corresponding market
    const market = presidentialMarkets.find(m => {
      const candidate = extractCandidate(m);
      return candidate?.toLowerCase() === pe.candidate.toLowerCase();
    });

    if (!market) continue;

    const edge: PollingEdge = {
      market,
      type: 'polling',
      direction: pe.direction === 'buy' ? 'buy_yes' : 'sell_yes',
      edge: pe.edge / 100,  // Convert to decimal
      confidence: pe.confidence,
      reason: `Polling implied ${pe.pollingImplied.toFixed(0)}% vs market ${pe.marketPrice.toFixed(0)}¢`,
      details: {
        pollingSource: pe.source,
        forecastAvailable: polling.forecasts && polling.forecasts.length > 0,
        candidatePollingAverage: polling.presidentialAverage?.candidates[pe.candidate],
      },
      pollingImplied: pe.pollingImplied,
      marketPrice: pe.marketPrice,
      pollingSpread: polling.presidentialAverage?.spread ?? 0,
      candidate: pe.candidate,
      pollingSources: polling.sources,
      forecastAvailable: (polling.forecasts?.length ?? 0) > 0,
    };

    // Boost confidence if we have forecast models
    if (polling.forecasts && polling.forecasts.length > 0) {
      edge.confidence = Math.min(0.9, edge.confidence + 0.1);
    }

    // Apply news sentiment if available
    if (newsSentiment) {
      const signals = combinePollingWithNews(polling, newsSentiment);
      const candidateSignal = signals.find(
        s => s.candidate?.toLowerCase() === pe.candidate.toLowerCase()
      );

      if (candidateSignal) {
        // Check if news aligns with polling direction
        const newsAligns =
          (pe.direction === 'buy' && candidateSignal.direction === 'bullish') ||
          (pe.direction === 'sell' && candidateSignal.direction === 'bearish');

        if (newsAligns) {
          edge.confidence = Math.min(0.95, edge.confidence + 0.1);
          edge.reason += ' | News confirms';
        } else if (candidateSignal.direction !== 'neutral') {
          edge.confidence = Math.max(0.4, edge.confidence - 0.1);
          edge.reason += ' | ⚠️ News conflicts';
        }
      }
    }

    edges.push(edge);
  }

  // Sort by edge size
  edges.sort((a, b) => b.edge - a.edge);

  logger.info(`Found ${edges.length} polling edges`);
  return edges;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format polling edge for Discord
 */
export function formatPollingEdgeAlert(edge: PollingEdge): string {
  const action = edge.direction === 'buy_yes' ? '🟢 BUY YES' : '🔴 SELL YES';
  const edgePct = (edge.edge * 100).toFixed(1);

  const lines = [
    `📊 **POLLING EDGE DETECTED**`,
    '',
    `**${edge.market.title}**`,
    '',
    '```',
    `${action} @ ${edge.marketPrice.toFixed(0)}¢`,
    '```',
    '',
    `📍 **Market Price:** ${edge.marketPrice.toFixed(0)}¢`,
    `📊 **Polling Implied:** ${edge.pollingImplied.toFixed(0)}%`,
    `📈 **Edge:** +${edgePct}%`,
    `🎯 **Confidence:** ${(edge.confidence * 100).toFixed(0)}%`,
    '',
    `**Why this edge exists:**`,
    `• ${edge.candidate} polling average implies ${edge.pollingImplied.toFixed(0)}% win probability`,
    `• Market is pricing at ${edge.marketPrice.toFixed(0)}¢`,
  ];

  if (edge.pollingSpread > 0) {
    lines.push(`• Current polling spread: ${edge.pollingSpread.toFixed(1)} points`);
  }

  if (edge.forecastAvailable) {
    lines.push(`• Forecast models available (higher confidence)`);
  }

  lines.push('');
  lines.push(`_Sources: ${edge.pollingSources.join(', ')}_`);

  if (edge.market.url) {
    lines.push('');
    lines.push(`[>>> TRADE NOW <<<](${edge.market.url})`);
  }

  return lines.join('\n');
}

/**
 * Generate polling summary for daily digest
 */
export async function generatePollingSummary(): Promise<string | null> {
  const result = await fetchPollingDataCached();

  if (!result) {
    return null;
  }

  return formatPollingData(result.data);
}
