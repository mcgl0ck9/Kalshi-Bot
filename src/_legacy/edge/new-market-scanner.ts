/**
 * New Market Scanner
 *
 * Detects freshly launched markets on Kalshi and Polymarket.
 * Early markets are often mispriced before liquidity arrives.
 */

import { logger } from '../utils/index.js';
import type { Market, NewMarket, MarketSnapshot } from '../types/index.js';
import { fetchKalshiMarkets, fetchPolymarketMarkets } from '../exchanges/index.js';

// In-memory store for market snapshots
const marketSnapshots: Map<string, MarketSnapshot> = new Map();
const NEW_MARKET_THRESHOLD_MINUTES = 120;

function getMarketKey(platform: 'kalshi' | 'polymarket', id: string): string {
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
      platform: market.platform,
      firstSeenAt: now,
      priceHistory: [{ timestamp: now, price: market.price }],
      volumeHistory: [{ timestamp: now, volume: market.volume }],
    });
  } else {
    existing.priceHistory.push({ timestamp: now, price: market.price });
    existing.volumeHistory.push({ timestamp: now, volume: market.volume });
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

function findExternalReference(market: Market): { hasReference: boolean; estimate?: number; source?: string } {
  const titleLower = market.title.toLowerCase();
  if (titleLower.includes('fed') || titleLower.includes('fomc') || titleLower.includes('rate')) {
    return { hasReference: true, source: 'fed_watch' };
  }
  if (titleLower.includes('cpi') || titleLower.includes('inflation')) {
    return { hasReference: true, source: 'cpi_nowcast' };
  }
  if (titleLower.includes('jobs') || titleLower.includes('payroll') || titleLower.includes('unemployment')) {
    return { hasReference: true, source: 'jobs_leading' };
  }
  if (titleLower.includes('gdp') || titleLower.includes('recession')) {
    return { hasReference: true, source: 'gdp_nowcast' };
  }
  return { hasReference: false };
}

function findSimilarMarkets(market: Market, allMarkets: Market[]): NewMarket['similarMarkets'] {
  const otherPlatform = market.platform === 'kalshi' ? 'polymarket' : 'kalshi';
  const otherMarkets = allMarkets.filter(m => m.platform === otherPlatform);
  const titleWords = new Set(
    market.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  );

  const similar: NonNullable<NewMarket['similarMarkets']> = [];
  for (const other of otherMarkets) {
    const otherWords = new Set(
      other.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    );
    const intersection = new Set([...titleWords].filter(w => otherWords.has(w)));
    const union = new Set([...titleWords, ...otherWords]);
    const similarity = intersection.size / union.size;

    if (similarity > 0.3) {
      similar.push({ platform: other.platform, id: other.id, title: other.title, price: other.price, similarity });
    }
  }
  return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

export interface ScanResult {
  newMarkets: NewMarket[];
  recentMarkets: NewMarket[];
  totalScanned: number;
  scanTime: string;
}

export async function scanNewMarkets(): Promise<ScanResult> {
  logger.info('Scanning for new markets...');
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([
    fetchKalshiMarkets(200),
    fetchPolymarketMarkets(200),
  ]);

  const allMarkets = [...kalshiMarkets, ...polymarketMarkets];
  const newMarkets: NewMarket[] = [];
  const recentMarkets: NewMarket[] = [];

  for (const market of allMarkets) {
    const wasNew = isNewMarket(market);
    recordSnapshot(market);
    const ageMinutes = getMarketAgeMinutes(market);
    const liquidityTrend = analyzeLiquidityTrend(market);
    const earlyMoverAdvantage = calculateEarlyMoverAdvantage(ageMinutes, market.liquidity ?? 0, liquidityTrend);

    if (ageMinutes > NEW_MARKET_THRESHOLD_MINUTES && !wasNew) continue;

    const externalRef = findExternalReference(market);
    const similarMarkets = findSimilarMarkets(market, allMarkets);
    let potentialEdge: number | undefined;
    if (similarMarkets && similarMarkets.length > 0) {
      const avgOtherPrice = similarMarkets.reduce((s, m) => s + m.price, 0) / similarMarkets.length;
      potentialEdge = Math.abs(avgOtherPrice - market.price);
    }

    const newMarket: NewMarket = {
      market: { id: market.id, platform: market.platform, title: market.title, category: market.category, price: market.price, volume: market.volume, url: market.url },
      detectedAt: new Date().toISOString(),
      ageMinutes,
      hasExternalReference: externalRef.hasReference,
      externalEstimate: externalRef.estimate,
      potentialEdge,
      currentLiquidity: market.liquidity ?? 0,
      liquidityTrend,
      earlyMoverAdvantage,
      similarMarkets,
    };

    if (wasNew) {
      newMarkets.push(newMarket);
      logger.info(`New market detected: ${market.title.slice(0, 50)}...`);
    } else if (ageMinutes <= NEW_MARKET_THRESHOLD_MINUTES) {
      recentMarkets.push(newMarket);
    }
  }

  const advantageOrder = { high: 0, medium: 1, low: 2 };
  newMarkets.sort((a, b) => advantageOrder[a.earlyMoverAdvantage] - advantageOrder[b.earlyMoverAdvantage]);
  recentMarkets.sort((a, b) => advantageOrder[a.earlyMoverAdvantage] - advantageOrder[b.earlyMoverAdvantage]);

  logger.info(`Found ${newMarkets.length} new markets, ${recentMarkets.length} recent markets`);
  return { newMarkets, recentMarkets, totalScanned: allMarkets.length, scanTime: new Date().toISOString() };
}

export function getMarketSnapshots(): Map<string, MarketSnapshot> {
  return new Map(marketSnapshots);
}

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
  if (removed > 0) logger.info(`Cleaned up ${removed} stale market snapshots`);
  return removed;
}

export function formatNewMarketReport(result: ScanResult): string {
  const lines: string[] = [
    '🆕 **New Market Scanner Report**',
    '═══════════════════════════════',
    '',
    `Scanned: ${result.totalScanned} markets`,
    `New: ${result.newMarkets.length} | Recent: ${result.recentMarkets.length}`,
    '',
  ];

  if (result.newMarkets.length > 0) {
    lines.push('**Brand New Markets:**');
    for (const market of result.newMarkets.slice(0, 5)) {
      const emoji = market.earlyMoverAdvantage === 'high' ? '🚀' : market.earlyMoverAdvantage === 'medium' ? '⚡' : '📌';
      lines.push(`${emoji} ${market.market.title.slice(0, 50)}...`);
      lines.push(`   Platform: ${market.market.platform} | Age: ${market.ageMinutes}min | Advantage: ${market.earlyMoverAdvantage}`);
      if (market.potentialEdge && market.potentialEdge > 0.03) {
        lines.push(`   Potential Edge: ${(market.potentialEdge * 100).toFixed(1)}%`);
      }
      lines.push('');
    }
  }

  if (result.recentMarkets.length > 0 && result.newMarkets.length < 3) {
    lines.push('**Recent Markets (<2h):**');
    for (const market of result.recentMarkets.slice(0, 3)) {
      lines.push(`• ${market.market.title.slice(0, 50)}... (${market.ageMinutes}min)`);
    }
  }
  return lines.join('\n');
}
