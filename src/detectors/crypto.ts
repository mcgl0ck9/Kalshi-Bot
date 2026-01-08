/**
 * Crypto Price Edge Detector
 *
 * Detects edges in crypto price bucket markets by:
 * 1. Fetching current BTC/ETH spot prices
 * 2. Identifying mispricings on price threshold markets
 * 3. Using funding rates and sentiment as secondary signals
 *
 * EDGE THESIS:
 * Kalshi crypto markets are often mispriced because:
 * 1. Retail traders don't update quickly when prices move
 * 2. Bucket markets far from current price are often stale
 * 3. Funding rates indicate overleveraged positions (contrarian signal)
 *
 * CRITICAL: We only generate edges when we have real data.
 * No spot price = no edge (we don't guess).
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import type { CryptoFundingData, FearGreedIndex } from '../sources/crypto-funding.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.08;  // 8% minimum edge for crypto (noisy markets)
const MIN_CONFIDENCE = 0.50;

// Maximum number of edges per coin per scan (avoid spam)
const MAX_EDGES_PER_COIN = 2;

// Only consider buckets within this % of current price
const BUCKET_RANGE_PERCENT = 15;  // 15% above/below current price

// Volatility assumption for probability calculations (annualized)
const BTC_VOLATILITY = 0.60;  // 60% annual vol
const ETH_VOLATILITY = 0.70;  // 70% annual vol

// =============================================================================
// TYPES
// =============================================================================

interface CryptoSpotPrices {
  BTC: number | null;
  ETH: number | null;
  fetchedAt: string;
}

interface BucketMarket extends Market {
  symbol: 'BTC' | 'ETH';
  threshold: number;
  isAbove: boolean;  // true = "price above X", false = "price below X"
}

// =============================================================================
// SPOT PRICE FETCHING
// =============================================================================

let cachedPrices: CryptoSpotPrices | null = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Fetch current spot prices from free public APIs
 */
async function fetchSpotPrices(): Promise<CryptoSpotPrices> {
  // Use cache if fresh
  if (cachedPrices && Date.now() - cacheTime < CACHE_TTL) {
    return cachedPrices;
  }

  const prices: CryptoSpotPrices = {
    BTC: null,
    ETH: null,
    fetchedAt: new Date().toISOString(),
  };

  try {
    // CoinGecko free API (no key needed, 10-50 calls/min)
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
      {
        headers: { 'Accept': 'application/json' },
      }
    );

    if (response.ok) {
      const data = await response.json() as {
        bitcoin?: { usd?: number };
        ethereum?: { usd?: number };
      };

      prices.BTC = data.bitcoin?.usd ?? null;
      prices.ETH = data.ethereum?.usd ?? null;

      logger.info(`Crypto prices: BTC=$${prices.BTC?.toLocaleString()}, ETH=$${prices.ETH?.toLocaleString()}`);
    }
  } catch (error) {
    logger.warn(`CoinGecko fetch failed: ${error}, trying fallback`);
  }

  // Fallback: Binance public ticker (no auth needed)
  if (prices.BTC === null || prices.ETH === null) {
    try {
      const binanceResponse = await fetch(
        'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]'
      );

      if (binanceResponse.ok) {
        const data = await binanceResponse.json() as Array<{ symbol: string; price: string }>;
        for (const ticker of data) {
          if (ticker.symbol === 'BTCUSDT' && prices.BTC === null) {
            prices.BTC = parseFloat(ticker.price);
          }
          if (ticker.symbol === 'ETHUSDT' && prices.ETH === null) {
            prices.ETH = parseFloat(ticker.price);
          }
        }
      }
    } catch (error) {
      logger.warn(`Binance fallback failed: ${error}`);
    }
  }

  // Update cache
  cachedPrices = prices;
  cacheTime = Date.now();

  return prices;
}

// =============================================================================
// MARKET PARSING
// =============================================================================

/**
 * Extract bucket information from market title
 * Examples:
 * - "Bitcoin price on Jan 6, 2026?" with subtitle "$90,500 to 90,999.99"
 * - "Will BTC be above $100,000 on Jan 31?"
 */
function parseBucketMarket(market: Market): BucketMarket | null {
  const title = market.title.toLowerCase();
  const subtitle = (market.subtitle || '').toLowerCase();
  const fullText = `${title} ${subtitle}`;

  // Determine symbol
  let symbol: 'BTC' | 'ETH' | null = null;
  if (title.includes('bitcoin') || title.includes('btc')) {
    symbol = 'BTC';
  } else if (title.includes('ethereum') || title.includes('eth')) {
    symbol = 'ETH';
  }

  if (!symbol) return null;

  // Extract price threshold from subtitle (bucket markets)
  // Format: "$90,500 to 90,999.99" or "$100,000 or more"
  let threshold: number | null = null;
  let isAbove = true;

  // Pattern: "$X,XXX to X,XXX" - use lower bound
  const rangeMatch = subtitle.match(/\$?([\d,]+)\s*to\s*([\d,]+)/);
  if (rangeMatch) {
    threshold = parseFloat(rangeMatch[1].replace(/,/g, ''));
    isAbove = true;  // Price needs to be >= lower bound for YES
  }

  // Pattern: "$X,XXX or more" or "above $X"
  const aboveMatch = subtitle.match(/(?:\$?([\d,]+)\s*or\s*more)|(?:above\s*\$?([\d,]+))/i);
  if (aboveMatch) {
    threshold = parseFloat((aboveMatch[1] || aboveMatch[2]).replace(/,/g, ''));
    isAbove = true;
  }

  // Pattern: "below $X" or "under $X"
  const belowMatch = fullText.match(/(?:below|under)\s*\$?([\d,]+)/i);
  if (belowMatch) {
    threshold = parseFloat(belowMatch[1].replace(/,/g, ''));
    isAbove = false;
  }

  // Pattern: just a number in subtitle for bucket markets
  if (!threshold && subtitle) {
    const numMatch = subtitle.match(/\$?([\d,]+)/);
    if (numMatch) {
      threshold = parseFloat(numMatch[1].replace(/,/g, ''));
      isAbove = true;
    }
  }

  if (!threshold || threshold <= 0) return null;

  return {
    ...market,
    symbol,
    threshold,
    isAbove,
  };
}

// =============================================================================
// PROBABILITY CALCULATION
// =============================================================================

/**
 * Calculate probability price will be above threshold using log-normal model
 *
 * Uses Black-Scholes style probability calculation:
 * P(S_T > K) = N(d2) where d2 = (ln(S/K) + (r - 0.5*σ²)T) / (σ*√T)
 *
 * Simplified for prediction markets (no risk-free rate, short horizon):
 * P(S_T > K) ≈ N((ln(S/K)) / (σ*√T))
 */
function calculateProbAboveThreshold(
  currentPrice: number,
  threshold: number,
  volatility: number,
  daysToExpiry: number
): number {
  if (currentPrice <= 0 || threshold <= 0) return 0.5;

  // Time in years
  const T = Math.max(daysToExpiry / 365, 1/365);  // Minimum 1 day

  // Log return to threshold
  const logReturn = Math.log(currentPrice / threshold);

  // Standard deviation of price at expiry
  const sigma = volatility * Math.sqrt(T);

  // d2 simplified (no drift)
  const d2 = logReturn / sigma;

  // Normal CDF approximation
  return normalCDF(d2);
}

/**
 * Standard normal CDF approximation (Zelen & Severo)
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);

  return 0.5 * (1.0 + sign * y);
}

// =============================================================================
// EDGE ANALYSIS
// =============================================================================

function analyzeEdge(
  market: BucketMarket,
  spotPrice: number,
  fundingData: CryptoFundingData | undefined,
  daysToExpiry: number
): Edge | null {
  const volatility = market.symbol === 'BTC' ? BTC_VOLATILITY : ETH_VOLATILITY;

  // Calculate base probability from price model
  const probAbove = calculateProbAboveThreshold(
    spotPrice,
    market.threshold,
    volatility,
    daysToExpiry
  );

  const impliedProb = market.isAbove ? probAbove : (1 - probAbove);

  // Adjust for funding rates (contrarian signal)
  let adjustedProb = impliedProb;
  let fundingSignal = '';

  if (fundingData?.funding) {
    const funding = fundingData.funding.find(f =>
      f.symbol.toUpperCase() === market.symbol
    );

    if (funding && funding.contrarian) {
      // Extreme funding is a contrarian signal
      if (funding.contrarian === 'BUY' && market.isAbove) {
        adjustedProb = Math.min(0.95, impliedProb + 0.05);
        fundingSignal = `Negative funding (${(funding.weightedFundingRate * 100).toFixed(3)}%) suggests shorts overleveraged`;
      } else if (funding.contrarian === 'SELL' && market.isAbove) {
        adjustedProb = Math.max(0.05, impliedProb - 0.05);
        fundingSignal = `Positive funding (${(funding.weightedFundingRate * 100).toFixed(3)}%) suggests longs overleveraged`;
      }
    }
  }

  // Adjust for Fear & Greed (contrarian)
  let fearGreedSignal = '';
  if (fundingData?.fearGreed) {
    const fg = fundingData.fearGreed;
    if (fg.classification === 'extreme_fear' && market.isAbove) {
      adjustedProb = Math.min(0.95, adjustedProb + 0.03);
      fearGreedSignal = `Extreme Fear (${fg.value}) is contrarian bullish`;
    } else if (fg.classification === 'extreme_greed' && market.isAbove) {
      adjustedProb = Math.max(0.05, adjustedProb - 0.03);
      fearGreedSignal = `Extreme Greed (${fg.value}) is contrarian bearish`;
    }
  }

  // Calculate edge
  const marketPrice = market.price;
  const edge = Math.abs(adjustedProb - marketPrice);

  if (edge < MIN_EDGE) {
    return null;
  }

  // Determine direction
  const direction = adjustedProb > marketPrice ? 'YES' : 'NO';

  // Calculate confidence based on how close price is to threshold
  const priceDistance = Math.abs(spotPrice - market.threshold) / spotPrice;
  let confidence = 0.50;

  // Higher confidence when current price is far from threshold
  if (priceDistance > 0.10) {
    confidence += 0.15;
  } else if (priceDistance > 0.05) {
    confidence += 0.10;
  } else if (priceDistance < 0.02) {
    confidence -= 0.10;  // Too close to threshold = uncertain
  }

  // Higher confidence with more time to expiry (less likely to flip)
  if (daysToExpiry <= 1) {
    confidence += 0.15;  // Very short term, current price very predictive
  } else if (daysToExpiry <= 7) {
    confidence += 0.05;
  }

  // Funding signals add confidence
  if (fundingSignal || fearGreedSignal) {
    confidence += 0.05;
  }

  confidence = Math.max(MIN_CONFIDENCE, Math.min(0.85, confidence));

  // Build detailed reason
  const reason = buildReason(
    market,
    spotPrice,
    adjustedProb,
    marketPrice,
    direction,
    daysToExpiry,
    fundingSignal,
    fearGreedSignal
  );

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'crypto',
      symbol: market.symbol,
      currentPrice: spotPrice,
      threshold: market.threshold,
      isAbove: market.isAbove,
      impliedProb: adjustedProb,
      marketPrice,
      daysToExpiry,
      fundingSignal: fundingSignal || undefined,
      fearGreedSignal: fearGreedSignal || undefined,
    }
  );
}

function buildReason(
  market: BucketMarket,
  spotPrice: number,
  impliedProb: number,
  marketPrice: number,
  direction: 'YES' | 'NO',
  daysToExpiry: number,
  fundingSignal: string,
  fearGreedSignal: string
): string {
  const symbol = market.symbol;
  const priceStr = spotPrice.toLocaleString();
  const thresholdStr = market.threshold.toLocaleString();
  const impliedPct = (impliedProb * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);
  const edgePct = (Math.abs(impliedProb - marketPrice) * 100).toFixed(1);

  const lines: string[] = [];

  // Current price context
  const above = spotPrice > market.threshold;
  const diff = Math.abs(spotPrice - market.threshold);
  const diffPct = ((diff / market.threshold) * 100).toFixed(1);

  if (above) {
    lines.push(`${symbol} is at $${priceStr} - currently $${diff.toLocaleString()} (${diffPct}%) ABOVE $${thresholdStr} threshold.`);
  } else {
    lines.push(`${symbol} is at $${priceStr} - currently $${diff.toLocaleString()} (${diffPct}%) BELOW $${thresholdStr} threshold.`);
  }

  // Time context
  if (daysToExpiry <= 1) {
    lines.push(`Expires TODAY - price unlikely to move ${diffPct}% in hours.`);
  } else if (daysToExpiry <= 3) {
    lines.push(`Expires in ${daysToExpiry} days - limited time for major move.`);
  }

  // Probability assessment
  lines.push(`Model estimate: ${impliedPct}% vs market ${marketPct}% (+${edgePct}% edge).`);

  // Funding/sentiment signals
  if (fundingSignal) {
    lines.push(fundingSignal);
  }
  if (fearGreedSignal) {
    lines.push(fearGreedSignal);
  }

  return lines.join(' ');
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'crypto',
  description: 'Detects edges in BTC/ETH price bucket markets using spot prices and funding data',
  sources: ['kalshi', 'crypto-funding'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Fetch current spot prices
    const spotPrices = await fetchSpotPrices();

    if (!spotPrices.BTC && !spotPrices.ETH) {
      logger.warn('Crypto detector: No spot prices available, skipping');
      return edges;
    }

    // Get funding data (optional, enhances confidence)
    const fundingData = data['crypto-funding'] as CryptoFundingData | undefined;

    // Filter to crypto markets
    const cryptoMarkets = markets.filter(m =>
      m.category === 'crypto' ||
      m.title.toLowerCase().includes('bitcoin') ||
      m.title.toLowerCase().includes('btc') ||
      m.title.toLowerCase().includes('ethereum') ||
      m.title.toLowerCase().includes('eth')
    );

    if (cryptoMarkets.length === 0) {
      logger.debug('Crypto detector: No crypto markets found');
      return edges;
    }

    logger.info(`Crypto detector: Analyzing ${cryptoMarkets.length} crypto markets`);
    logger.info(`Spot prices: BTC=$${spotPrices.BTC?.toLocaleString() || 'N/A'}, ETH=$${spotPrices.ETH?.toLocaleString() || 'N/A'}`);

    // Track edges per coin for deduplication
    const edgesPerCoin: Record<string, Edge[]> = { BTC: [], ETH: [] };

    for (const market of cryptoMarkets) {
      // Parse bucket info
      const bucket = parseBucketMarket(market);
      if (!bucket) continue;

      // Get spot price for this symbol
      const spotPrice = spotPrices[bucket.symbol];
      if (!spotPrice) {
        logger.debug(`Crypto: No spot price for ${bucket.symbol}, skipping ${market.title}`);
        continue;
      }

      // Only consider buckets within reasonable range of current price
      const priceDiff = Math.abs(spotPrice - bucket.threshold) / spotPrice;
      if (priceDiff > BUCKET_RANGE_PERCENT / 100) {
        logger.debug(`Crypto: Bucket $${bucket.threshold} is ${(priceDiff * 100).toFixed(0)}% from current price, skipping`);
        continue;
      }

      // Calculate days to expiry
      let daysToExpiry = 7;  // Default assumption
      if (market.closeTime) {
        const closeDate = new Date(market.closeTime);
        daysToExpiry = Math.max(0, (closeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }

      // Analyze edge
      const edge = analyzeEdge(bucket, spotPrice, fundingData, daysToExpiry);
      if (edge) {
        edgesPerCoin[bucket.symbol].push(edge);
      }
    }

    // Deduplicate: only keep top N edges per coin, sorted by edge size
    for (const symbol of ['BTC', 'ETH'] as const) {
      const coinEdges = edgesPerCoin[symbol]
        .sort((a, b) => b.edge - a.edge)
        .slice(0, MAX_EDGES_PER_COIN);

      edges.push(...coinEdges);
    }

    logger.info(`Crypto detector: Found ${edges.length} edges (after dedup)`);
    return edges;
  },
});
