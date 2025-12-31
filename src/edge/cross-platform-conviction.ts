/**
 * Cross-Platform Conviction Edge Detection
 *
 * CORE INSIGHT: Polymarket has transparent on-chain data showing whale positions
 * and conviction levels. Kalshi doesn't. We can see where smart money is positioned
 * on Polymarket and find mispricings on Kalshi.
 *
 * EXAMPLE:
 * - Polymarket: Whales have 80% of their capital on "Vivek wins Ohio Governor"
 * - Polymarket price: 45%
 * - Kalshi price: 38%
 * - Edge: Whales see something the market doesn't, Kalshi is even more mispriced
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Retail traders without on-chain visibility
 * - Why do they lose? They can't see whale positioning
 * - Our edge: Transparent blockchain data + cross-platform comparison
 */

import { logger } from '../utils/index.js';
import type { Market } from '../types/index.js';
import type { PolymarketSignal } from '../fetchers/polymarket-onchain.js';
import { findWhaleConvictionSignals } from '../fetchers/polymarket-onchain.js';
import { calculateTitleSimilarity } from '../analysis/cross-platform.js';
import { EDGE_THRESHOLDS } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface CrossPlatformConvictionEdge {
  // Market info
  kalshiMarket: Market;
  polymarketId: string;
  marketTitle: string;

  // Prices
  kalshiPrice: number;
  polymarketPrice: number;
  whaleImpliedPrice: number;

  // Conviction data
  whaleConviction: 'YES' | 'NO' | 'NEUTRAL';
  convictionStrength: number;
  topWhaleCount: number;

  // Edge calculation
  kalshiVsWhale: number;      // Whale implied - Kalshi price
  polyVsKalshi: number;       // Poly price - Kalshi price
  edge: number;               // Absolute edge value
  direction: 'buy_yes' | 'buy_no';

  // Confidence
  confidence: number;
  signalStrength: 'strong' | 'moderate' | 'weak';
  urgency: 'critical' | 'standard' | 'fyi';

  // Reasoning
  reasoning: string;
}

// =============================================================================
// MATCHING
// =============================================================================

/**
 * Find matching Kalshi market for a Polymarket signal
 */
function findMatchingKalshiMarket(
  polySignal: PolymarketSignal,
  kalshiMarkets: Market[]
): Market | null {
  let bestMatch: Market | null = null;
  let bestSimilarity = 0.5; // Minimum threshold

  for (const kalshi of kalshiMarkets) {
    if (!kalshi.title) continue;

    const similarity = calculateTitleSimilarity(
      polySignal.marketTitle,
      kalshi.title
    );

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = kalshi;
    }
  }

  return bestMatch;
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Find cross-platform conviction edges
 *
 * This is the main function that:
 * 1. Gets whale conviction signals from Polymarket (via Gamma API + PnL subgraph)
 * 2. Matches them to Kalshi markets by title similarity
 * 3. Calculates edge based on whale implied price vs Kalshi price
 */
export async function findCrossPlatformConvictionEdges(
  kalshiMarkets: Market[],
  _polymarketMarkets: Market[], // Kept for API compatibility, but we now use Gamma API internally
  minConviction: number = 0.6
): Promise<CrossPlatformConvictionEdge[]> {
  const edges: CrossPlatformConvictionEdge[] = [];

  // Get whale conviction signals from Polymarket
  // This now fetches active markets from Gamma API and analyzes positions from PnL subgraph
  const convictionSignals = await findWhaleConvictionSignals(
    minConviction,
    10000 // minLiquidity
  );

  logger.info(`Analyzing ${convictionSignals.length} whale conviction signals for cross-platform edges`);

  for (const signal of convictionSignals) {
    // Find matching Kalshi market
    const kalshiMatch = findMatchingKalshiMarket(signal, kalshiMarkets);
    if (!kalshiMatch) continue;

    // Calculate edges
    const kalshiPrice = kalshiMatch.price;
    const polyPrice = signal.polymarketPrice;
    const whaleImplied = signal.whaleImpliedPrice;

    // The edge is: what whales think - what Kalshi prices
    const kalshiVsWhale = whaleImplied - kalshiPrice;
    const polyVsKalshi = polyPrice - kalshiPrice;

    // Direction: if whales think higher prob, buy YES on Kalshi
    const direction: 'buy_yes' | 'buy_no' = kalshiVsWhale > 0 ? 'buy_yes' : 'buy_no';
    const edge = Math.abs(kalshiVsWhale);

    // Skip if edge is too small
    if (edge < EDGE_THRESHOLDS.minimum) continue;

    // Calculate confidence based on conviction strength and edge size
    let confidence = 0.5;
    if (signal.convictionStrength >= 0.8) confidence += 0.15;
    if (signal.convictionStrength >= 0.9) confidence += 0.10;
    if (edge >= 0.10) confidence += 0.10;
    if (signal.topWhalePositions.length >= 5) confidence += 0.05;
    confidence = Math.min(confidence, 0.90);

    // Determine urgency
    let urgency: 'critical' | 'standard' | 'fyi' = 'fyi';
    if (edge >= EDGE_THRESHOLDS.critical && confidence >= 0.7) {
      urgency = 'critical';
    } else if (edge >= EDGE_THRESHOLDS.actionable) {
      urgency = 'standard';
    }

    // Build reasoning
    const reasoning = buildEdgeReasoning(
      signal,
      kalshiPrice,
      polyPrice,
      whaleImplied,
      kalshiMatch.title ?? ''
    );

    edges.push({
      kalshiMarket: kalshiMatch,
      polymarketId: signal.marketId,
      marketTitle: kalshiMatch.title ?? signal.marketTitle,

      kalshiPrice,
      polymarketPrice: polyPrice,
      whaleImpliedPrice: whaleImplied,

      whaleConviction: signal.convictionDirection,
      convictionStrength: signal.convictionStrength,
      topWhaleCount: signal.topWhalePositions.length,

      kalshiVsWhale,
      polyVsKalshi,
      edge,
      direction,

      confidence,
      signalStrength: signal.signalStrength,
      urgency,

      reasoning,
    });
  }

  // Sort by edge magnitude
  edges.sort((a, b) => b.edge - a.edge);

  logger.info(`Found ${edges.length} cross-platform conviction edges`);
  return edges;
}

/**
 * Build human-readable reasoning
 */
function buildEdgeReasoning(
  signal: PolymarketSignal,
  kalshiPrice: number,
  polyPrice: number,
  whaleImplied: number,
  marketTitle: string
): string {
  const parts: string[] = [];

  // Market summary
  parts.push(`"${marketTitle.slice(0, 50)}..."`);

  // Price comparison
  const kPct = (kalshiPrice * 100).toFixed(0);
  const pPct = (polyPrice * 100).toFixed(0);
  const wPct = (whaleImplied * 100).toFixed(0);

  parts.push(`Kalshi: ${kPct}% | Poly: ${pPct}% | Whale Implied: ${wPct}%`);

  // Whale conviction
  const convPct = (signal.convictionStrength * 100).toFixed(0);
  parts.push(
    `${signal.topWhalePositions.length} whales ${convPct}% ${signal.convictionDirection}`
  );

  // Edge explanation
  const edge = Math.abs(whaleImplied - kalshiPrice);
  const edgePct = (edge * 100).toFixed(1);
  const side = whaleImplied > kalshiPrice ? 'underpriced' : 'overpriced';
  parts.push(`Kalshi ${side} by ${edgePct}% vs whale consensus`);

  return parts.join(' | ');
}

// Note: CrossPlatformConvictionEdge is used directly in pipeline
// No need for MacroEdgeSignal conversion since it's a different signal type

/**
 * Format report for Discord
 */
export function formatCrossPlatformConvictionReport(
  edges: CrossPlatformConvictionEdge[]
): string {
  if (edges.length === 0) {
    return 'No cross-platform conviction edges found.';
  }

  const lines: string[] = [
    '**🐋📊 Cross-Platform Whale Conviction Edges**',
    '═══════════════════════════════════════════════',
    '',
    '*Comparing Polymarket whale positions to Kalshi prices*',
    '',
  ];

  // Group by urgency
  const critical = edges.filter(e => e.urgency === 'critical');
  const standard = edges.filter(e => e.urgency === 'standard');
  const fyi = edges.filter(e => e.urgency === 'fyi');

  if (critical.length > 0) {
    lines.push('**🔴 CRITICAL EDGES**');
    for (const edge of critical.slice(0, 3)) {
      lines.push(formatEdgeLine(edge));
    }
    lines.push('');
  }

  if (standard.length > 0) {
    lines.push('**🟡 ACTIONABLE EDGES**');
    for (const edge of standard.slice(0, 5)) {
      lines.push(formatEdgeLine(edge));
    }
    lines.push('');
  }

  if (fyi.length > 0 && critical.length === 0 && standard.length === 0) {
    lines.push('**🟢 WATCHLIST**');
    for (const edge of fyi.slice(0, 5)) {
      lines.push(formatEdgeLine(edge));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatEdgeLine(edge: CrossPlatformConvictionEdge): string {
  const dirIcon = edge.direction === 'buy_yes' ? '📈' : '📉';
  const edgePct = (edge.edge * 100).toFixed(1);
  const convPct = (edge.convictionStrength * 100).toFixed(0);

  return [
    `${dirIcon} **${edge.marketTitle.slice(0, 50)}**`,
    `   K: ${(edge.kalshiPrice * 100).toFixed(0)}% → Whale: ${(edge.whaleImpliedPrice * 100).toFixed(0)}% (${edgePct}% edge)`,
    `   ${edge.topWhaleCount} whales @ ${convPct}% ${edge.whaleConviction}`,
    `   [Kalshi](${edge.kalshiMarket.url})`,
    '',
  ].join('\n');
}
