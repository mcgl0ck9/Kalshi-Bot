/**
 * Whale Activity Edge Detector
 *
 * Detects edges when Polymarket whale positions diverge from
 * Kalshi market prices. Uses cross-platform matching.
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.08;
const MIN_WHALE_VOLUME = 50000;  // $50K minimum whale volume
const MIN_CONVICTION = 0.65;    // 65% one-sided whale positioning
const MIN_SIMILARITY = 0.70;    // Title similarity for matching

// =============================================================================
// TYPES
// =============================================================================

interface PolymarketMarket {
  id: string;
  title: string;
  price: number;
  volume?: number;
  liquidity?: number;
  tokenId?: string;
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'whale',
  description: 'Detects whale conviction divergences between Polymarket and Kalshi',
  sources: ['kalshi', 'polymarket'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const polymarketMarkets = data['polymarket'] as PolymarketMarket[] | undefined;
    if (!polymarketMarkets?.length) {
      logger.debug('Whale detector: No Polymarket data available');
      return edges;
    }

    // Find matching markets between Kalshi and Polymarket
    const matches = findMatchingMarkets(markets, polymarketMarkets);
    logger.info(`Whale detector: Found ${matches.length} matching markets`);

    for (const match of matches) {
      const edge = analyzeWhaleConviction(match.kalshi, match.polymarket);
      if (edge) {
        edges.push(edge);
      }
    }

    return edges;
  },
});

// =============================================================================
// MARKET MATCHING
// =============================================================================

interface MarketMatch {
  kalshi: Market;
  polymarket: PolymarketMarket;
  similarity: number;
}

function findMatchingMarkets(
  kalshiMarkets: Market[],
  polymarketMarkets: PolymarketMarket[]
): MarketMatch[] {
  const matches: MarketMatch[] = [];

  for (const kalshi of kalshiMarkets) {
    let bestMatch: { poly: PolymarketMarket; similarity: number } | null = null;

    for (const poly of polymarketMarkets) {
      const similarity = calculateSimilarity(kalshi.title, poly.title);

      if (similarity >= MIN_SIMILARITY) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { poly, similarity };
        }
      }
    }

    if (bestMatch) {
      matches.push({
        kalshi,
        polymarket: bestMatch.poly,
        similarity: bestMatch.similarity,
      });
    }
  }

  return matches;
}

function calculateSimilarity(title1: string, title2: string): number {
  const words1 = new Set(normalize(title1).split(/\s+/));
  const words2 = new Set(normalize(title2).split(/\s+/));

  // Remove stopwords
  const stopwords = new Set(['the', 'a', 'an', 'will', 'be', 'in', 'on', 'at', 'to', 'for', 'of', 'by']);
  for (const word of stopwords) {
    words1.delete(word);
    words2.delete(word);
  }

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// WHALE ANALYSIS
// =============================================================================

function analyzeWhaleConviction(
  kalshi: Market,
  polymarket: PolymarketMarket
): Edge | null {
  // Calculate price divergence
  const priceDiff = Math.abs(polymarket.price - kalshi.price);

  if (priceDiff < MIN_EDGE) {
    return null;
  }

  // Determine which platform has higher price
  const polymarketHigher = polymarket.price > kalshi.price;

  // If Polymarket whales are buying (higher price), that's our signal
  const direction: 'YES' | 'NO' = polymarketHigher ? 'YES' : 'NO';

  // Calculate confidence based on liquidity and price difference
  let confidence = 0.60;

  if ((polymarket.liquidity ?? 0) > MIN_WHALE_VOLUME) {
    confidence += 0.10;
  }

  if (priceDiff >= 0.15) {
    confidence += 0.10;
  } else if (priceDiff >= 0.10) {
    confidence += 0.05;
  }

  confidence = Math.min(0.85, confidence);

  const reason = buildReason(kalshi, polymarket, direction, priceDiff);

  return createEdge(
    kalshi,
    direction,
    priceDiff,
    confidence,
    reason,
    {
      type: 'whale',
      kalshiPrice: kalshi.price,
      polymarketPrice: polymarket.price,
      polymarketLiquidity: polymarket.liquidity,
      polymarketVolume: polymarket.volume,
      polymarketTitle: polymarket.title,
    }
  );
}

function buildReason(
  kalshi: Market,
  polymarket: PolymarketMarket,
  direction: 'YES' | 'NO',
  edge: number
): string {
  const kalshiPct = (kalshi.price * 100).toFixed(0);
  const polyPct = (polymarket.price * 100).toFixed(0);
  const edgePct = (edge * 100).toFixed(1);
  const liquidity = polymarket.liquidity
    ? `$${(polymarket.liquidity / 1000).toFixed(0)}K`
    : 'unknown';

  if (direction === 'YES') {
    return `Polymarket prices YES at ${polyPct}¢ vs Kalshi ${kalshiPct}¢ (${edgePct}% edge). ` +
      `Polymarket liquidity: ${liquidity}. Smart money sees higher probability.`;
  } else {
    return `Polymarket prices YES at ${polyPct}¢ vs Kalshi ${kalshiPct}¢ (${edgePct}% edge). ` +
      `Kalshi may be overpriced relative to Polymarket consensus.`;
  }
}
