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
    entertainment: ['oscar', 'grammy', 'emmy', 'movie', 'box office', 'album'],
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
