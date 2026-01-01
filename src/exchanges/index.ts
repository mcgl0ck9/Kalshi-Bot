/**
 * Exchange clients for Kalshi and Polymarket using dr-manhattan
 *
 * Uses @alango/dr-manhattan for unified API access with:
 * - Kalshi: REST + RSA authentication
 * - Polymarket: REST + WebSocket real-time orderbook
 */

import {
  createExchange,
  type Market as DrMarket,
  MarketUtils,
} from '@alango/dr-manhattan';
import type { Market, MarketCategory } from '../types/index.js';
import { logger } from '../utils/index.js';
import { kalshiFetchJson, hasKalshiAuth } from '../utils/kalshi-auth.js';
import * as config from '../config.js';

// =============================================================================
// EXCHANGE INSTANCES
// =============================================================================

let kalshiClient: ReturnType<typeof createExchange> | null = null;
let polymarketClient: ReturnType<typeof createExchange> | null = null;

/**
 * Initialize Kalshi client
 */
export function getKalshiClient() {
  if (!kalshiClient) {
    const kalshiConfig: Record<string, unknown> = {};

    if (config.KALSHI_API_KEY_ID && config.KALSHI_PRIVATE_KEY) {
      kalshiConfig.apiKeyId = config.KALSHI_API_KEY_ID;
      kalshiConfig.privateKey = config.KALSHI_PRIVATE_KEY;
    } else if (config.KALSHI_PRIVATE_KEY_PATH) {
      kalshiConfig.privateKeyPath = config.KALSHI_PRIVATE_KEY_PATH;
    }

    if (config.KALSHI_DEMO) {
      kalshiConfig.demo = true;
    }

    kalshiClient = createExchange('kalshi', kalshiConfig);
  }
  return kalshiClient;
}

/**
 * Initialize Polymarket client
 */
export function getPolymarketClient() {
  if (!polymarketClient) {
    polymarketClient = createExchange('polymarket');
  }
  return polymarketClient;
}

// =============================================================================
// MARKET FETCHING
// =============================================================================

/**
 * Fetch markets from Kalshi
 */
export async function fetchKalshiMarkets(limit: number = 100): Promise<Market[]> {
  try {
    const client = getKalshiClient();
    const markets = await client.fetchMarkets({ limit, active: true });

    logger.info(`Fetched ${markets.length} Kalshi markets`);

    return markets.map(normalizeKalshiMarket);
  } catch (error) {
    logger.error(`Kalshi fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch sports markets directly from Kalshi API
 * Gets markets from Sports category that may not appear in top trending
 */
export async function fetchKalshiSportsMarkets(): Promise<Market[]> {
  try {
    const allMarkets: Market[] = [];

    // Check if we have auth
    if (!hasKalshiAuth()) {
      logger.debug('Skipping sports markets fetch - no Kalshi auth configured');
      return [];
    }

    // Fetch active markets with cursor pagination
    let cursor: string | null = null;
    let totalFetched = 0;
    const maxPages = 10; // Safety limit
    let pages = 0;

    while (pages < maxPages) {
      let path = '/trade-api/v2/markets?limit=200&status=open';
      if (cursor) {
        path += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const data = await kalshiFetchJson<{
        markets?: unknown[];
        cursor?: string;
      }>(path);

      if (!data) {
        if (pages === 0) {
          logger.warn('Kalshi sports markets fetch failed on first page');
        }
        break;
      }

      const markets = data.markets ?? [];
      if (markets.length === 0) break;

      // Filter for sports-related markets
      for (const m of markets) {
        const market = m as Record<string, unknown>;
        const ticker = (market.ticker as string ?? '').toUpperCase();
        const title = (market.title as string ?? '').toLowerCase();
        const category = (market.category as string ?? '').toLowerCase();

        // Check if it's a sports market
        const isSports =
          category === 'sports' ||
          ticker.includes('NFL') || ticker.includes('NBA') ||
          ticker.includes('MLB') || ticker.includes('NHL') ||
          ticker.includes('NCAAF') || ticker.includes('NCAAB') ||
          ticker.includes('CFP') || ticker.includes('BOWL') ||
          title.includes('basketball') || title.includes('football') ||
          title.includes('hockey') || title.includes('baseball') ||
          title.includes(' vs ') || title.includes(' at ');

        if (isSports) {
          const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;
          const subtitle = market.subtitle as string ?? '';

          allMarkets.push({
            platform: 'kalshi' as const,
            id: ticker,
            ticker,
            title: subtitle ? `${market.title} ${subtitle}` : market.title as string,
            description: market.rules_primary as string,
            category: 'sports' as MarketCategory,
            price: yesPrice / 100,
            volume: (market.volume as number) ?? 0,
            volume24h: (market.volume_24h as number) ?? 0,
            liquidity: (market.open_interest as number) ?? 0,
            url: buildKalshiUrl(ticker, market.title as string ?? ''),
            closeTime: market.close_time as string,
          });
        }
      }

      totalFetched += markets.length;
      cursor = data.cursor ?? null;
      pages++;

      // If no more cursor or we've fetched enough, stop
      if (!cursor || totalFetched >= 2000) break;
    }

    // Deduplicate by ticker
    const seen = new Set<string>();
    const unique = allMarkets.filter(m => {
      if (seen.has(m.ticker ?? m.id)) return false;
      seen.add(m.ticker ?? m.id);
      return true;
    });

    logger.info(`Fetched ${unique.length} Kalshi sports markets (from ${totalFetched} total scanned)`);
    return unique;
  } catch (error) {
    logger.error(`Kalshi sports markets fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch ALL markets from Kalshi using pagination
 * This gets markets beyond the default 200 limit
 */
export async function fetchAllKalshiMarkets(maxMarkets: number = 1000): Promise<Market[]> {
  try {
    const allMarkets: Market[] = [];

    // Check if we have auth
    if (!hasKalshiAuth()) {
      logger.debug('Skipping paginated fetch - no Kalshi auth configured');
      return [];
    }

    let cursor: string | null = null;
    let totalFetched = 0;
    const maxPages = Math.ceil(maxMarkets / 200);
    let pages = 0;

    while (pages < maxPages) {
      let path = '/trade-api/v2/markets?limit=200&status=open';
      if (cursor) {
        path += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const data = await kalshiFetchJson<{
        markets?: unknown[];
        cursor?: string;
      }>(path);

      if (!data) {
        if (pages === 0) {
          logger.warn('Kalshi paginated fetch failed on first page');
        }
        break;
      }

      const markets = data.markets ?? [];
      if (markets.length === 0) break;

      for (const m of markets) {
        const market = m as Record<string, unknown>;
        const ticker = (market.ticker as string ?? '');
        const title = market.title as string ?? '';
        const subtitle = market.subtitle as string ?? '';
        const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;

        allMarkets.push({
          platform: 'kalshi' as const,
          id: ticker,
          ticker,
          title: subtitle ? `${title} ${subtitle}` : title,
          description: market.rules_primary as string,
          category: categorizeMarket(title, ticker),
          price: yesPrice / 100,
          volume: (market.volume as number) ?? 0,
          volume24h: (market.volume_24h as number) ?? 0,
          liquidity: (market.open_interest as number) ?? 0,
          url: buildKalshiUrl(ticker, title),
          closeTime: market.close_time as string,
        });
      }

      totalFetched += markets.length;
      cursor = data.cursor ?? null;
      pages++;

      if (!cursor || totalFetched >= maxMarkets) break;
    }

    logger.info(`Fetched ${allMarkets.length} Kalshi markets (paginated)`);
    return allMarkets;
  } catch (error) {
    logger.error(`Kalshi paginated fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch RT (Rotten Tomatoes) markets from Kalshi
 * RT markets use series tickers like KXRTPRIMATE, KXRTSEN (Send Help), etc.
 */
export async function fetchKalshiRTMarkets(): Promise<Market[]> {
  try {
    // Find all RT-related series (series endpoint, not events)
    const seriesData = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
      '/trade-api/v2/series?limit=500'
    );

    if (!seriesData) {
      logger.warn('Failed to fetch series for RT markets');
      return [];
    }
    const allSeries = seriesData.series ?? [];

    // Find RT-related series (ticker contains KXRT or title mentions Rotten Tomatoes)
    const rtSeries = allSeries.filter(s =>
      s.ticker?.includes('KXRT') ||
      s.title?.toLowerCase().includes('rotten tomatoes')
    );

    logger.info(`Found ${rtSeries.length} RT-related series`);

    // Prioritize series with certain keywords (likely active movies)
    const prioritizedSeries = rtSeries.sort((a, b) => {
      // Push series with common movie names to front
      const priorityKeywords = ['primate', 'send', 'running', 'amateur', 'soulm8te'];
      const aHasPriority = priorityKeywords.some(k => a.ticker.toLowerCase().includes(k));
      const bHasPriority = priorityKeywords.some(k => b.ticker.toLowerCase().includes(k));
      if (aHasPriority && !bHasPriority) return -1;
      if (bHasPriority && !aHasPriority) return 1;
      return 0;
    });

    // Batch fetch markets for RT series (fetch in parallel batches)
    const allMarkets: Market[] = [];
    const batchSize = 10;

    // Log first 10 prioritized series for debugging
    logger.info(`First 10 prioritized RT series: ${prioritizedSeries.slice(0, 10).map(s => s.ticker).join(', ')}`);

    // Always fetch Primate specifically (known edge opportunity)
    const primateIdx = prioritizedSeries.findIndex(s => s.ticker === 'KXRTPRIMATE');
    if (primateIdx > 10) {
      // Move Primate to front if it's not already in first 10
      const primate = prioritizedSeries[primateIdx];
      prioritizedSeries.splice(primateIdx, 1);
      prioritizedSeries.unshift(primate);
      logger.info(`Moved KXRTPRIMATE to front (was at index ${primateIdx})`);
    }

    for (let i = 0; i < Math.min(prioritizedSeries.length, 100); i += batchSize) {  // Increased to 100 series
      const batch = prioritizedSeries.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (series) => {
          try {
            const data = await kalshiFetchJson<{ markets?: unknown[] }>(
              `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=50`
            );
            if (!data) return [];
            const markets = data.markets ?? [];
            if (markets.length > 0) {
              logger.info(`  📊 ${series.ticker}: ${markets.length} markets found`);
            }
            return markets;
          } catch (e) {
            logger.debug(`Error fetching ${series.ticker}: ${e}`);
            return [];
          }
        })
      );

      for (const markets of batchResults) {
        for (const m of markets) {
          const market = m as Record<string, unknown>;
          const ticker = market.ticker as string ?? '';
          const title = market.title as string ?? '';
          const subtitle = market.subtitle as string ?? '';
          const status = market.status as string ?? '';

          // Debug: log Primate markets specifically
          if (ticker.includes('PRIMATE')) {
            logger.info(`    Primate market ${ticker}: status=${status}`);
          }

          if (status !== 'active') continue;

          // Combine title and subtitle for full market description
          // e.g., "Primate Rotten Tomatoes score?" + "Above 85" = threshold of 85
          const fullTitle = subtitle ? `${title} ${subtitle}` : title;

          const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;

          allMarkets.push({
            platform: 'kalshi' as const,
            id: ticker,
            ticker,
            title: fullTitle,
            description: market.rules_primary as string,
            category: 'entertainment' as MarketCategory,
            price: yesPrice / 100,  // Kalshi prices are in cents
            volume: (market.volume as number) ?? 0,
            volume24h: (market.volume_24h as number) ?? 0,
            liquidity: (market.open_interest as number) ?? 0,
            url: buildKalshiUrl(ticker, title),
            closeTime: market.close_time as string,
          });
        }
      }
    }

    logger.info(`Fetched ${allMarkets.length} Kalshi RT markets`);
    return allMarkets;
  } catch (error) {
    logger.error(`Kalshi RT markets fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch weather markets from Kalshi
 * Weather markets use series tickers like KXCHISNOW, KXLARAIN, KXTEMPNY, etc.
 */
export async function fetchKalshiWeatherMarkets(): Promise<Market[]> {
  try {
    // Find all weather-related series
    const seriesData = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
      '/trade-api/v2/series?limit=500'
    );

    if (!seriesData) {
      logger.warn('Failed to fetch series for weather markets');
      return [];
    }
    const allSeries = seriesData.series ?? [];

    // Weather-related keywords in series tickers and titles
    const weatherKeywords = [
      'snow', 'rain', 'temp', 'weather', 'precipitation', 'hurricane',
      'storm', 'tornado', 'flood', 'drought', 'heat', 'cold', 'freeze'
    ];
    const cityKeywords = [
      'chi', 'la', 'nyc', 'ny', 'boston', 'denver', 'miami', 'seattle',
      'phoenix', 'minneapolis', 'chicago', 'angeles'
    ];

    // Find weather-related series
    const weatherSeries = allSeries.filter(s => {
      const ticker = (s.ticker ?? '').toLowerCase();
      const title = (s.title ?? '').toLowerCase();

      // Check for weather keywords
      const hasWeatherKeyword = weatherKeywords.some(kw =>
        ticker.includes(kw) || title.includes(kw)
      );

      // Check for city + weather combination
      const hasCityKeyword = cityKeywords.some(kw =>
        ticker.includes(kw) || title.includes(kw)
      );

      return hasWeatherKeyword || (hasCityKeyword && (
        title.includes('inch') || title.includes('degree') ||
        title.includes('above') || title.includes('below')
      ));
    });

    if (weatherSeries.length === 0) {
      logger.debug('No weather series found');
      return [];
    }

    logger.info(`Found ${weatherSeries.length} weather-related series`);

    // Fetch markets from each series
    const allMarkets: Market[] = [];
    const batchSize = 10;

    for (let i = 0; i < Math.min(weatherSeries.length, 50); i += batchSize) {
      const batch = weatherSeries.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (series) => {
          try {
            const data = await kalshiFetchJson<{ markets?: unknown[] }>(
              `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=50`
            );
            return data?.markets ?? [];
          } catch (e) {
            return [];
          }
        })
      );

      for (const markets of batchResults) {
        for (const m of markets) {
          const market = m as Record<string, unknown>;
          const ticker = market.ticker as string ?? '';
          const title = market.title as string ?? '';
          const subtitle = market.subtitle as string ?? '';
          const status = market.status as string ?? '';

          if (status !== 'active') continue;

          const fullTitle = subtitle ? `${title} ${subtitle}` : title;
          const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;

          allMarkets.push({
            platform: 'kalshi' as const,
            id: ticker,
            ticker,
            title: fullTitle,
            description: market.rules_primary as string,
            category: 'weather' as MarketCategory,
            price: yesPrice / 100,
            volume: (market.volume as number) ?? 0,
            volume24h: (market.volume_24h as number) ?? 0,
            liquidity: (market.open_interest as number) ?? 0,
            url: buildKalshiUrl(ticker, title),
            closeTime: market.close_time as string,
          });
        }
      }
    }

    logger.info(`Fetched ${allMarkets.length} Kalshi weather markets`);
    return allMarkets;
  } catch (error) {
    logger.error(`Kalshi weather markets fetch error: ${error}`);
    return [];
  }
}

/**
 * Fetch markets from Polymarket
 */
export async function fetchPolymarketMarkets(limit: number = 100): Promise<Market[]> {
  try {
    const client = getPolymarketClient();
    const markets = await client.fetchMarkets({ limit, active: true });

    logger.info(`Fetched ${markets.length} Polymarket markets`);

    return markets.map(normalizePolymarketMarket);
  } catch (error) {
    logger.error(`Polymarket fetch error: ${error}`);
    return [];
  }
}

// =============================================================================
// MARKET NORMALIZATION
// =============================================================================

/**
 * Build Kalshi market URL
 * Format: https://kalshi.com/markets/{series_ticker}/{slug}/{market_ticker}
 *
 * Examples:
 * - kxbtc-25dec31 -> series: kxbtc
 * - kxbtc2025100-25dec31 -> series: kxbtc2025100
 * - kxbtcmaxy-25 -> series: kxbtcmaxy
 */
function buildKalshiUrl(ticker: string, question: string): string {
  // Extract series ticker (everything before the date suffix)
  // Date suffixes look like: -25dec31, -25, -25jan15
  const seriesMatch = ticker.match(/^(.+?)-\d{2}[a-z]*\d*$/i);
  const series = seriesMatch ? seriesMatch[1].toLowerCase() : ticker.split('-')[0].toLowerCase();

  // Create URL-friendly slug from question
  const slug = question
    .toLowerCase()
    .replace(/[?!.,'"]/g, '')           // Remove punctuation
    .replace(/[^a-z0-9\s-]/g, '')       // Remove special chars
    .replace(/\s+/g, '-')               // Replace spaces with hyphens
    .replace(/-+/g, '-')                // Collapse multiple hyphens
    .replace(/^-|-$/g, '')              // Trim hyphens
    .slice(0, 50);                       // Limit length

  // Build full URL
  return `https://kalshi.com/markets/${series}/${slug}/${ticker.toLowerCase()}`;
}

function normalizeKalshiMarket(market: DrMarket): Market {
  const price = market.prices?.[0] ?? 0;

  // Handle outcomes - dr-manhattan may return strings or objects
  const outcomes = market.outcomes?.map((o, i) => {
    const outcomeStr = typeof o === 'string' ? o : (o as { outcome?: string })?.outcome ?? 'Unknown';
    const tokenId = typeof o === 'string' ? '' : (o as { tokenId?: string })?.tokenId ?? '';
    return {
      outcome: outcomeStr,
      tokenId,
      price: market.prices?.[i] ?? 0,
    };
  });

  // Handle closeTime - may be Date or string
  let closeTime: string | undefined;
  if (market.closeTime) {
    closeTime = market.closeTime instanceof Date
      ? market.closeTime.toISOString()
      : String(market.closeTime);
  }

  // Build proper Kalshi URL
  const url = buildKalshiUrl(market.id, market.question ?? '');

  return {
    platform: 'kalshi',
    id: market.id,
    ticker: market.id, // Kalshi uses ticker as ID
    title: market.question,
    description: market.description,
    category: categorizeMarket(market.question, market.id),
    price,
    volume: market.volume ?? 0,
    volume24h: market.volume ?? 0,
    liquidity: market.liquidity ?? 0,
    url,
    closeTime,
    outcomes,
  };
}

function normalizePolymarketMarket(market: DrMarket): Market {
  const price = market.prices?.[0] ?? 0;
  const tokenIds = MarketUtils.getTokenIds(market);

  // Handle outcomes - dr-manhattan may return strings or objects
  const outcomes = market.outcomes?.map((o, i) => {
    const outcomeStr = typeof o === 'string' ? o : (o as { outcome?: string })?.outcome ?? 'Unknown';
    return {
      outcome: outcomeStr,
      tokenId: tokenIds[i] ?? '',
      price: market.prices?.[i] ?? 0,
    };
  });

  // Handle closeTime - may be Date or string
  let closeTime: string | undefined;
  if (market.closeTime) {
    closeTime = market.closeTime instanceof Date
      ? market.closeTime.toISOString()
      : String(market.closeTime);
  }

  return {
    platform: 'polymarket',
    id: market.id,
    title: market.question,
    description: market.description,
    category: categorizeMarket(market.question),
    price,
    volume: market.volume ?? 0,
    volume24h: market.volume ?? 0,
    liquidity: market.liquidity ?? 0,
    url: `https://polymarket.com/event/${market.id}`,
    closeTime,
    tokenId: tokenIds[0], // Primary token for YES outcome
    outcomes,
  };
}

/**
 * Categorize market based on title and ticker
 */
function categorizeMarket(title: string, ticker?: string): MarketCategory {
  const titleLower = title.toLowerCase();
  const tickerUpper = ticker?.toUpperCase() ?? '';

  // Check ticker prefixes (Kalshi)
  if (tickerUpper.match(/^KX(TRUMP|BIDEN|PRES|SEN|GOV|ELECTION)/)) return 'politics';
  if (tickerUpper.match(/^KX(BTC|ETH|CRYPTO)/)) return 'crypto';
  if (tickerUpper.match(/^KX(FED|CPI|GDP|JOBS|RATE)/)) return 'macro';
  if (tickerUpper.match(/^KX(NFL|NBA|MLB|NHL)/)) return 'sports';
  if (tickerUpper.match(/^KX(OSCAR|GRAMMY|EMMY)/)) return 'entertainment';
  if (tickerUpper.match(/^KX(HURR|TEMP)/)) return 'weather';

  // Check title keywords
  const categoryKeywords: Record<MarketCategory, string[]> = {
    politics: ['trump', 'biden', 'president', 'congress', 'election', 'impeach', 'senate', 'governor'],
    crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto'],
    macro: ['fed', 'inflation', 'rate cut', 'recession', 'cpi', 'gdp', 'jobs report'],
    sports: ['nfl', 'nba', 'mlb', 'super bowl', 'world series', 'championship'],
    entertainment: ['oscar', 'grammy', 'emmy', 'movie', 'box office', 'album', 'rotten tomatoes', 'tomatometer', 'rt score'],
    geopolitics: ['ukraine', 'russia', 'china', 'israel', 'gaza', 'war', 'invasion', 'tariff'],
    weather: ['hurricane', 'temperature', 'weather', 'storm'],
    tech: ['ipo', 'ai ', 'artificial intelligence', 'openai'],
    other: [],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      return category as MarketCategory;
    }
  }

  return 'other';
}
