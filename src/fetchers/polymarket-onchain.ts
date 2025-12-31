/**
 * Polymarket On-Chain Data Fetcher
 *
 * Fetches whale positions, order book depth, and conviction data
 * from Polymarket's Goldsky subgraphs (FREE, real-time data).
 *
 * EDGE SOURCE: Polymarket has transparent on-chain data that Kalshi lacks.
 * We can see:
 * - Which whales are positioned in which direction
 * - How concentrated their positions are (conviction %)
 * - Large order flow and depth imbalances
 * - Open interest trends
 *
 * Then apply this intelligence to find mispricings on Kalshi.
 */

import { logger } from '../utils/index.js';
import { POLYMARKET_SUBGRAPHS, POLYMARKET_API, WHALE_POSITION_THRESHOLD, WHALE_CONVICTION_THRESHOLD } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WhalePosition {
  wallet: string;
  marketId: string;
  marketTitle: string;
  outcome: 'YES' | 'NO';
  size: number;           // Position size in USDC
  avgPrice: number;       // Average entry price
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

// =============================================================================
// GRAPHQL QUERIES
// =============================================================================

const POSITIONS_QUERY = `
  query GetLargePositions($minSize: BigDecimal!, $first: Int!) {
    positions(
      first: $first
      orderBy: currentValue
      orderDirection: desc
      where: { currentValue_gte: $minSize }
    ) {
      id
      user {
        id
      }
      market {
        id
        question
      }
      outcome
      shares
      avgPrice
      currentValue
      realizedPnl
      createdAt
      updatedAt
    }
  }
`;

const MARKET_POSITIONS_QUERY = `
  query GetMarketPositions($marketId: String!, $first: Int!) {
    positions(
      first: $first
      orderBy: currentValue
      orderDirection: desc
      where: { market: $marketId }
    ) {
      id
      user {
        id
      }
      outcome
      shares
      avgPrice
      currentValue
      realizedPnl
    }
  }
`;

const ORDERBOOK_QUERY = `
  query GetOrderbook($marketId: String!) {
    orderbooks(where: { market: $marketId }) {
      id
      market {
        id
      }
      currentSpread
      currentSpreadPercentage
      totalBidDepth
      totalAskDepth
      lastTradePrice
      timestamp
    }
  }
`;

const OPEN_INTEREST_QUERY = `
  query GetOpenInterest($marketId: String!) {
    openInterests(where: { market: $marketId }) {
      id
      market {
        id
      }
      totalOpenInterest
      yesOpenInterest
      noOpenInterest
      timestamp
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
      logger.error(`Subgraph errors: ${JSON.stringify(result.errors)}`);
      return null;
    }

    return result.data ?? null;
  } catch (error) {
    logger.error(`Subgraph query error: ${error}`);
    return null;
  }
}

/**
 * Fetch large positions across all markets
 */
export async function fetchLargePositions(
  minSize: number = WHALE_POSITION_THRESHOLD,
  limit: number = 100
): Promise<WhalePosition[]> {
  const data = await querySubgraph<{
    positions: Array<{
      id: string;
      user: { id: string };
      market: { id: string; question: string };
      outcome: string;
      shares: string;
      avgPrice: string;
      currentValue: string;
      realizedPnl: string;
      updatedAt: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.positions,
    POSITIONS_QUERY,
    { minSize: minSize.toString(), first: limit }
  );

  if (!data?.positions) {
    logger.warn('No positions data returned from subgraph');
    return [];
  }

  return data.positions.map(p => ({
    wallet: p.user.id,
    marketId: p.market.id,
    marketTitle: p.market.question,
    outcome: p.outcome.toUpperCase() as 'YES' | 'NO',
    size: parseFloat(p.currentValue),
    avgPrice: parseFloat(p.avgPrice),
    currentPrice: 0, // Will be filled from market data
    unrealizedPnl: 0, // Calculate separately
    conviction: 0, // Calculate separately based on total portfolio
    timestamp: p.updatedAt,
  }));
}

/**
 * Fetch positions for a specific market
 */
export async function fetchMarketPositions(
  marketId: string,
  limit: number = 50
): Promise<WhalePosition[]> {
  const data = await querySubgraph<{
    positions: Array<{
      id: string;
      user: { id: string };
      outcome: string;
      shares: string;
      avgPrice: string;
      currentValue: string;
      realizedPnl: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.positions,
    MARKET_POSITIONS_QUERY,
    { marketId, first: limit }
  );

  if (!data?.positions) return [];

  return data.positions.map(p => ({
    wallet: p.user.id,
    marketId,
    marketTitle: '',
    outcome: p.outcome.toUpperCase() as 'YES' | 'NO',
    size: parseFloat(p.currentValue),
    avgPrice: parseFloat(p.avgPrice),
    currentPrice: 0,
    unrealizedPnl: parseFloat(p.realizedPnl),
    conviction: 0,
    timestamp: '',
  }));
}

/**
 * Fetch orderbook depth for a market
 */
export async function fetchOrderbookDepth(marketId: string): Promise<OrderbookDepth | null> {
  const data = await querySubgraph<{
    orderbooks: Array<{
      id: string;
      currentSpread: string;
      currentSpreadPercentage: string;
      totalBidDepth: string;
      totalAskDepth: string;
      lastTradePrice: string;
    }>;
  }>(
    POLYMARKET_SUBGRAPHS.orderbook,
    ORDERBOOK_QUERY,
    { marketId }
  );

  if (!data?.orderbooks?.[0]) return null;

  const ob = data.orderbooks[0];
  const bidDepth = parseFloat(ob.totalBidDepth);
  const askDepth = parseFloat(ob.totalAskDepth);
  const spread = parseFloat(ob.currentSpread);
  const lastPrice = parseFloat(ob.lastTradePrice);

  return {
    marketId,
    bestBid: lastPrice - spread / 2,
    bestAsk: lastPrice + spread / 2,
    spread,
    spreadPercent: parseFloat(ob.currentSpreadPercentage),
    bidDepth,
    askDepth,
    depthImbalance: bidDepth + askDepth > 0
      ? (bidDepth - askDepth) / (bidDepth + askDepth)
      : 0,
    largestBid: 0, // Would need separate query
    largestAsk: 0,
  };
}

/**
 * Fetch top traders from Polymarket leaderboard
 */
export async function fetchLeaderboard(
  period: '1d' | '7d' | '30d' | 'all' = '30d',
  limit: number = 100
): Promise<Array<{
  wallet: string;
  profit: number;
  volume: number;
  winRate: number;
  rank: number;
}>> {
  try {
    // Use Polymarket's data API for leaderboard
    const response = await fetch(
      `${POLYMARKET_API.base}/leaderboard?window=${period}&limit=${limit}`
    );

    if (!response.ok) {
      logger.error(`Leaderboard fetch failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as Array<{
      user: string;
      profit: number;
      volume: number;
      numTrades: number;
      wins: number;
    }>;

    return data.map((d, i) => ({
      wallet: d.user,
      profit: d.profit,
      volume: d.volume,
      winRate: d.numTrades > 0 ? d.wins / d.numTrades : 0,
      rank: i + 1,
    }));
  } catch (error) {
    logger.error(`Leaderboard fetch error: ${error}`);
    return [];
  }
}

/**
 * Calculate whale conviction for a market
 */
export async function analyzeMarketConviction(
  marketId: string,
  marketTitle: string,
  currentPrice: number
): Promise<MarketConviction> {
  const positions = await fetchMarketPositions(marketId);

  // Separate by outcome
  const yesPositions = positions.filter(p => p.outcome === 'YES');
  const noPositions = positions.filter(p => p.outcome === 'NO');

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

  // Top whales (combine YES and NO, sort by size)
  const topWhales = [...whaleYes, ...whaleNo]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  // Whale-implied probability
  const impliedProbFromWhales = totalWhaleVolume > 0
    ? whaleYesVolume / totalWhaleVolume
    : currentPrice;

  return {
    marketId,
    marketTitle,
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
}

/**
 * Find markets with strong whale conviction that diverges from price
 */
export async function findWhaleConvictionSignals(
  markets: Array<{ id: string; title: string; price: number }>,
  minConvictionStrength: number = 0.6
): Promise<PolymarketSignal[]> {
  const signals: PolymarketSignal[] = [];

  for (const market of markets) {
    try {
      const conviction = await analyzeMarketConviction(
        market.id,
        market.title,
        market.price
      );

      // Skip if no strong conviction
      if (conviction.convictionStrength < minConvictionStrength) continue;

      // Calculate divergence between whale implied price and market price
      const divergence = Math.abs(conviction.impliedProbFromWhales - market.price);

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
      const depth = await fetchOrderbookDepth(market.id);
      const depthImbalance = depth?.depthImbalance ?? 0;

      const reasoning = buildConvictionReasoning(conviction, market.price, depth);

      signals.push({
        marketId: market.id,
        marketTitle: market.title,
        polymarketPrice: market.price,
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
  marketPrice: number,
  depth: OrderbookDepth | null
): string {
  const parts: string[] = [];

  // Whale conviction
  const convPct = (conviction.convictionStrength * 100).toFixed(0);
  const impliedPct = (conviction.impliedProbFromWhales * 100).toFixed(0);
  const marketPct = (marketPrice * 100).toFixed(0);

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
