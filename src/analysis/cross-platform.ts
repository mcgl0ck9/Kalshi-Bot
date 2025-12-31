/**
 * Cross-Platform Analysis Module
 *
 * Compares prices between Kalshi and Polymarket to find:
 * - Price divergences (potential edges)
 * - Platform sentiment differences
 * - Which platform moves first
 */

import type { Market, CrossPlatformMatch } from '../types/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// ENTITY EXTRACTION
// =============================================================================

const ENTITY_ALIASES: Record<string, string[]> = {
  // Crypto
  bitcoin: ['bitcoin', 'btc'],
  ethereum: ['ethereum', 'eth'],
  crypto: ['crypto', 'cryptocurrency'],
  // People
  trump: ['trump', 'donald trump'],
  biden: ['biden', 'joe biden'],
  musk: ['musk', 'elon musk', 'elon'],
  powell: ['powell', 'jerome powell', 'fed chair'],
  // Organizations
  fed: ['fed', 'federal reserve', 'fomc'],
  sec: ['sec', 'securities and exchange'],
  // Topics
  election: ['election', 'presidential', 'vote', 'voting'],
  rate: ['rate', 'interest rate', 'rate cut', 'rate hike'],
  recession: ['recession', 'economic downturn'],
  inflation: ['inflation', 'cpi', 'prices'],
};

/**
 * Extract key entities from a title
 */
function extractKeyEntities(title: string): Set<string> {
  const entities = new Set<string>();
  const titleLower = title.toLowerCase();

  for (const [mainEntity, aliases] of Object.entries(ENTITY_ALIASES)) {
    if (aliases.some(alias => titleLower.includes(alias))) {
      entities.add(mainEntity);
    }
  }

  // Extract years and numbers
  const numbers = titleLower.match(/\b(20\d{2}|\$?\d+k|\d+,\d+)\b/g);
  if (numbers) {
    numbers.forEach(n => entities.add(n));
  }

  return entities;
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
  if (!title) return '';

  // Lowercase and remove punctuation
  let normalized = title.toLowerCase().replace(/[^\w\s]/g, '');

  // Remove common stop words
  const stopWords = new Set(['will', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'before', 'after']);
  const words = normalized.split(/\s+/).filter(w => !stopWords.has(w));

  return words.join(' ');
}

/**
 * Calculate similarity between two titles using Jaccard + entity overlap
 */
export function calculateTitleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  if (!norm1 || !norm2) return 0;

  // Word-level Jaccard similarity
  const words1 = new Set(norm1.split(/\s+/));
  const words2 = new Set(norm2.split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  const jaccardSimilarity = intersection.size / union.size;

  // Entity overlap
  const entities1 = extractKeyEntities(title1);
  const entities2 = extractKeyEntities(title2);

  let entityOverlap = 0;
  if (entities1.size > 0 && entities2.size > 0) {
    const entityIntersection = new Set([...entities1].filter(e => entities2.has(e)));
    entityOverlap = entityIntersection.size / Math.max(entities1.size, entities2.size);
  }

  // Weight entity overlap more heavily
  return jaccardSimilarity * 0.4 + entityOverlap * 0.6;
}

// =============================================================================
// CROSS-PLATFORM MATCHING
// =============================================================================

/**
 * Match markets between Kalshi and Polymarket
 */
export function matchMarketsCrossPlatform(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[],
  minSimilarity: number = 0.5
): CrossPlatformMatch[] {
  const matches: CrossPlatformMatch[] = [];
  const usedPolymarketIds = new Set<string>();

  for (const kalshi of kalshiMarkets) {
    if (!kalshi.title || !kalshi.price) continue;

    let bestMatch: Market | null = null;
    let bestSimilarity = minSimilarity;

    for (const poly of polymarketMarkets) {
      if (usedPolymarketIds.has(poly.id)) continue;
      if (!poly.title || !poly.price) continue;

      const similarity = calculateTitleSimilarity(kalshi.title, poly.title);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = poly;
      }
    }

    if (bestMatch) {
      usedPolymarketIds.add(bestMatch.id);

      const priceDiff = bestMatch.price - kalshi.price;

      matches.push({
        kalshi,
        polymarket: bestMatch,
        similarity: bestSimilarity,
        kalshiPrice: kalshi.price,
        polymarketPrice: bestMatch.price,
        priceDifference: priceDiff,
        absDifference: Math.abs(priceDiff),
        polymarketMoreBullish: priceDiff > 0,
        category: kalshi.category ?? bestMatch.category ?? 'other',
      });
    }
  }

  // Sort by absolute price difference
  matches.sort((a, b) => b.absDifference - a.absDifference);

  logger.info(`Found ${matches.length} cross-platform market matches`);
  return matches;
}

/**
 * Filter to only markets with significant price divergence
 */
export function getDivergentMarkets(
  matches: CrossPlatformMatch[],
  minDivergence: number = 0.05
): CrossPlatformMatch[] {
  const divergent = matches.filter(m => m.absDifference >= minDivergence);
  logger.info(`Found ${divergent.length} markets with >${minDivergence * 100}% divergence`);
  return divergent;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format a single cross-platform comparison for display
 */
export function formatCrossPlatformComparison(match: CrossPlatformMatch): string {
  const { kalshi, polymarket, kalshiPrice, polymarketPrice, priceDifference } = match;

  const title = (kalshi.title ?? '').slice(0, 60);

  let sentiment: string;
  let arrow: string;

  if (priceDifference > 0) {
    sentiment = 'Polymarket more bullish';
    arrow = '📈';
  } else if (priceDifference < 0) {
    sentiment = 'Kalshi more bullish';
    arrow = '📉';
  } else {
    sentiment = 'Same price';
    arrow = '➡️';
  }

  return [
    `${arrow} **${title}**`,
    `   Kalshi: ${(kalshiPrice * 100).toFixed(0)}¢ | Polymarket: ${(polymarketPrice * 100).toFixed(0)}¢ | Δ ${(priceDifference * 100).toFixed(0)}%`,
    `   ${sentiment}`,
    `   [K](${kalshi.url}) | [P](${polymarket.url})`,
  ].join('\n');
}

/**
 * Format a report of the most divergent markets
 */
export function formatDivergenceReport(
  divergentMarkets: CrossPlatformMatch[],
  topN: number = 10
): string {
  if (divergentMarkets.length === 0) {
    return 'No significant cross-platform divergences found.';
  }

  const lines: string[] = ['**📊 Cross-Platform Price Divergences**\n'];

  for (let i = 0; i < Math.min(topN, divergentMarkets.length); i++) {
    const match = divergentMarkets[i];
    const title = (match.kalshi.title ?? '').slice(0, 50);
    const { kalshiPrice, polymarketPrice, absDifference, polymarketMoreBullish } = match;

    const direction = polymarketMoreBullish ? 'P↑' : 'K↑';

    lines.push(
      `${i + 1}. **${title}** — ${direction} ${(absDifference * 100).toFixed(0)}% — ` +
      `K:${(kalshiPrice * 100).toFixed(0)}¢ vs P:${(polymarketPrice * 100).toFixed(0)}¢`
    );
  }

  return lines.join('\n');
}
