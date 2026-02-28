/**
 * Market Discovery for Market Making
 *
 * Identifies the most liquid markets to quote on Kalshi.
 * Scores markets by open_interest + volume_24h (R2-openclaw approach).
 * Focuses on sports (NCAAM/NBA tonight), crypto, and economics.
 */

import { kalshiFetchJson } from '../utils/kalshi-auth.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface DiscoveredMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  series: string;
  yesBid: number;           // Current best YES bid (cents)
  yesAsk: number;           // Current best YES ask (cents)
  spread: number;           // Ask - Bid (cents)
  midPrice: number;         // (bid + ask) / 2 (cents)
  volume24h: number;
  openInterest: number;
  liquidityScore: number;   // OI + volume (higher = more liquid)
  closeTime: string;
  status: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Series to scan for liquid markets
const DISCOVERY_SERIES = [
  // Sports - highest volume today
  'KXNCAAMBGAME', 'KXNCAAMBSPREAD', 'KXNCAAMBTOTAL',
  'KXNBA',
  // Crypto - always active
  'KXBTC', 'KXBTCD', 'KXETH',
  // Economics
  'KXGDP', 'KXCPI', 'KXFED',
];

const MAX_MARKETS = 20;      // Top N most liquid markets to quote
const MIN_LIQUIDITY = 100;   // Minimum OI + volume to consider

// =============================================================================
// DISCOVERY
// =============================================================================

/**
 * Discover the top N most liquid markets across all target series.
 */
export async function discoverMarkets(maxMarkets: number = MAX_MARKETS): Promise<DiscoveredMarket[]> {
  const allMarkets: DiscoveredMarket[] = [];

  logger.info(`Discovering markets from ${DISCOVERY_SERIES.length} series...`);

  // Fetch in batches of 5
  for (let i = 0; i < DISCOVERY_SERIES.length; i += 5) {
    const batch = DISCOVERY_SERIES.slice(i, i + 5);

    const batchResults = await Promise.all(
      batch.map(async (series) => {
        try {
          return await fetchSeriesMarkets(series);
        } catch (e) {
          logger.debug(`Discovery error for ${series}: ${e}`);
          return [];
        }
      })
    );

    for (const markets of batchResults) {
      allMarkets.push(...markets);
    }
  }

  // Filter by minimum liquidity
  const liquid = allMarkets.filter(m => m.liquidityScore >= MIN_LIQUIDITY);

  // Sort by liquidity score (highest first)
  liquid.sort((a, b) => b.liquidityScore - a.liquidityScore);

  // Take top N
  const selected = liquid.slice(0, maxMarkets);

  logger.info(`Discovered ${allMarkets.length} total markets, ${liquid.length} liquid, selected top ${selected.length}`);

  if (selected.length > 0) {
    logger.info('Top 5 most liquid:');
    for (const m of selected.slice(0, 5)) {
      logger.info(`  ${m.ticker}: OI=${m.openInterest} Vol=${m.volume24h} Score=${m.liquidityScore} Spread=${m.spread}¢`);
    }
  }

  return selected;
}

/**
 * Fetch active markets for a series with bid/ask data.
 */
async function fetchSeriesMarkets(seriesTicker: string): Promise<DiscoveredMarket[]> {
  const markets: DiscoveredMarket[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const url = cursor
      ? `/trade-api/v2/markets?series_ticker=${seriesTicker}&limit=100&status=open&cursor=${cursor}`
      : `/trade-api/v2/markets?series_ticker=${seriesTicker}&limit=100&status=open`;

    const data = await kalshiFetchJson<{ markets?: RawMarket[]; cursor?: string }>(url);
    if (!data?.markets) break;
    pages++;

    for (const m of data.markets) {
      if (m.status !== 'active' && m.status !== 'open') continue;

      const yesBid = m.yes_bid ?? 0;
      const yesAsk = m.yes_ask ?? (yesBid > 0 ? yesBid + 2 : 0);  // Estimate if missing
      const spread = yesAsk - yesBid;
      const midPrice = Math.round((yesBid + yesAsk) / 2);
      const volume24h = m.volume_24h ?? m.volume ?? 0;
      const openInterest = m.open_interest ?? 0;

      // Skip markets with no activity
      if (yesBid <= 0 && yesAsk <= 0) continue;
      // Skip extreme prices (< 5¢ or > 95¢) - too risky for market making
      if (midPrice < 5 || midPrice > 95) continue;

      markets.push({
        ticker: m.ticker,
        title: m.title ?? '',
        subtitle: m.subtitle,
        series: seriesTicker,
        yesBid,
        yesAsk,
        spread,
        midPrice,
        volume24h,
        openInterest,
        liquidityScore: openInterest + volume24h,
        closeTime: m.close_time ?? '',
        status: m.status,
      });
    }

    cursor = data.cursor;
    if (pages >= 3) break;  // Limit pages per series
  } while (cursor);

  return markets;
}

// Raw Kalshi market from API
interface RawMarket {
  ticker: string;
  title?: string;
  subtitle?: string;
  status: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  close_time?: string;
}
