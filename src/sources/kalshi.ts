/**
 * Kalshi Data Source
 *
 * Fetches markets from Kalshi API.
 * This is the primary market data source.
 */

import { defineSource, type Market } from '../core/index.js';
import { kalshiFetchJson, hasKalshiAuth } from '../utils/kalshi-auth.js';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Series to fetch (expand as needed)
const SERIES_TO_FETCH = [
  // Crypto
  'KXBTC', 'KXBTCD', 'KXETH',
  // Economics
  'KXGDP', 'KXCPI', 'KXFED', 'KXJOBS', 'KXRECESSION',
  // Politics
  'KXPRES', 'KXSENATE', 'KXHOUSE',
  // Entertainment
  'KXRT', 'KXBOXOFFICE', 'KXOSCARS',
  // Health
  'KXMEASLES', 'KXFLU',
  // Sports (if active)
  'KXNFL', 'KXNBA', 'KXMLB',
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<Market[]>({
  name: 'kalshi',
  category: 'other',  // Kalshi spans all categories
  cacheTTL: 120,      // 2 minute cache (markets update frequently)

  async fetch(): Promise<Market[]> {
    const allMarkets: Market[] = [];

    // Check auth
    if (!hasKalshiAuth()) {
      logger.warn('Kalshi auth not configured, fetching limited markets');
    }

    // Fetch each series with progress logging
    let fetchedCount = 0;
    const startTime = Date.now();
    for (const series of SERIES_TO_FETCH) {
      try {
        const seriesStart = Date.now();
        const markets = await fetchSeriesMarkets(series);
        allMarkets.push(...markets);
        fetchedCount++;
        const elapsed = ((Date.now() - seriesStart) / 1000).toFixed(1);
        if (markets.length > 0) {
          logger.info(`Kalshi: ${series} → ${markets.length} markets (${elapsed}s) [${fetchedCount}/${SERIES_TO_FETCH.length}]`);
        }
      } catch (error) {
        fetchedCount++;
        logger.warn(`Kalshi: ${series} failed [${fetchedCount}/${SERIES_TO_FETCH.length}]: ${error}`);
      }
    }
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
    logger.info(`Kalshi: Completed in ${totalTime}s`);


    logger.info(`Fetched ${allMarkets.length} Kalshi markets from ${SERIES_TO_FETCH.length} series`);
    return allMarkets;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  status: string;
  yes_bid?: number;
  last_price?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  close_time?: string;
}

interface KalshiResponse {
  markets?: KalshiMarket[];
  cursor?: string;
}

/**
 * Fetch active markets for a series (with pagination limit).
 *
 * Note: Some series (crypto) have 1000+ markets. We limit to 5 pages
 * (500 markets) per series to prevent hanging. Most edge opportunities
 * are in the first few pages anyway.
 */
async function fetchSeriesMarkets(seriesTicker: string): Promise<Market[]> {
  const markets: Market[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 5;  // 500 markets max per series

  do {
    const url = cursor
      ? `/trade-api/v2/markets?series_ticker=${seriesTicker}&limit=100&cursor=${cursor}`
      : `/trade-api/v2/markets?series_ticker=${seriesTicker}&limit=100`;

    const data = await kalshiFetchJson<KalshiResponse>(url);
    if (!data?.markets) break;

    pageCount++;

    for (const m of data.markets) {
      if (m.status !== 'active') continue;

      const price = (m.yes_bid ?? m.last_price ?? 50) / 100;
      if (price <= 0 || price >= 1) continue;

      markets.push({
        platform: 'kalshi',
        id: m.ticker,
        ticker: m.ticker,
        title: m.title,
        subtitle: m.subtitle,
        category: categorizeMarket(seriesTicker, m.title),
        price,
        volume: m.volume,
        liquidity: m.open_interest,
        url: buildKalshiUrl(seriesTicker, m.ticker),
        closeTime: m.close_time,
      });
    }

    cursor = data.cursor;

    // Stop if we've hit the page limit
    if (pageCount >= MAX_PAGES && cursor) {
      logger.debug(`${seriesTicker}: Hit ${MAX_PAGES} page limit, stopping (more pages available)`);
      break;
    }
  } while (cursor);

  return markets;
}

/**
 * Categorize market based on series ticker.
 */
function categorizeMarket(series: string, title: string): Market['category'] {
  const s = series.toUpperCase();

  if (s.includes('BTC') || s.includes('ETH') || s.includes('CRYPTO')) return 'crypto';
  if (s.includes('GDP') || s.includes('CPI') || s.includes('FED') || s.includes('JOBS') || s.includes('RECESSION')) return 'macro';
  if (s.includes('PRES') || s.includes('SENATE') || s.includes('HOUSE')) return 'politics';
  if (s.includes('RT') || s.includes('BOX') || s.includes('OSCAR')) return 'entertainment';
  if (s.includes('MEASLES') || s.includes('FLU') || s.includes('COVID')) return 'health';
  if (s.includes('WEATHER') || s.includes('SNOW') || s.includes('RAIN')) return 'weather';
  if (s.includes('NFL') || s.includes('NBA') || s.includes('MLB') || s.includes('NHL')) return 'sports';

  return 'other';
}

/**
 * Build Kalshi market URL.
 */
function buildKalshiUrl(series: string, ticker: string): string {
  // Normalize for URL
  const seriesSlug = series.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tickerSlug = ticker.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `https://kalshi.com/markets/${seriesSlug}/${tickerSlug}`;
}
