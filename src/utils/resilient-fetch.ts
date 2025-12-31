/**
 * Resilient Fetch Utility
 *
 * Provides fallback patterns for unreliable data sources:
 * - Try primary source first
 * - Fall back to secondary sources on failure
 * - Cache successful results
 * - Return cached data if all sources fail
 */

import { logger } from './index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FetchResult<T> {
  data: T;
  source: string;
  fromCache: boolean;
  timestamp: number;
}

export interface FetchSource<T> {
  name: string;
  fetch: () => Promise<T | null>;
  priority?: number;  // Lower = higher priority
}

export interface CacheEntry<T> {
  data: T;
  source: string;
  timestamp: number;
  expiresAt: number;
}

// =============================================================================
// IN-MEMORY CACHE
// =============================================================================

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get cached data if not expired
 */
function getCached<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry;
}

/**
 * Store data in cache
 */
function setCache<T>(key: string, data: T, source: string, ttlMs: number): void {
  const now = Date.now();
  cache.set(key, {
    data,
    source,
    timestamp: now,
    expiresAt: now + ttlMs,
  });
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache(): number {
  const now = Date.now();
  let cleared = 0;

  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  cache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

// =============================================================================
// RESILIENT FETCH
// =============================================================================

/**
 * Fetch data with fallback sources
 *
 * @param cacheKey - Unique key for caching
 * @param sources - Array of fetch sources (tried in order)
 * @param options - Configuration options
 * @returns FetchResult or null if all sources fail
 */
export async function fetchWithFallback<T>(
  cacheKey: string,
  sources: FetchSource<T>[],
  options: {
    cacheTTL?: number;       // Cache TTL in ms (default: 15 minutes)
    useStaleOnError?: boolean;  // Return stale cache if all sources fail
    staleTTL?: number;       // How long to keep stale data (default: 1 hour)
  } = {}
): Promise<FetchResult<T> | null> {
  const {
    cacheTTL = 15 * 60 * 1000,  // 15 minutes
    useStaleOnError = true,
    staleTTL = 60 * 60 * 1000,  // 1 hour
  } = options;

  // Check fresh cache first
  const cached = getCached<T>(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for ${cacheKey} (source: ${cached.source})`);
    return {
      data: cached.data,
      source: cached.source,
      fromCache: true,
      timestamp: cached.timestamp,
    };
  }

  // Sort sources by priority
  const sortedSources = [...sources].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // Try each source
  for (const source of sortedSources) {
    try {
      logger.debug(`Trying source: ${source.name}`);
      const data = await source.fetch();

      if (data !== null) {
        // Cache successful result
        setCache(cacheKey, data, source.name, cacheTTL);

        // Also store as stale backup with longer TTL
        if (useStaleOnError) {
          setCache(`stale:${cacheKey}`, data, source.name, staleTTL);
        }

        logger.debug(`Success from ${source.name}`);
        return {
          data,
          source: source.name,
          fromCache: false,
          timestamp: Date.now(),
        };
      }

      logger.debug(`${source.name} returned null, trying next`);
    } catch (error) {
      logger.warn(`${source.name} failed: ${error}`);
    }
  }

  // All sources failed - try stale cache
  if (useStaleOnError) {
    const stale = getCached<T>(`stale:${cacheKey}`);
    if (stale) {
      logger.warn(`All sources failed, using stale cache for ${cacheKey}`);
      return {
        data: stale.data,
        source: `${stale.source} (stale)`,
        fromCache: true,
        timestamp: stale.timestamp,
      };
    }
  }

  logger.error(`All sources failed for ${cacheKey}, no cache available`);
  return null;
}

/**
 * Fetch multiple items with fallback sources
 * Processes items in parallel with optional concurrency limit
 */
export async function fetchManyWithFallback<T, K>(
  items: K[],
  keyFn: (item: K) => string,
  sourcesForItem: (item: K) => FetchSource<T>[],
  options: {
    cacheTTL?: number;
    useStaleOnError?: boolean;
    staleTTL?: number;
    concurrency?: number;
  } = {}
): Promise<Map<K, FetchResult<T>>> {
  const { concurrency = 5, ...fetchOptions } = options;
  const results = new Map<K, FetchResult<T>>();

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async item => {
        const result = await fetchWithFallback(
          keyFn(item),
          sourcesForItem(item),
          fetchOptions
        );
        return { item, result };
      })
    );

    for (const { item, result } of batchResults) {
      if (result) {
        results.set(item, result);
      }
    }
  }

  return results;
}

// =============================================================================
// SPECIALIZED HELPERS
// =============================================================================

/**
 * Create a fetch source from an async function
 */
export function createSource<T>(
  name: string,
  fetchFn: () => Promise<T | null>,
  priority: number = 0
): FetchSource<T> {
  return { name, fetch: fetchFn, priority };
}

/**
 * Combine multiple data sources with transformation
 */
export async function fetchAndMerge<T, R>(
  sources: Array<{
    source: FetchSource<T>;
    transform: (data: T) => Partial<R>;
  }>,
  merge: (partials: Array<{ source: string; data: Partial<R> }>) => R | null
): Promise<R | null> {
  const partials: Array<{ source: string; data: Partial<R> }> = [];

  for (const { source, transform } of sources) {
    try {
      const data = await source.fetch();
      if (data !== null) {
        partials.push({
          source: source.name,
          data: transform(data),
        });
      }
    } catch (error) {
      logger.debug(`${source.name} failed in merge: ${error}`);
    }
  }

  if (partials.length === 0) {
    return null;
  }

  return merge(partials);
}
