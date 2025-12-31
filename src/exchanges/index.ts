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
import type { Market, MarketCategory, Orderbook } from '../types/index.js';
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

/**
 * Get orderbook for a Polymarket token (real-time via REST, WebSocket in future)
 */
export async function getPolymarketOrderbook(tokenId: string): Promise<Orderbook | null> {
  try {
    const client = getPolymarketClient();
    // @ts-expect-error - getOrderbook may not be typed
    const orderbook = await client.getOrderbook(tokenId);

    if (!orderbook) return null;

    return {
      bids: orderbook.bids?.map((b: { price: number; size: number }) => ({
        price: b.price,
        size: b.size,
      })) ?? [],
      asks: orderbook.asks?.map((a: { price: number; size: number }) => ({
        price: a.price,
        size: a.size,
      })) ?? [],
    };
  } catch (error) {
    logger.error(`Polymarket orderbook error: ${error}`);
    return null;
  }
}

// =============================================================================
// MARKET NORMALIZATION
// =============================================================================

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
    url: `https://kalshi.com/markets/${market.id}`,
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

// =============================================================================
// SPREAD & ORDERBOOK UTILITIES
// =============================================================================

/**
 * Calculate bid-ask spread from market data
 */
export function calculateSpread(market: Market): number | null {
  if (!market.outcomes || market.outcomes.length < 2) return null;

  const yesPrice = market.outcomes[0]?.price ?? 0;
  const noPrice = market.outcomes[1]?.price ?? 0;

  // Spread is distance from fair value (should sum to ~1.0)
  const sum = yesPrice + noPrice;
  if (sum === 0) return null;

  return Math.abs(1 - sum);
}

/**
 * Get best bid/ask from orderbook
 */
export function getBestBidAsk(orderbook: Orderbook): {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  midPrice: number | null;
} {
  const bestBid = orderbook.bids[0]?.price ?? null;
  const bestAsk = orderbook.asks[0]?.price ?? null;

  let spread: number | null = null;
  let midPrice: number | null = null;

  if (bestBid !== null && bestAsk !== null) {
    spread = bestAsk - bestBid;
    midPrice = (bestBid + bestAsk) / 2;
  }

  return { bestBid, bestAsk, spread, midPrice };
}
