/**
 * Cross-Platform Edge Detector
 *
 * Finds price divergences between Kalshi and Polymarket.
 * When the same market is priced differently on both platforms,
 * there may be an arbitrage opportunity.
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

const MIN_SIMILARITY = 0.75;  // Minimum title similarity to consider a match
const MIN_PRICE_DIFF = 0.05;  // 5% minimum price difference

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'cross-platform',
  description: 'Detects price divergences between Kalshi and Polymarket',
  sources: ['kalshi', 'polymarket'],
  minEdge: 0.05,

  async detect(data: SourceData, _markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const kalshiMarkets = data.kalshi as Market[] | undefined;
    const polymarketMarkets = data.polymarket as Market[] | undefined;

    if (!kalshiMarkets || !polymarketMarkets) {
      logger.debug('Cross-platform: missing market data');
      return edges;
    }

    // Find matching markets
    for (const kalshi of kalshiMarkets) {
      const match = findBestMatch(kalshi, polymarketMarkets);
      if (!match) continue;

      const { polymarket, similarity } = match;
      const priceDiff = Math.abs(kalshi.price - polymarket.price);

      if (priceDiff < MIN_PRICE_DIFF) continue;

      // Determine direction
      const polymarketHigher = polymarket.price > kalshi.price;
      const direction = polymarketHigher ? 'YES' : 'NO';
      const edge = priceDiff;

      // Higher confidence with higher similarity and bigger difference
      const confidence = Math.min(0.85, 0.5 + similarity * 0.2 + edge * 0.5);

      const reason = polymarketHigher
        ? `Polymarket prices YES at ${(polymarket.price * 100).toFixed(0)}¢ vs Kalshi ${(kalshi.price * 100).toFixed(0)}¢`
        : `Polymarket prices YES at ${(polymarket.price * 100).toFixed(0)}¢ vs Kalshi ${(kalshi.price * 100).toFixed(0)}¢ - Kalshi may be overpriced`;

      edges.push(createEdge(
        kalshi,
        direction,
        edge,
        confidence,
        reason,
        {
          type: 'cross-platform',
          kalshiPrice: kalshi.price,
          polymarketPrice: polymarket.price,
          similarity,
          polymarketTitle: polymarket.title,
        }
      ));
    }

    return edges;
  },
});

// =============================================================================
// MATCHING LOGIC
// =============================================================================

interface MatchResult {
  polymarket: Market;
  similarity: number;
}

/**
 * Find the best matching Polymarket market for a Kalshi market.
 */
function findBestMatch(kalshi: Market, polymarketMarkets: Market[]): MatchResult | null {
  let bestMatch: MatchResult | null = null;

  for (const poly of polymarketMarkets) {
    const similarity = calculateSimilarity(kalshi.title, poly.title);

    if (similarity >= MIN_SIMILARITY) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { polymarket: poly, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * Calculate similarity between two titles.
 * Uses simple word overlap (can be enhanced with NLP).
 */
function calculateSimilarity(title1: string, title2: string): number {
  const words1 = new Set(normalize(title1).split(/\s+/));
  const words2 = new Set(normalize(title2).split(/\s+/));

  // Remove common stopwords
  const stopwords = new Set(['the', 'a', 'an', 'will', 'be', 'in', 'on', 'at', 'to', 'for', 'of']);
  for (const word of stopwords) {
    words1.delete(word);
    words2.delete(word);
  }

  if (words1.size === 0 || words2.size === 0) return 0;

  // Calculate Jaccard similarity
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Normalize a title for comparison.
 */
function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
