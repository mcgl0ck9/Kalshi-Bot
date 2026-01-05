/**
 * Unified Cache for Kalshi Edge Detector v4.0
 *
 * Simple in-memory cache with TTL support.
 * Used for expensive computations and external API responses.
 */

import { logger } from '../utils/index.js';

// =============================================================================
// CACHE TYPES
// =============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;  // in ms
}

// =============================================================================
// CACHE STATE
// =============================================================================

const cache = new Map<string, CacheEntry<unknown>>();

// Default TTL: 5 minutes
const DEFAULT_TTL = 5 * 60 * 1000;

// =============================================================================
// CACHE OPERATIONS
// =============================================================================

/**
 * Get a value from cache.
 * Returns undefined if not found or expired.
 */
export function get<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return undefined;
  }

  // Check if expired
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return undefined;
  }

  return entry.data;
}

/**
 * Set a value in cache.
 */
export function set<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttlMs,
  });
}

/**
 * Get or compute a value.
 * If cached and valid, returns cached value.
 * Otherwise, computes and caches the new value.
 */
export async function getOrCompute<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL
): Promise<T> {
  const cached = get<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await compute();
  set(key, value, ttlMs);
  return value;
}

/**
 * Delete a specific key from cache.
 */
export function del(key: string): boolean {
  return cache.delete(key);
}

/**
 * Clear all cache entries.
 */
export function clear(): void {
  cache.clear();
  logger.debug('Cache cleared');
}

/**
 * Clear expired entries.
 */
export function clearExpired(): number {
  const now = Date.now();
  let cleared = 0;

  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      cache.delete(key);
      cleared++;
    }
  }

  if (cleared > 0) {
    logger.debug(`Cleared ${cleared} expired cache entries`);
  }

  return cleared;
}

/**
 * Get cache statistics.
 */
export function getStats(): {
  size: number;
  keys: string[];
  oldestEntry: number | null;
  memoryEstimate: string;
} {
  let oldest: number | null = null;

  for (const entry of cache.values()) {
    if (oldest === null || entry.timestamp < oldest) {
      oldest = entry.timestamp;
    }
  }

  // Rough memory estimate (not accurate, just for debugging)
  const jsonSize = JSON.stringify(Array.from(cache.values()).map(e => e.data)).length;
  const memoryEstimate = jsonSize > 1024 * 1024
    ? `${(jsonSize / (1024 * 1024)).toFixed(1)}MB`
    : `${(jsonSize / 1024).toFixed(1)}KB`;

  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    oldestEntry: oldest,
    memoryEstimate,
  };
}

// =============================================================================
// CACHE KEY HELPERS
// =============================================================================

/**
 * Create a cache key from components.
 */
export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

/**
 * Create a cache key for a market.
 */
export function marketKey(platform: string, id: string): string {
  return cacheKey('market', platform, id);
}

/**
 * Create a cache key for a source.
 */
export function sourceKey(name: string): string {
  return cacheKey('source', name);
}
