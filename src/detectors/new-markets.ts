/**
 * New Market Scanner Detector v4.0
 *
 * Detects freshly launched markets that may be mispriced before liquidity arrives.
 * Early markets often have inefficient pricing and cross-platform divergence.
 *
 * EDGE LOGIC:
 * 1. Brand new markets have less price discovery
 * 2. Cross-platform divergence is higher in early stages
 * 3. Markets with external references (Fed, CPI) may be anchored wrong initially
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Slow-moving traders, uninformed liquidity providers
 * - Why do they lose? Don't monitor for new markets, miss early mispricing
 * - Our edge: First-mover advantage, cross-platform comparison
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

const MIN_EDGE = 0.05;                    // 5% minimum edge
const NEW_MARKET_THRESHOLD_HOURS = 2;     // Consider "new" if < 2 hours old
const MIN_CROSS_PLATFORM_DIVERGENCE = 0.05;  // 5% cross-platform divergence

// =============================================================================
// TYPES
// =============================================================================

export interface NewMarketSignal {
  type: 'new-market';
  ageMinutes: number;
  earlyMoverAdvantage: 'high' | 'medium' | 'low';
  hasExternalReference: boolean;
  crossPlatformDivergence?: number;
  liquidityTrend: 'increasing' | 'stable' | 'decreasing';
  [key: string]: unknown;  // Index signature for EdgeSignal compatibility
}

// In-memory store for market first-seen times
interface MarketSnapshot {
  marketId: string;
  platform: 'kalshi' | 'polymarket';
  firstSeenAt: string;
  priceHistory: { timestamp: string; price: number }[];
  volumeHistory: { timestamp: string; volume: number }[];
}

const marketSnapshots: Map<string, MarketSnapshot> = new Map();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getMarketKey(platform: string, id: string): string {
  return `${platform}:${id}`;
}

function isNewMarket(market: Market): boolean {
  const key = getMarketKey(market.platform, market.id);
  return !marketSnapshots.has(key);
}

function getMarketAgeMinutes(market: Market): number {
  const key = getMarketKey(market.platform, market.id);
  const snapshot = marketSnapshots.get(key);
  if (!snapshot) return 0;
  const firstSeen = new Date(snapshot.firstSeenAt).getTime();
  return Math.floor((Date.now() - firstSeen) / (1000 * 60));
}

function recordSnapshot(market: Market): void {
  const key = getMarketKey(market.platform, market.id);
  const now = new Date().toISOString();
  const existing = marketSnapshots.get(key);

  if (!existing) {
    marketSnapshots.set(key, {
      marketId: market.id,
      platform: market.platform as 'kalshi' | 'polymarket',
      firstSeenAt: now,
      priceHistory: [{ timestamp: now, price: market.price }],
      volumeHistory: [{ timestamp: now, volume: market.volume ?? 0 }],
    });
  } else {
    existing.priceHistory.push({ timestamp: now, price: market.price });
    existing.volumeHistory.push({ timestamp: now, volume: market.volume ?? 0 });
    // Keep last 100 entries
    if (existing.priceHistory.length > 100) {
      existing.priceHistory = existing.priceHistory.slice(-100);
    }
    if (existing.volumeHistory.length > 100) {
      existing.volumeHistory = existing.volumeHistory.slice(-100);
    }
  }
}

function analyzeLiquidityTrend(market: Market): 'increasing' | 'stable' | 'decreasing' {
  const key = getMarketKey(market.platform, market.id);
  const snapshot = marketSnapshots.get(key);
  if (!snapshot || snapshot.volumeHistory.length < 3) return 'stable';

  const recent = snapshot.volumeHistory.slice(-5);
  const volumes = recent.map(v => v.volume);
  const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
  const secondHalf = volumes.slice(Math.floor(volumes.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const changeRate = (avgSecond - avgFirst) / (avgFirst || 1);

  if (changeRate > 0.1) return 'increasing';
  if (changeRate < -0.1) return 'decreasing';
  return 'stable';
}

function calculateEarlyMoverAdvantage(
  ageMinutes: number,
  liquidity: number,
  liquidityTrend: 'increasing' | 'stable' | 'decreasing'
): 'high' | 'medium' | 'low' {
  if (ageMinutes < 30 && liquidity < 10000) return 'high';
  if (ageMinutes < 60 && liquidityTrend === 'increasing') return 'medium';
  if (ageMinutes < 120 && liquidity < 50000) return 'medium';
  return 'low';
}

function hasExternalReference(market: Market): boolean {
  const titleLower = market.title.toLowerCase();
  return (
    titleLower.includes('fed') ||
    titleLower.includes('fomc') ||
    titleLower.includes('rate') ||
    titleLower.includes('cpi') ||
    titleLower.includes('inflation') ||
    titleLower.includes('jobs') ||
    titleLower.includes('payroll') ||
    titleLower.includes('unemployment') ||
    titleLower.includes('gdp') ||
    titleLower.includes('recession')
  );
}

function findSimilarMarket(market: Market, allMarkets: Market[]): Market | null {
  const otherPlatform = market.platform === 'kalshi' ? 'polymarket' : 'kalshi';
  const otherMarkets = allMarkets.filter(m => m.platform === otherPlatform);

  const titleWords = new Set(
    market.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );

  let bestMatch: Market | null = null;
  let bestSimilarity = 0;

  for (const other of otherMarkets) {
    const otherWords = new Set(
      other.title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );
    const intersection = new Set([...titleWords].filter(w => otherWords.has(w)));
    const union = new Set([...titleWords, ...otherWords]);
    const similarity = intersection.size / union.size;

    if (similarity > bestSimilarity && similarity > 0.3) {
      bestSimilarity = similarity;
      bestMatch = other;
    }
  }

  return bestMatch;
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'new-markets',
  description: 'Detects newly launched markets with early-mover edge opportunities',
  sources: ['kalshi', 'polymarket'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];
    const thresholdMinutes = NEW_MARKET_THRESHOLD_HOURS * 60;

    // Record all market snapshots first
    for (const market of markets) {
      recordSnapshot(market);
    }

    // Find new or recent markets
    for (const market of markets) {
      const ageMinutes = getMarketAgeMinutes(market);

      // Skip if too old
      if (ageMinutes > thresholdMinutes) continue;

      const liquidityTrend = analyzeLiquidityTrend(market);
      const earlyMoverAdvantage = calculateEarlyMoverAdvantage(
        ageMinutes,
        market.liquidity ?? 0,
        liquidityTrend
      );

      // Skip if no early-mover advantage
      if (earlyMoverAdvantage === 'low') continue;

      // Check for cross-platform divergence
      const similarMarket = findSimilarMarket(market, markets);
      let crossPlatformDivergence: number | undefined;
      let direction: 'YES' | 'NO' = 'YES';
      let edge = 0;

      if (similarMarket) {
        crossPlatformDivergence = Math.abs(similarMarket.price - market.price);

        if (crossPlatformDivergence >= MIN_CROSS_PLATFORM_DIVERGENCE) {
          // Trade towards the other platform's price
          edge = crossPlatformDivergence;
          direction = similarMarket.price > market.price ? 'YES' : 'NO';
        }
      }

      // If no cross-platform edge, check for external reference potential
      if (edge < MIN_EDGE && hasExternalReference(market) && earlyMoverAdvantage === 'high') {
        // New market with external reference - flag as potential opportunity
        // Edge is speculative based on early-mover advantage
        edge = MIN_EDGE;
      }

      if (edge < MIN_EDGE) continue;

      // Confidence based on early-mover advantage and cross-platform confirmation
      let confidence = 0.50;
      if (earlyMoverAdvantage === 'high') confidence += 0.15;
      else if (earlyMoverAdvantage === 'medium') confidence += 0.10;
      if (crossPlatformDivergence && crossPlatformDivergence > 0.08) confidence += 0.10;
      if (hasExternalReference(market)) confidence += 0.05;
      confidence = Math.min(confidence, 0.80);

      const reason = `New market edge: ${ageMinutes}min old, ${earlyMoverAdvantage} early-mover advantage. ` +
        (crossPlatformDivergence
          ? `Cross-platform divergence: ${(crossPlatformDivergence * 100).toFixed(1)}% vs ${similarMarket?.platform}. `
          : '') +
        (hasExternalReference(market) ? 'Has external data reference (potential mispricing). ' : '') +
        `Liquidity trend: ${liquidityTrend}.`;

      const signal: NewMarketSignal = {
        type: 'new-market',
        ageMinutes,
        earlyMoverAdvantage,
        hasExternalReference: hasExternalReference(market),
        crossPlatformDivergence,
        liquidityTrend,
      };

      edges.push(createEdge(
        market,
        direction,
        edge,
        confidence,
        reason,
        signal
      ));
    }

    // Sort by early-mover advantage
    const advantageOrder = { high: 0, medium: 1, low: 2 };
    edges.sort((a, b) => {
      const aAdv = (a.signal as NewMarketSignal).earlyMoverAdvantage;
      const bAdv = (b.signal as NewMarketSignal).earlyMoverAdvantage;
      return advantageOrder[aAdv] - advantageOrder[bAdv];
    });

    if (edges.length > 0) {
      logger.info(`New-markets detector: Found ${edges.length} early-mover edges`);
    }

    return edges;
  },
});

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Get current market snapshots (for debugging/monitoring)
 */
export function getMarketSnapshots(): Map<string, MarketSnapshot> {
  return new Map(marketSnapshots);
}

/**
 * Cleanup old snapshots to prevent memory bloat
 */
export function cleanupSnapshots(maxAgeHours: number = 24): number {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  let removed = 0;

  for (const [key, snapshot] of marketSnapshots) {
    const lastUpdate = snapshot.priceHistory[snapshot.priceHistory.length - 1]?.timestamp;
    if (lastUpdate && new Date(lastUpdate).getTime() < cutoff) {
      marketSnapshots.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    logger.info(`Cleaned up ${removed} stale market snapshots`);
  }

  return removed;
}
