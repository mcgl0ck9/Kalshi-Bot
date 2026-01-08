/**
 * Polymarket On-Chain Data Fetcher
 *
 * Fetches whale positions, order book depth, and conviction data
 * from Polymarket's Goldsky subgraphs and APIs.
 *
 * VALIDATED WORKING DATA SOURCES (as of 2024-12):
 * 1. PnL Subgraph - userPositions with amount, avgPrice, realizedPnl, tokenId
 * 2. Orderbook Subgraph - orderFilledEvents for trade flow
 * 3. Gamma API - market metadata, conditionId, clobTokenIds, prices
 * 4. CLOB API - order book depth (bids/asks)
 *
 * EDGE SOURCE: Polymarket has transparent on-chain data that Kalshi lacks.
 * We can see which wallets hold large positions and in which direction.
 */

import { logger } from '../../utils/index.js';
import { POLYMARKET_SUBGRAPHS, POLYMARKET_API, WHALE_POSITION_THRESHOLD, WHALE_CONVICTION_THRESHOLD } from '../../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WhalePosition {
  wallet: string;
  marketId: string;
  marketTitle: string;
  outcome: 'YES' | 'NO';
  size: number;           // Position size in USDC
  avgPrice: number;       // Average entry price (0-1)
  currentPrice: number;   // Current market price
  unrealizedPnl: number;
  conviction: number;     // % of whale's total capital in this position
  timestamp: string;
}

export interface MarketConviction {
  marketId: string;
  marketTitle: string;
  totalYesVolume: number;
  totalNoVolume: number;
  whaleYesVolume: number;
  whaleNoVolume: number;
  whaleConviction: 'YES' | 'NO' | 'NEUTRAL';
  convictionStrength: number;  // 0-1, how one-sided whale positioning is
  topWhales: WhalePosition[];
  currentPrice: number;
  impliedProbFromWhales: number;  // What whales think the probability is
}

export interface OrderbookDepth {
  marketId: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  bidDepth: number;       // Total USDC on bid side
  askDepth: number;       // Total USDC on ask side
  depthImbalance: number; // (bid - ask) / (bid + ask), positive = more bids
  largestBid: number;
  largestAsk: number;
}

export interface PolymarketSignal {
  marketId: string;
  marketTitle: string;
  polymarketPrice: number;
  whaleImpliedPrice: number;
  convictionDirection: 'YES' | 'NO' | 'NEUTRAL';
  convictionStrength: number;
  topWhalePositions: WhalePosition[];
  depthImbalance: number;
  signalStrength: 'strong' | 'moderate' | 'weak';
  reasoning: string;
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  clobTokenIds: string;  // JSON array of [yesTokenId, noTokenId]
  liquidity: string;
  outcomePrices: string; // JSON array of [yesPrice, noPrice]
  volume: string;
  active: boolean;
  closed: boolean;
}

export interface RecentTrade {
  timestamp: number;
  maker: string;
  taker: string;
  makerAmount: number;
  takerAmount: number;
  tokenId: string;
}

// =============================================================================
// GRAPHQL QUERIES (VALIDATED WORKING)
// =============================================================================

/**
 * PnL Subgraph - Get large positions
 * Fields: user, tokenId, amount, avgPrice, realizedPnl, totalBought
 */
const USER_POSITIONS_QUERY = `
  query GetLargePositions($minAmount: BigInt!, $first: Int!) {
    userPositions(
      first: $first
      orderBy: amount
      orderDirection: desc
      where: { amount_gt: $minAmount }
    ) {
      id
      user
      tokenId
      amount
      avgPrice
      realizedPnl
      totalBought
    }
  }
`;

/**
 * PnL Subgraph - Get positions for a specific token
 */
const TOKEN_POSITIONS_QUERY = `
  query GetTokenPositions($tokenId: String!, $first: Int!) {
    userPositions(
      first: $first
      orderBy: amount
      orderDirection: desc
      where: { tokenId: $tokenId }
    ) {
      id
      user
      tokenId
      amount
      avgPrice
      realizedPnl
    }
  }
`;

/**
 * Orderbook Subgraph - Recent large trades
 * Fields: timestamp, maker, taker, makerAmountFilled, takerAmountFilled
 */
const RECENT_TRADES_QUERY = `
  query GetRecentTrades($minAmount: BigInt!, $first: Int!) {
    orderFilledEvents(
      first: $first
      orderBy: timestamp
      orderDirection: desc
      where: { makerAmountFilled_gt: $minAmount }
    ) {
      id
      timestamp
      maker
      taker
      makerAssetId
      takerAssetId
      makerAmountFilled
      takerAmountFilled
    }
  }
`;

// =============================================================================
// FETCHERS
// =============================================================================

/**
 * Execute GraphQL query against a subgraph
 */
async function querySubgraph<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      logger.error(`Subgraph query failed: ${response.status}`);
      return null;
    }

    const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (result.errors) {
      logger.error(`Subgraph errors: ${result.errors[0]?.message}`);
      return null;
    }

    return result.data ?? null;
  } catch (error) {
    logger.error(`Subgraph query error: ${error}`);
    return null;
  }
}

/**
 * Fetch active markets from Gamma API
 */
export async function fetchActiveMarkets(limit: number = 100): Promise<GammaMarket[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.gamma}/markets?limit=${limit}&active=true&closed=false`
    );

    if (!response.ok) {
      logger.error(`Gamma API error: ${response.status}`);
      return [];
    }

    const markets = await response.json() as GammaMarket[];
    logger.info(`Fetched ${markets.length} active markets from Gamma API`);
    return markets;
  } catch (error) {
    logger.error(`Gamma API fetch error: ${error}`);
    return [];
  }
}

/**
 * Convert Gamma market to standard Market format
 * Used for cross-platform matching with proper prices
 */
export function gammaToMarket(gamma: GammaMarket): import('../../types/index.js').Market {
  // Parse outcomePrices - it's a JSON string like "[\"0.5\", \"0.5\"]"
  let yesPrice = 0;
  try {
    const prices = JSON.parse(gamma.outcomePrices) as string[];
    yesPrice = prices[0] ? parseFloat(prices[0]) : 0;
  } catch {
    // Fallback if parsing fails
    yesPrice = 0;
  }

  // Parse token IDs
  let tokenId: string | undefined;
  try {
    const tokens = JSON.parse(gamma.clobTokenIds) as string[];
    tokenId = tokens[0];
  } catch {
    // Ignore
  }

  return {
    platform: 'polymarket' as const,
    id: gamma.id,
    title: gamma.question,
    category: 'other',
    price: yesPrice,
    volume: parseFloat(gamma.volume) || 0,
    liquidity: parseFloat(gamma.liquidity) || 0,
    url: `https://polymarket.com/event/${gamma.conditionId}`,
    tokenId,
  };
}

/**
 * Fetch Polymarket markets with prices via Gamma API
 * Use this instead of dr-manhattan for reliable price data
 */
export async function fetchPolymarketMarketsWithPrices(limit: number = 200): Promise<import('../../types/index.js').Market[]> {
  const gammaMarkets = await fetchActiveMarkets(limit);
  const markets = gammaMarkets
    .filter(m => m.active && !m.closed)
    .map(gammaToMarket)
    .filter(m => m.price > 0 && m.price < 1);  // Filter out invalid prices

  logger.info(`Converted ${markets.length} Gamma markets with valid prices`);
  return markets;
}

/**
 * Fetch large positions across all markets from PnL subgraph
 * This is the PRIMARY source for whale data
 */
export async function fetchLargePositions(
  minSize: number = WHALE_POSITION_THRESHOLD,
  limit: number = 100
): Promise<WhalePosition[]> {
  // Convert to subgraph units (USDC has 6 decimals in contracts)
  const minAmount = (minSize * 1_000_000).toString();

  const data = await querySubgraph<{
    userPositions: Array<{
      id: string;
      user: string;
      tokenId: string;
      amount: string;
      avgPrice: string;
      realizedPnl: string;
      totalBought: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.pnl,
    USER_POSITIONS_QUERY,
    { minAmount, first: limit }
  );

  if (!data?.userPositions) {
    logger.warn('No positions data returned from PnL subgraph');
    return [];
  }

  // We need market context to determine YES/NO - will be enriched later
  return data.userPositions.map(p => ({
    wallet: p.user,
    marketId: '', // Will be populated when cross-referenced with Gamma
    marketTitle: '',
    outcome: 'YES' as const, // Will be determined by tokenId matching
    size: parseInt(p.amount) / 1_000_000,
    avgPrice: parseInt(p.avgPrice) / 1_000_000,
    currentPrice: 0,
    unrealizedPnl: 0,
    conviction: 0,
    timestamp: '',
    _tokenId: p.tokenId, // Keep for matching
  })) as (WhalePosition & { _tokenId: string })[];
}

/**
 * Fetch positions for a specific market token
 */
export async function fetchMarketPositions(
  tokenId: string,
  limit: number = 50
): Promise<WhalePosition[]> {
  const data = await querySubgraph<{
    userPositions: Array<{
      id: string;
      user: string;
      tokenId: string;
      amount: string;
      avgPrice: string;
      realizedPnl: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.pnl,
    TOKEN_POSITIONS_QUERY,
    { tokenId, first: limit }
  );

  if (!data?.userPositions) return [];

  return data.userPositions.map(p => ({
    wallet: p.user,
    marketId: '',
    marketTitle: '',
    outcome: 'YES' as const, // Caller knows which token this is
    size: parseInt(p.amount) / 1_000_000,
    avgPrice: parseInt(p.avgPrice) / 1_000_000,
    currentPrice: 0,
    unrealizedPnl: parseInt(p.realizedPnl) / 1_000_000,
    conviction: 0,
    timestamp: '',
  }));
}

/**
 * Fetch order book depth from CLOB API
 */
export async function fetchOrderbookDepth(tokenId: string): Promise<OrderbookDepth | null> {
  try {
    const response = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);

    if (!response.ok) {
      logger.error(`CLOB API error: ${response.status}`);
      return null;
    }

    const book = await response.json() as {
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    };

    const bids = book.bids || [];
    const asks = book.asks || [];

    const bidDepth = bids.reduce((sum, b) => sum + parseFloat(b.size), 0);
    const askDepth = asks.reduce((sum, a) => sum + parseFloat(a.size), 0);

    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 1;
    const spread = bestAsk - bestBid;

    return {
      marketId: tokenId,
      bestBid,
      bestAsk,
      spread,
      spreadPercent: spread / ((bestBid + bestAsk) / 2) * 100,
      bidDepth,
      askDepth,
      depthImbalance: bidDepth + askDepth > 0
        ? (bidDepth - askDepth) / (bidDepth + askDepth)
        : 0,
      largestBid: bids.length > 0 ? Math.max(...bids.map(b => parseFloat(b.size))) : 0,
      largestAsk: asks.length > 0 ? Math.max(...asks.map(a => parseFloat(a.size))) : 0,
    };
  } catch (error) {
    logger.error(`CLOB API error: ${error}`);
    return null;
  }
}

/**
 * Fetch recent large trades from Orderbook subgraph
 */
export async function fetchRecentTrades(
  minSize: number = 100,
  limit: number = 50
): Promise<RecentTrade[]> {
  const minAmount = (minSize * 1_000_000).toString();

  const data = await querySubgraph<{
    orderFilledEvents: Array<{
      timestamp: string;
      maker: string;
      taker: string;
      makerAssetId: string;
      takerAssetId: string;
      makerAmountFilled: string;
      takerAmountFilled: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.orderbook,
    RECENT_TRADES_QUERY,
    { minAmount, first: limit }
  );

  if (!data?.orderFilledEvents) return [];

  return data.orderFilledEvents.map(t => ({
    timestamp: parseInt(t.timestamp),
    maker: t.maker,
    taker: t.taker,
    makerAmount: parseInt(t.makerAmountFilled) / 1_000_000,
    takerAmount: parseInt(t.takerAmountFilled) / 1_000_000,
    tokenId: t.takerAssetId !== '0' ? t.takerAssetId : t.makerAssetId,
  }));
}

/**
 * Calculate whale conviction for a market
 * Uses Gamma API for market info + PnL subgraph for positions
 */
export async function analyzeMarketConviction(
  market: GammaMarket
): Promise<MarketConviction | null> {
  try {
    // Parse token IDs from Gamma market
    const tokenIds = JSON.parse(market.clobTokenIds || '[]') as string[];
    if (tokenIds.length < 2) {
      logger.warn(`Market ${market.id} missing token IDs`);
      return null;
    }

    const [yesTokenId, noTokenId] = tokenIds;

    // Fetch positions for both outcomes
    const [yesPositions, noPositions] = await Promise.all([
      fetchMarketPositions(yesTokenId),
      fetchMarketPositions(noTokenId),
    ]);

    // Parse current prices
    const prices = JSON.parse(market.outcomePrices || '[0.5, 0.5]') as number[];
    const currentPrice = prices[0] || 0.5;

    // Calculate volumes
    const totalYesVolume = yesPositions.reduce((sum, p) => sum + p.size, 0);
    const totalNoVolume = noPositions.reduce((sum, p) => sum + p.size, 0);

    // Whale positions (above threshold)
    const whaleYes = yesPositions.filter(p => p.size >= WHALE_POSITION_THRESHOLD);
    const whaleNo = noPositions.filter(p => p.size >= WHALE_POSITION_THRESHOLD);
    const whaleYesVolume = whaleYes.reduce((sum, p) => sum + p.size, 0);
    const whaleNoVolume = whaleNo.reduce((sum, p) => sum + p.size, 0);

    // Calculate conviction
    const totalWhaleVolume = whaleYesVolume + whaleNoVolume;
    let whaleConviction: 'YES' | 'NO' | 'NEUTRAL' = 'NEUTRAL';
    let convictionStrength = 0;

    if (totalWhaleVolume > 0) {
      const yesPercent = whaleYesVolume / totalWhaleVolume;
      const noPercent = whaleNoVolume / totalWhaleVolume;

      if (yesPercent >= WHALE_CONVICTION_THRESHOLD) {
        whaleConviction = 'YES';
        convictionStrength = yesPercent;
      } else if (noPercent >= WHALE_CONVICTION_THRESHOLD) {
        whaleConviction = 'NO';
        convictionStrength = noPercent;
      } else {
        convictionStrength = Math.abs(yesPercent - noPercent);
      }
    }

    // Enrich positions with market info
    const enrichedYes = whaleYes.map(p => ({
      ...p,
      marketId: market.id,
      marketTitle: market.question,
      outcome: 'YES' as const,
      currentPrice,
    }));

    const enrichedNo = whaleNo.map(p => ({
      ...p,
      marketId: market.id,
      marketTitle: market.question,
      outcome: 'NO' as const,
      currentPrice: 1 - currentPrice,
    }));

    // Top whales (combine YES and NO, sort by size)
    const topWhales = [...enrichedYes, ...enrichedNo]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    // Whale-implied probability
    const impliedProbFromWhales = totalWhaleVolume > 0
      ? whaleYesVolume / totalWhaleVolume
      : currentPrice;

    return {
      marketId: market.id,
      marketTitle: market.question,
      totalYesVolume,
      totalNoVolume,
      whaleYesVolume,
      whaleNoVolume,
      whaleConviction,
      convictionStrength,
      topWhales,
      currentPrice,
      impliedProbFromWhales,
    };
  } catch (error) {
    logger.error(`Error analyzing market ${market.id}: ${error}`);
    return null;
  }
}

/**
 * Find markets with strong whale conviction that diverges from price
 * This is the MAIN entry point for edge detection
 */
export async function findWhaleConvictionSignals(
  minConvictionStrength: number = 0.6,
  minLiquidity: number = 10000
): Promise<PolymarketSignal[]> {
  const signals: PolymarketSignal[] = [];

  // Get active markets from Gamma API
  const markets = await fetchActiveMarkets(200);

  // Filter by liquidity
  const liquidMarkets = markets.filter(m =>
    parseFloat(m.liquidity || '0') >= minLiquidity
  );

  logger.info(`Analyzing ${liquidMarkets.length} liquid markets for whale conviction`);

  // Analyze top markets by liquidity
  const sortedMarkets = liquidMarkets
    .sort((a, b) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
    .slice(0, 50);

  for (const market of sortedMarkets) {
    try {
      const conviction = await analyzeMarketConviction(market);

      if (!conviction) continue;

      // Skip if no strong conviction
      if (conviction.convictionStrength < minConvictionStrength) continue;

      // Calculate divergence between whale implied price and market price
      const divergence = Math.abs(conviction.impliedProbFromWhales - conviction.currentPrice);

      // Skip if whales agree with market
      if (divergence < 0.05) continue;

      // Determine signal strength
      let signalStrength: 'strong' | 'moderate' | 'weak' = 'weak';
      if (conviction.convictionStrength >= 0.8 && divergence >= 0.15) {
        signalStrength = 'strong';
      } else if (conviction.convictionStrength >= 0.7 && divergence >= 0.10) {
        signalStrength = 'moderate';
      }

      // Get orderbook depth for additional signal
      const tokenIds = JSON.parse(market.clobTokenIds || '[]') as string[];
      const depth = tokenIds[0] ? await fetchOrderbookDepth(tokenIds[0]) : null;
      const depthImbalance = depth?.depthImbalance ?? 0;

      const reasoning = buildConvictionReasoning(conviction, depth);

      signals.push({
        marketId: market.id,
        marketTitle: market.question,
        polymarketPrice: conviction.currentPrice,
        whaleImpliedPrice: conviction.impliedProbFromWhales,
        convictionDirection: conviction.whaleConviction,
        convictionStrength: conviction.convictionStrength,
        topWhalePositions: conviction.topWhales,
        depthImbalance,
        signalStrength,
        reasoning,
      });
    } catch (error) {
      logger.error(`Error analyzing market ${market.id}: ${error}`);
    }
  }

  // Sort by signal strength and conviction
  signals.sort((a, b) => {
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    const strengthDiff = strengthOrder[b.signalStrength] - strengthOrder[a.signalStrength];
    if (strengthDiff !== 0) return strengthDiff;
    return b.convictionStrength - a.convictionStrength;
  });

  logger.info(`Found ${signals.length} whale conviction signals`);
  return signals;
}

/**
 * Build human-readable reasoning for a conviction signal
 */
function buildConvictionReasoning(
  conviction: MarketConviction,
  depth: OrderbookDepth | null
): string {
  const parts: string[] = [];

  // Whale conviction
  const convPct = (conviction.convictionStrength * 100).toFixed(0);
  const impliedPct = (conviction.impliedProbFromWhales * 100).toFixed(0);
  const marketPct = (conviction.currentPrice * 100).toFixed(0);

  parts.push(
    `Whales ${convPct}% ${conviction.whaleConviction} (implied: ${impliedPct}% vs market: ${marketPct}%)`
  );

  // Volume breakdown
  const whaleTotal = conviction.whaleYesVolume + conviction.whaleNoVolume;
  if (whaleTotal > 0) {
    parts.push(
      `Whale volume: $${(whaleTotal / 1000).toFixed(0)}K ` +
      `(YES: $${(conviction.whaleYesVolume / 1000).toFixed(0)}K, ` +
      `NO: $${(conviction.whaleNoVolume / 1000).toFixed(0)}K)`
    );
  }

  // Depth imbalance
  if (depth && Math.abs(depth.depthImbalance) > 0.2) {
    const side = depth.depthImbalance > 0 ? 'bid' : 'ask';
    parts.push(`Order book ${side}-heavy (${(Math.abs(depth.depthImbalance) * 100).toFixed(0)}% imbalance)`);
  }

  return parts.join('. ');
}

/**
 * Format whale conviction report for Discord
 */
export function formatWhaleConvictionReport(signals: PolymarketSignal[]): string {
  if (signals.length === 0) {
    return 'No significant whale conviction signals found.';
  }

  const lines: string[] = [
    '**🐋 Polymarket Whale Conviction Signals**',
    '═══════════════════════════════════════════',
    '',
  ];

  for (const signal of signals.slice(0, 10)) {
    const strengthIcon = signal.signalStrength === 'strong' ? '🔴' :
                         signal.signalStrength === 'moderate' ? '🟡' : '🟢';
    const dirIcon = signal.convictionDirection === 'YES' ? '📈' : '📉';

    lines.push(`${strengthIcon}${dirIcon} **${signal.marketTitle.slice(0, 60)}**`);
    lines.push(`   Market: ${(signal.polymarketPrice * 100).toFixed(0)}% | Whale Implied: ${(signal.whaleImpliedPrice * 100).toFixed(0)}%`);
    lines.push(`   Conviction: ${(signal.convictionStrength * 100).toFixed(0)}% ${signal.convictionDirection}`);
    lines.push(`   ${signal.reasoning}`);
    lines.push('');
  }

  return lines.join('\n');
}
