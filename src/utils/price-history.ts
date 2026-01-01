/**
 * Price History Database
 *
 * Stores market price history for:
 * - Trend detection (is price rising/falling?)
 * - Recency bias detection (has price moved too fast?)
 * - Historical analysis (what was price X days ago?)
 * - Prediction tracking (compare our estimates to outcomes)
 *
 * Uses JSON file storage for simplicity.
 * Could be upgraded to SQLite for larger scale.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface PriceSnapshot {
  marketId: string;
  platform: 'kalshi' | 'polymarket';
  title: string;
  price: number;
  volume?: number;
  timestamp: number;
}

export interface MarketHistory {
  marketId: string;
  platform: 'kalshi' | 'polymarket';
  title: string;
  snapshots: PriceSnapshot[];
  firstSeen: number;
  lastUpdated: number;
  resolved?: boolean;
  outcome?: 'YES' | 'NO';
}

export interface PriceTrend {
  marketId: string;
  direction: 'up' | 'down' | 'stable';
  magnitude: number;        // Total change in probability
  velocity: number;         // Change per hour
  duration: number;         // Hours since trend started
  startPrice: number;
  currentPrice: number;
}

export interface PriceHistoryStats {
  totalMarkets: number;
  totalSnapshots: number;
  oldestSnapshot: number;
  newestSnapshot: number;
  resolvedMarkets: number;
}

// =============================================================================
// STORAGE
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const HISTORY_FILE = join(DATA_DIR, 'price-history.json');

interface StorageFormat {
  markets: Record<string, MarketHistory>;
  lastSaved: number;
}

let cache: StorageFormat | null = null;
let dirty = false;
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SNAPSHOTS_PER_MARKET = 200;
const HISTORY_RETENTION_DAYS = 30;

/**
 * Load history from disk
 */
function loadHistory(): StorageFormat {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
      return data as StorageFormat;
    }
  } catch (error) {
    logger.warn(`Failed to load price history: ${error}`);
  }
  return { markets: {}, lastSaved: 0 };
}

/**
 * Save history to disk
 */
function saveHistory(force: boolean = false): void {
  if (!cache || (!dirty && !force)) return;

  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    cache.lastSaved = Date.now();
    writeFileSync(HISTORY_FILE, JSON.stringify(cache, null, 2));
    dirty = false;
  } catch (error) {
    logger.warn(`Failed to save price history: ${error}`);
  }
}

/**
 * Initialize cache
 */
function initCache(): void {
  if (!cache) {
    cache = loadHistory();
    logger.info(`Loaded price history: ${Object.keys(cache.markets).length} markets`);

    // Clean up old data
    pruneOldData();
  }
}

/**
 * Remove old snapshots and resolved markets
 */
function pruneOldData(): void {
  if (!cache) return;

  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const [marketId, history] of Object.entries(cache.markets)) {
    // Remove resolved markets older than retention period
    if (history.resolved && history.lastUpdated < cutoff) {
      delete cache.markets[marketId];
      pruned++;
      continue;
    }

    // Remove old snapshots
    const oldLength = history.snapshots.length;
    history.snapshots = history.snapshots.filter(s => s.timestamp > cutoff);

    // Keep at least the last N snapshots
    if (history.snapshots.length === 0 && oldLength > 0) {
      // Keep the most recent snapshot
      const lastSnapshot = cache.markets[marketId]?.snapshots?.[oldLength - 1];
      if (lastSnapshot) {
        history.snapshots = [lastSnapshot];
      }
    }
  }

  if (pruned > 0) {
    logger.debug(`Pruned ${pruned} old markets from price history`);
    dirty = true;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Record a price snapshot for a market
 */
export function recordPrice(
  marketId: string,
  platform: 'kalshi' | 'polymarket',
  title: string,
  price: number,
  volume?: number
): void {
  initCache();
  if (!cache) return;

  const now = Date.now();
  const snapshot: PriceSnapshot = {
    marketId,
    platform,
    title,
    price,
    volume,
    timestamp: now,
  };

  let history = cache.markets[marketId];
  if (!history) {
    history = {
      marketId,
      platform,
      title,
      snapshots: [],
      firstSeen: now,
      lastUpdated: now,
    };
    cache.markets[marketId] = history;
  }

  // Don't record if price hasn't changed significantly (within 0.5%)
  const lastSnapshot = history.snapshots[history.snapshots.length - 1];
  if (lastSnapshot && Math.abs(lastSnapshot.price - price) < 0.005) {
    // Update timestamp but don't add new snapshot
    history.lastUpdated = now;
    return;
  }

  history.snapshots.push(snapshot);
  history.lastUpdated = now;

  // Keep only the last N snapshots
  if (history.snapshots.length > MAX_SNAPSHOTS_PER_MARKET) {
    history.snapshots = history.snapshots.slice(-MAX_SNAPSHOTS_PER_MARKET);
  }

  dirty = true;

  // Auto-save periodically
  if (now - (cache.lastSaved || 0) > AUTO_SAVE_INTERVAL_MS) {
    saveHistory();
  }
}

/**
 * Record prices for multiple markets at once
 */
export function recordPrices(
  markets: Array<{
    id: string;
    platform: 'kalshi' | 'polymarket';
    title: string;
    price: number;
    volume?: number;
  }>
): void {
  for (const market of markets) {
    recordPrice(market.id, market.platform, market.title, market.price, market.volume);
  }
  saveHistory();
}

/**
 * Get price history for a market
 */
export function getMarketHistory(marketId: string): MarketHistory | null {
  initCache();
  return cache?.markets[marketId] ?? null;
}

/**
 * Get price at a specific time ago
 */
export function getPriceAt(marketId: string, hoursAgo: number): number | null {
  const history = getMarketHistory(marketId);
  if (!history || history.snapshots.length === 0) return null;

  const targetTime = Date.now() - hoursAgo * 60 * 60 * 1000;

  // Find the closest snapshot to the target time
  let closest = history.snapshots[0];
  for (const snapshot of history.snapshots) {
    if (Math.abs(snapshot.timestamp - targetTime) < Math.abs(closest.timestamp - targetTime)) {
      closest = snapshot;
    }
  }

  return closest.price;
}

/**
 * Calculate price trend for a market
 */
export function calculateTrend(marketId: string, hoursBack: number = 24): PriceTrend | null {
  const history = getMarketHistory(marketId);
  if (!history || history.snapshots.length < 2) return null;

  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const recentSnapshots = history.snapshots.filter(s => s.timestamp >= cutoff);

  if (recentSnapshots.length < 2) return null;

  const startPrice = recentSnapshots[0].price;
  const currentPrice = recentSnapshots[recentSnapshots.length - 1].price;
  const magnitude = currentPrice - startPrice;
  const durationHours = (recentSnapshots[recentSnapshots.length - 1].timestamp - recentSnapshots[0].timestamp) / (60 * 60 * 1000);
  const velocity = durationHours > 0 ? magnitude / durationHours : 0;

  let direction: 'up' | 'down' | 'stable';
  if (Math.abs(magnitude) < 0.02) {
    direction = 'stable';
  } else {
    direction = magnitude > 0 ? 'up' : 'down';
  }

  return {
    marketId,
    direction,
    magnitude: Math.abs(magnitude),
    velocity: Math.abs(velocity),
    duration: durationHours,
    startPrice,
    currentPrice,
  };
}

/**
 * Find markets with significant recent movement
 */
export function findMovingMarkets(
  minMovement: number = 0.05,
  hoursBack: number = 6
): PriceTrend[] {
  initCache();
  if (!cache) return [];

  const trends: PriceTrend[] = [];

  for (const marketId of Object.keys(cache.markets)) {
    const trend = calculateTrend(marketId, hoursBack);
    if (trend && trend.magnitude >= minMovement) {
      trends.push(trend);
    }
  }

  // Sort by magnitude (biggest moves first)
  trends.sort((a, b) => b.magnitude - a.magnitude);

  return trends;
}

/**
 * Mark a market as resolved
 */
export function markResolved(marketId: string, outcome: 'YES' | 'NO'): void {
  initCache();
  if (!cache) return;

  const history = cache.markets[marketId];
  if (history) {
    history.resolved = true;
    history.outcome = outcome;
    history.lastUpdated = Date.now();
    dirty = true;
    saveHistory();
  }
}

/**
 * Get statistics about price history
 */
export function getHistoryStats(): PriceHistoryStats {
  initCache();
  if (!cache) {
    return {
      totalMarkets: 0,
      totalSnapshots: 0,
      oldestSnapshot: 0,
      newestSnapshot: 0,
      resolvedMarkets: 0,
    };
  }

  let totalSnapshots = 0;
  let oldestSnapshot = Date.now();
  let newestSnapshot = 0;
  let resolvedMarkets = 0;

  for (const history of Object.values(cache.markets)) {
    totalSnapshots += history.snapshots.length;

    if (history.resolved) {
      resolvedMarkets++;
    }

    for (const snapshot of history.snapshots) {
      if (snapshot.timestamp < oldestSnapshot) {
        oldestSnapshot = snapshot.timestamp;
      }
      if (snapshot.timestamp > newestSnapshot) {
        newestSnapshot = snapshot.timestamp;
      }
    }
  }

  return {
    totalMarkets: Object.keys(cache.markets).length,
    totalSnapshots,
    oldestSnapshot: totalSnapshots > 0 ? oldestSnapshot : 0,
    newestSnapshot,
    resolvedMarkets,
  };
}

/**
 * Force save (call at shutdown)
 */
export function forceSave(): void {
  saveHistory(true);
}

/**
 * Format price history report for Discord
 */
export function formatPriceHistoryReport(trends: PriceTrend[]): string {
  if (trends.length === 0) {
    return 'No significant price movements detected.';
  }

  const lines: string[] = ['**Price Movement Alert**\n'];

  for (const trend of trends.slice(0, 10)) {
    const emoji = trend.direction === 'up' ? '📈' : trend.direction === 'down' ? '📉' : '➡️';
    const pctChange = (trend.magnitude * 100).toFixed(1);
    const startPct = (trend.startPrice * 100).toFixed(0);
    const currentPct = (trend.currentPrice * 100).toFixed(0);

    lines.push(`${emoji} ${startPct}¢ → ${currentPct}¢ (${trend.direction === 'up' ? '+' : '-'}${pctChange}%)`);
  }

  return lines.join('\n');
}
