/**
 * Crypto Funding Rate & Sentiment Source
 *
 * Fetches funding rates and market sentiment from free public sources:
 * - Hyperliquid (primary - DeFi perps, no geo-blocking)
 * - Coinglass (fallback - funding rates, open interest)
 * - Alternative.me (Fear & Greed Index)
 *
 * Extreme funding rates are contrarian indicators:
 * - Very positive funding (>0.08%) = overleveraged longs = bearish signal
 * - Very negative funding (<-0.03%) = overleveraged shorts = bullish signal
 *
 * All sources are FREE.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FundingAggregate {
  symbol: string;
  avgFundingRate: number;
  weightedFundingRate: number;
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

export interface CryptoFundingData {
  funding: FundingAggregate[];
  fearGreed: FearGreedIndex | null;
  fetchedAt: string;
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

const HYPERLIQUID_URL = 'https://api.hyperliquid.xyz/info';
const COINGLASS_FUNDING_URL = 'https://fapi.coinglass.com/api/fundingRate/v2/home';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=2';

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<CryptoFundingData>({
  name: 'crypto-funding',
  category: 'crypto',
  cacheTTL: 300,  // 5 min cache (funding updates frequently)

  async fetch(): Promise<CryptoFundingData> {
    const [funding, fearGreed] = await Promise.all([
      fetchFundingRates(),
      fetchFearGreedIndex(),
    ]);

    return {
      funding,
      fearGreed,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// DATA FETCHERS
// =============================================================================

/**
 * Fetch funding rates - uses Hyperliquid as primary (DeFi, no geo-blocking)
 */
async function fetchFundingRates(): Promise<FundingAggregate[]> {
  // Primary: Use Hyperliquid (DeFi, works everywhere, no rate limits)
  const hyperliquidResults = await fetchHyperliquidFunding();
  if (hyperliquidResults.length > 0) {
    return hyperliquidResults;
  }

  // Fallback: Try Coinglass
  return fetchCoinglassFunding();
}

/**
 * Fetch funding rates from Hyperliquid (DeFi perps, no geo-blocking)
 */
async function fetchHyperliquidFunding(): Promise<FundingAggregate[]> {
  const results: FundingAggregate[] = [];

  try {
    const response = await fetch(HYPERLIQUID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const symbolMap: Record<string, string> = {
      'BTC': 'BTC', 'ETH': 'ETH', 'SOL': 'SOL', 'DOGE': 'DOGE',
      'XRP': 'XRP', 'BNB': 'BNB', 'ADA': 'ADA', 'AVAX': 'AVAX', 'HYPE': 'HYPE',
    };

    for (let i = 0; i < meta.universe.length && i < assetCtxs.length; i++) {
      const assetMeta = meta.universe[i];
      const assetData = assetCtxs[i];

      const standardSymbol = symbolMap[assetMeta.name];
      if (!standardSymbol) continue;

      const rate = parseFloat(assetData.funding) * 100;
      const oi = parseFloat(assetData.openInterest) * parseFloat(assetData.markPx || '0');

      const { extremeLevel, contrarian } = classifyFundingLevel(rate);

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

/**
 * Fallback: Fetch from Coinglass
 */
async function fetchCoinglassFunding(): Promise<FundingAggregate[]> {
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

    if (data.code !== 0 || !data.data) return results;

    for (const coin of data.data) {
      if (!coin.symbol || !coin.uMarginList?.length) continue;

      const rates = coin.uMarginList.filter(r => r.rate !== undefined);
      if (rates.length === 0) continue;

      const avgRate = rates.reduce((sum, r) => sum + (r.rate ?? 0), 0) / rates.length;
      const totalOI = rates.reduce((sum, r) => sum + (r.openInterest ?? 0), 0);

      const weightedRate = totalOI > 0
        ? rates.reduce((sum, r) => sum + (r.rate ?? 0) * (r.openInterest ?? 0), 0) / totalOI
        : avgRate;

      const { extremeLevel, contrarian } = classifyFundingLevel(weightedRate);

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
 * Classify funding level and determine contrarian signal
 */
function classifyFundingLevel(rate: number): {
  extremeLevel: FundingAggregate['extremeLevel'];
  contrarian: FundingAggregate['contrarian'];
} {
  if (rate > 0.08) {
    return { extremeLevel: 'very_bullish', contrarian: 'SELL' };
  } else if (rate > 0.03) {
    return { extremeLevel: 'bullish', contrarian: 'SELL' };
  } else if (rate < -0.08) {
    return { extremeLevel: 'very_bearish', contrarian: 'BUY' };
  } else if (rate < -0.03) {
    return { extremeLevel: 'bearish', contrarian: 'BUY' };
  }
  return { extremeLevel: 'neutral', contrarian: null };
}

/**
 * Fetch Bitcoin Fear & Greed Index
 */
async function fetchFearGreedIndex(): Promise<FearGreedIndex | null> {
  try {
    const response = await fetch(FEAR_GREED_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KalshiEdgeDetector/4.0',
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
// EDGE ANALYSIS HELPERS
// =============================================================================

export interface CryptoEdgeSignal {
  symbol: string;
  signalType: 'funding_extreme' | 'fear_greed';
  direction: 'YES' | 'NO';
  strength: number;
  reasoning: string;
  data: {
    fundingRate?: number;
    fearGreed?: number;
    openInterest?: number;
  };
}

/**
 * Analyze funding rates for edge opportunities
 */
export function analyzeFundingEdge(
  funding: FundingAggregate[],
  symbol: string,
  kalshiPrice: number,
  isUpMarket: boolean
): CryptoEdgeSignal | null {
  const coinFunding = funding.find(f =>
    f.symbol.toUpperCase() === symbol.toUpperCase() ||
    f.symbol.toUpperCase() === `${symbol.toUpperCase()}USDT`
  );

  if (!coinFunding || coinFunding.contrarian === null) return null;

  const shouldBuy = coinFunding.contrarian === 'BUY';
  const shouldSell = coinFunding.contrarian === 'SELL';

  let direction: 'YES' | 'NO';
  let reasoning: string;

  if (isUpMarket) {
    if (shouldBuy) {
      direction = 'YES';
      reasoning = `Extreme negative funding (${(coinFunding.weightedFundingRate * 100).toFixed(3)}%) indicates overleveraged shorts - contrarian bullish`;
    } else if (shouldSell) {
      direction = 'NO';
      reasoning = `Extreme positive funding (${(coinFunding.weightedFundingRate * 100).toFixed(3)}%) indicates overleveraged longs - contrarian bearish`;
    } else {
      return null;
    }
  } else {
    if (shouldBuy) {
      direction = 'NO';
      reasoning = `Extreme negative funding suggests price more likely to go up than down`;
    } else if (shouldSell) {
      direction = 'YES';
      reasoning = `Extreme positive funding suggests downside risk`;
    } else {
      return null;
    }
  }

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
  if (fearGreed.classification === 'neutral') return null;

  let direction: 'YES' | 'NO';
  let reasoning: string;

  const isFearish = fearGreed.classification === 'extreme_fear' || fearGreed.classification === 'fear';
  const isGreedish = fearGreed.classification === 'extreme_greed' || fearGreed.classification === 'greed';
  const intensityLabel = fearGreed.classification.includes('extreme') ? 'Extreme ' : '';

  if (isUpMarket) {
    if (isFearish) {
      direction = 'YES';
      reasoning = `Fear & Greed at ${fearGreed.value} (${intensityLabel}Fear) - contrarian bullish signal`;
    } else {
      direction = 'NO';
      reasoning = `Fear & Greed at ${fearGreed.value} (${intensityLabel}Greed) - contrarian bearish signal`;
    }
  } else {
    if (isFearish) {
      direction = 'NO';
      reasoning = `Fear suggests more upside than downside`;
    } else {
      direction = 'YES';
      reasoning = `Greed suggests correction likely`;
    }
  }

  const strength = isFearish
    ? (50 - fearGreed.value) / 50
    : (fearGreed.value - 50) / 50;

  return {
    symbol: 'BTC',
    signalType: 'fear_greed',
    direction,
    strength: Math.min(strength, 0.8),
    reasoning,
    data: { fearGreed: fearGreed.value },
  };
}
