/**
 * Crypto Funding Rate & Sentiment Fetcher
 *
 * Fetches funding rates and market sentiment from free public sources:
 * - Coinglass (funding rates, open interest)
 * - Alternative.me (Fear & Greed Index)
 * - CoinGecko (price data)
 *
 * Extreme funding rates are contrarian indicators:
 * - Very positive funding (>0.1%) = overleveraged longs = bearish signal
 * - Very negative funding (<-0.05%) = overleveraged shorts = bullish signal
 *
 * All sources are FREE.
 */

import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FundingRate {
  symbol: string;
  exchange: string;
  rate: number;           // Current funding rate (e.g., 0.01 = 1%)
  predictedRate: number;  // Next predicted rate
  openInterest: number;   // USD value of open positions
  timestamp: string;
}

export interface FundingAggregate {
  symbol: string;
  avgFundingRate: number;
  weightedFundingRate: number;  // Weighted by OI
  totalOpenInterest: number;
  extremeLevel: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
  contrarian: 'BUY' | 'SELL' | null;
  exchanges: number;
}

export interface FearGreedIndex {
  value: number;          // 0-100
  classification: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  timestamp: string;
  previousValue: number;
  previousClassification: string;
}

export interface CryptoEdgeSignal {
  symbol: string;
  signalType: 'funding_extreme' | 'fear_greed' | 'oi_divergence';
  direction: 'BUY YES' | 'BUY NO';
  strength: number;        // 0-1
  reasoning: string;
  data: {
    fundingRate?: number;
    fearGreed?: number;
    openInterest?: number;
  };
}

// =============================================================================
// COINGLASS PUBLIC DATA
// =============================================================================

const COINGLASS_FUNDING_URL = 'https://fapi.coinglass.com/api/fundingRate/v2/home';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=2';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3';
const HYPERLIQUID_URL = 'https://api.hyperliquid.xyz/info';

/**
 * Fetch funding rates - uses Hyperliquid as primary (DeFi, no geo-blocking)
 * Falls back to Coinglass for aggregated data if available
 */
export async function fetchFundingRates(): Promise<FundingAggregate[]> {
  // Primary: Use Hyperliquid (DeFi, works everywhere, no rate limits)
  const hyperliquidResults = await fetchHyperliquidFunding();
  if (hyperliquidResults.length > 0) {
    return hyperliquidResults;
  }

  // Fallback: Try Coinglass (may be rate limited)
  const results: FundingAggregate[] = [];

  try {
    const response = await fetch(COINGLASS_FUNDING_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      logger.debug(`Coinglass funding API: ${response.status}`);
      return results;
    }

    const data = await response.json() as {
      code?: number;
      data?: Array<{
        symbol?: string;
        uMarginList?: Array<{
          exchangeName?: string;
          rate?: number;
          predictedRate?: number;
          openInterest?: number;
        }>;
      }>;
    };

    if (data.code !== 0 || !data.data) {
      return results;
    }

    // Process each symbol
    for (const coin of data.data) {
      if (!coin.symbol || !coin.uMarginList?.length) continue;

      const rates = coin.uMarginList.filter(r => r.rate !== undefined);
      if (rates.length === 0) continue;

      const avgRate = rates.reduce((sum, r) => sum + (r.rate ?? 0), 0) / rates.length;
      const totalOI = rates.reduce((sum, r) => sum + (r.openInterest ?? 0), 0);

      // Weighted average by OI
      const weightedRate = totalOI > 0
        ? rates.reduce((sum, r) => sum + (r.rate ?? 0) * (r.openInterest ?? 0), 0) / totalOI
        : avgRate;

      // Classify funding level
      // Thresholds lowered to catch more edge opportunities
      let extremeLevel: FundingAggregate['extremeLevel'] = 'neutral';
      let contrarian: FundingAggregate['contrarian'] = null;

      if (weightedRate > 0.08) {
        extremeLevel = 'very_bullish';
        contrarian = 'SELL';
      } else if (weightedRate > 0.03) {
        extremeLevel = 'bullish';
        contrarian = 'SELL';  // Added: elevated funding generates signal
      } else if (weightedRate < -0.03) {
        extremeLevel = 'bearish';
        contrarian = 'BUY';  // Added: elevated negative funding generates signal
      } else if (weightedRate < -0.08) {
        extremeLevel = 'very_bearish';
        contrarian = 'BUY';
      }

      results.push({
        symbol: coin.symbol,
        avgFundingRate: avgRate,
        weightedFundingRate: weightedRate,
        totalOpenInterest: totalOI,
        extremeLevel,
        contrarian,
        exchanges: rates.length,
      });
    }

    logger.info(`Fetched funding rates for ${results.length} symbols from Coinglass`);
  } catch (error) {
    logger.error(`Coinglass funding fetch error: ${error}`);
  }

  return results;
}

/**
 * Fetch funding rates from Hyperliquid (DeFi perps, no geo-blocking)
 * This is the primary method - works globally without API keys
 * Source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 */
async function fetchHyperliquidFunding(): Promise<FundingAggregate[]> {
  const results: FundingAggregate[] = [];

  try {
    const response = await fetch(HYPERLIQUID_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });

    if (!response.ok) {
      logger.debug(`Hyperliquid API: ${response.status}`);
      return results;
    }

    const data = await response.json() as [
      { universe: Array<{ name: string; szDecimals: number }> },
      Array<{ funding: string; openInterest: string; markPx: string }>
    ];

    const [meta, assetCtxs] = data;
    if (!meta?.universe || !assetCtxs) return results;

    // Map Hyperliquid symbols to our standard names
    const symbolMap: Record<string, string> = {
      'BTC': 'BTC',
      'ETH': 'ETH',
      'SOL': 'SOL',
      'DOGE': 'DOGE',
      'XRP': 'XRP',
      'BNB': 'BNB',
      'ADA': 'ADA',
      'AVAX': 'AVAX',
      'HYPE': 'HYPE',  // Hyperliquid's native token
    };

    for (let i = 0; i < meta.universe.length && i < assetCtxs.length; i++) {
      const assetMeta = meta.universe[i];
      const assetData = assetCtxs[i];

      const standardSymbol = symbolMap[assetMeta.name];
      if (!standardSymbol) continue;

      // Hyperliquid funding is per 8 hours, convert to percentage
      // funding of 0.0001 = 0.01% per 8h
      const rate = parseFloat(assetData.funding) * 100;  // Convert to percentage
      const oi = parseFloat(assetData.openInterest) * parseFloat(assetData.markPx || '0');

      let extremeLevel: FundingAggregate['extremeLevel'] = 'neutral';
      let contrarian: FundingAggregate['contrarian'] = null;

      // Thresholds: normal funding is ~0.01% (0.0001)
      // > 0.03% is elevated (generates signal), > 0.08% is extreme
      // Lowered from 0.1% to catch more edge opportunities
      if (rate > 0.08) {
        extremeLevel = 'very_bullish';
        contrarian = 'SELL';
      } else if (rate > 0.03) {
        extremeLevel = 'bullish';
        contrarian = 'SELL';  // Added: elevated funding also generates signal
      } else if (rate < -0.03) {
        extremeLevel = 'bearish';
        contrarian = 'BUY';  // Added: elevated negative funding generates signal
      } else if (rate < -0.08) {
        extremeLevel = 'very_bearish';
        contrarian = 'BUY';
      }

      results.push({
        symbol: standardSymbol,
        avgFundingRate: rate,
        weightedFundingRate: rate,
        totalOpenInterest: oi,
        extremeLevel,
        contrarian,
        exchanges: 1,
      });
    }

    logger.info(`Fetched funding rates for ${results.length} symbols from Hyperliquid`);
  } catch (error) {
    logger.error(`Hyperliquid funding fetch error: ${error}`);
  }

  return results;
}

// =============================================================================
// FEAR & GREED INDEX
// =============================================================================

/**
 * Fetch Bitcoin Fear & Greed Index
 * Extreme fear = contrarian buy signal
 * Extreme greed = contrarian sell signal
 */
export async function fetchFearGreedIndex(): Promise<FearGreedIndex | null> {
  try {
    const response = await fetch(FEAR_GREED_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KalshiEdgeDetector/2.0',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      data?: Array<{
        value?: string;
        value_classification?: string;
        timestamp?: string;
      }>;
    };

    if (!data.data || data.data.length < 2) return null;

    const current = data.data[0];
    const previous = data.data[1];

    const value = parseInt(current.value ?? '50');
    let classification: FearGreedIndex['classification'] = 'neutral';

    if (value <= 20) classification = 'extreme_fear';
    else if (value <= 40) classification = 'fear';
    else if (value <= 60) classification = 'neutral';
    else if (value <= 80) classification = 'greed';
    else classification = 'extreme_greed';

    return {
      value,
      classification,
      timestamp: current.timestamp ?? new Date().toISOString(),
      previousValue: parseInt(previous.value ?? '50'),
      previousClassification: previous.value_classification ?? 'neutral',
    };
  } catch (error) {
    logger.error(`Fear & Greed fetch error: ${error}`);
    return null;
  }
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Analyze funding rates for edge opportunities
 */
export function analyzeFundingEdge(
  funding: FundingAggregate[],
  symbol: string,
  kalshiPrice: number,  // Current market price (0-1)
  isUpMarket: boolean   // Is this a "price goes up" market?
): CryptoEdgeSignal | null {
  const coinFunding = funding.find(f =>
    f.symbol.toUpperCase() === symbol.toUpperCase() ||
    f.symbol.toUpperCase() === `${symbol.toUpperCase()}USDT`
  );

  if (!coinFunding || coinFunding.contrarian === null) return null;

  // Contrarian signal exists
  const shouldBuy = coinFunding.contrarian === 'BUY';  // Funding very negative
  const shouldSell = coinFunding.contrarian === 'SELL';  // Funding very positive

  let direction: 'BUY YES' | 'BUY NO';
  let reasoning: string;

  if (isUpMarket) {
    // Market is "will price go up?"
    if (shouldBuy) {
      direction = 'BUY YES';
      reasoning = `Extreme negative funding (${(coinFunding.weightedFundingRate * 100).toFixed(3)}%) indicates overleveraged shorts - contrarian bullish`;
    } else if (shouldSell) {
      direction = 'BUY NO';
      reasoning = `Extreme positive funding (${(coinFunding.weightedFundingRate * 100).toFixed(3)}%) indicates overleveraged longs - contrarian bearish`;
    } else {
      return null;
    }
  } else {
    // Market is "will price go down?"
    if (shouldBuy) {
      direction = 'BUY NO';
      reasoning = `Extreme negative funding suggests price more likely to go up than down`;
    } else if (shouldSell) {
      direction = 'BUY YES';
      reasoning = `Extreme positive funding suggests downside risk`;
    } else {
      return null;
    }
  }

  // Strength based on how extreme the funding is
  const strength = Math.min(Math.abs(coinFunding.weightedFundingRate) / 0.15, 1);

  return {
    symbol,
    signalType: 'funding_extreme',
    direction,
    strength,
    reasoning,
    data: {
      fundingRate: coinFunding.weightedFundingRate,
      openInterest: coinFunding.totalOpenInterest,
    },
  };
}

/**
 * Analyze Fear & Greed for crypto market edges
 */
export function analyzeFearGreedEdge(
  fearGreed: FearGreedIndex,
  kalshiPrice: number,
  isUpMarket: boolean
): CryptoEdgeSignal | null {
  // Signal on fear or greed readings (not just extreme)
  // Lowered thresholds to catch more edge opportunities
  if (fearGreed.classification !== 'extreme_fear' &&
      fearGreed.classification !== 'fear' &&
      fearGreed.classification !== 'extreme_greed' &&
      fearGreed.classification !== 'greed') {
    return null;
  }

  let direction: 'BUY YES' | 'BUY NO';
  let reasoning: string;

  const isFearish = fearGreed.classification === 'extreme_fear' || fearGreed.classification === 'fear';
  const isGreedish = fearGreed.classification === 'extreme_greed' || fearGreed.classification === 'greed';
  const intensityLabel = fearGreed.classification.includes('extreme') ? 'Extreme ' : '';

  if (isUpMarket) {
    if (isFearish) {
      direction = 'BUY YES';
      reasoning = `Fear & Greed at ${fearGreed.value} (${intensityLabel}Fear) - contrarian bullish signal`;
    } else {
      direction = 'BUY NO';
      reasoning = `Fear & Greed at ${fearGreed.value} (${intensityLabel}Greed) - contrarian bearish signal`;
    }
  } else {
    if (isFearish) {
      direction = 'BUY NO';
      reasoning = `Fear suggests more upside than downside`;
    } else {
      direction = 'BUY YES';
      reasoning = `Greed suggests correction likely`;
    }
  }

  // Strength based on how extreme (adjusted for wider range)
  const strength = isFearish
    ? (50 - fearGreed.value) / 50
    : (fearGreed.value - 50) / 50;

  return {
    symbol: 'BTC',  // Fear & Greed is BTC-focused
    signalType: 'fear_greed',
    direction,
    strength: Math.min(strength, 0.8),
    reasoning,
    data: {
      fearGreed: fearGreed.value,
    },
  };
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Fetch all crypto sentiment data
 */
export async function fetchAllCryptoSentiment(): Promise<{
  funding: FundingAggregate[];
  fearGreed: FearGreedIndex | null;
}> {
  const [funding, fearGreed] = await Promise.all([
    fetchFundingRates(),
    fetchFearGreedIndex(),
  ]);

  return { funding, fearGreed };
}
