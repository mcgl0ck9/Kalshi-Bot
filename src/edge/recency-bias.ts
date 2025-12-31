/**
 * Recency Bias / Base Rate Neglect Detection
 *
 * QUANT INSIGHT: Markets systematically overreact to recent events
 *
 * ACADEMIC BACKING:
 * - Kahneman & Tversky (1973): Base rate neglect in probability estimation
 * - Tetlock (2015): Superforecasters anchor on base rates, then adjust incrementally
 * - Snowberg et al. (2007): Prediction market prices revert after sharp moves
 * - Bordalo et al. (2012): Diagnostic expectations cause overweighting of salient events
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Narrative traders, news-reactive retail, momentum followers
 * - Why do they lose? Build stories around recent events, ignore statistical reversion
 * - Our edge: Base rate anchoring + optimal Bayesian updating
 *
 * IMPLEMENTATION:
 * 1. Detect markets with large recent price moves
 * 2. Calculate base rate from historical data
 * 3. Estimate optimal Bayesian update from new information
 * 4. If market moved more than optimal, fade toward base rate
 */

import { logger } from '../utils/index.js';
import type { Market, MacroEdgeSignal } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface PriceHistory {
  timestamp: Date;
  price: number;
}

export interface RecencyBiasSignal {
  market: Market;
  category: string;
  currentPrice: number;
  priorPrice: number;            // Price before the move
  priceMove: number;             // Current - Prior
  daysSinceMove: number;
  historicalBaseRate: number;    // Long-run probability
  optimalUpdate: number;         // What Bayesian update should be
  actualUpdate: number;          // What actually happened
  overreactionFactor: number;    // actualUpdate / optimalUpdate (>1 = overreaction)
  adjustedProbability: number;   // Where price should be
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
}

// =============================================================================
// HISTORICAL BASE RATES
// =============================================================================

// Base rates for various event types (from historical data)
// These represent long-run probabilities without recent event influence
const HISTORICAL_BASE_RATES: Record<string, Record<string, number>> = {
  // Federal Reserve
  fed: {
    'rate_cut_next_meeting': 0.25,       // Historical avg when not in crisis
    'rate_hike_next_meeting': 0.15,
    'rate_hold_next_meeting': 0.60,
    'emergency_cut': 0.02,                // Very rare
    '50bp_cut': 0.08,                     // Usually 25bp
  },

  // Economic
  macro: {
    'recession_next_year': 0.15,          // ~15% base rate any given year
    'soft_landing': 0.70,                 // Most expansions end softly
    'cpi_above_3': 0.25,                  // Post-COVID higher, historically lower
    'unemployment_above_5': 0.30,
  },

  // Political
  election: {
    'incumbent_wins': 0.70,               // Incumbents have advantage
    'party_flip_senate': 0.40,
    'party_flip_house': 0.45,
    'third_party_wins_state': 0.01,       // Extremely rare
  },

  // Tech/Crypto
  crypto: {
    'bitcoin_ath_this_year': 0.35,        // Roughly every 3 years historically
    'bitcoin_50pct_crash': 0.40,          // Happens fairly often
    'eth_flippening': 0.10,               // Never happened
  },

  // Geopolitical
  geopolitics: {
    'war_escalation': 0.20,               // Once started, often escalates
    'ceasefire': 0.30,                    // Wars often see ceasefires
    'sanctions_increase': 0.60,           // More common than removal
  },

  // Sports (per game/event)
  sports: {
    'underdog_wins': 0.35,                // Upsets happen ~35% of time
    'blowout_game': 0.15,                 // 20+ point margins
    'overtime': 0.08,
  },
};

// How much price should optimally move for different types of news
// Based on Bayesian information value estimates
const OPTIMAL_UPDATE_FACTORS: Record<string, Record<string, number>> = {
  fed: {
    'fomc_minutes': 0.05,                 // Usually not surprising
    'cpi_release': 0.08,                  // Can move Fed expectations
    'jobs_report': 0.06,
    'fed_speech': 0.03,                   // Usually not market-moving
    'emergency_statement': 0.15,          // Rare, significant
  },

  macro: {
    'gdp_release': 0.05,
    'earnings_miss': 0.04,
    'bank_failure': 0.10,
    'default_risk': 0.12,
  },

  election: {
    'poll_release': 0.02,                 // Polls are noisy
    'debate': 0.03,                       // Rarely decisive
    'endorsement': 0.01,
    'scandal': 0.05,                      // Can move things
  },

  crypto: {
    'exchange_hack': 0.08,
    'etf_approval': 0.12,
    'regulatory_action': 0.10,
    'whale_movement': 0.02,               // Often noise
  },

  geopolitics: {
    'military_action': 0.10,
    'diplomatic_meeting': 0.03,
    'sanctions_news': 0.05,
  },
};

// =============================================================================
// RECENCY DETECTION
// =============================================================================

/**
 * Detect market category from title/metadata
 */
function detectMarketCategory(market: Market): string {
  const title = (market.title ?? '').toLowerCase();
  const category = (market.category ?? '').toLowerCase();

  if (title.includes('fed') || title.includes('fomc') || title.includes('rate')) {
    return 'fed';
  }
  if (title.includes('recession') || title.includes('gdp') || title.includes('cpi') ||
      title.includes('inflation') || title.includes('unemployment')) {
    return 'macro';
  }
  if (title.includes('election') || title.includes('president') || title.includes('senate') ||
      title.includes('congress') || title.includes('vote')) {
    return 'election';
  }
  if (title.includes('bitcoin') || title.includes('crypto') || title.includes('ethereum') ||
      title.includes('btc') || title.includes('eth')) {
    return 'crypto';
  }
  if (title.includes('war') || title.includes('russia') || title.includes('ukraine') ||
      title.includes('china') || title.includes('taiwan') || title.includes('sanctions')) {
    return 'geopolitics';
  }
  if (category === 'sports' || title.includes('nfl') || title.includes('nba') ||
      title.includes('win') || title.includes('championship')) {
    return 'sports';
  }

  return 'other';
}

/**
 * Get relevant base rate for a market
 */
function getBaseRate(market: Market, category: string): number | null {
  const title = (market.title ?? '').toLowerCase();
  const rates = HISTORICAL_BASE_RATES[category];

  if (!rates) return null;

  // Try to match specific rate
  for (const [key, rate] of Object.entries(rates)) {
    const keywords = key.split('_');
    if (keywords.every(kw => title.includes(kw))) {
      return rate;
    }
  }

  // Return category average if no specific match
  const values = Object.values(rates);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Estimate optimal Bayesian update for a news event
 */
function estimateOptimalUpdate(category: string, newsType?: string): number {
  const updates = OPTIMAL_UPDATE_FACTORS[category];

  if (updates && newsType) {
    for (const [key, update] of Object.entries(updates)) {
      if (newsType.toLowerCase().includes(key)) {
        return update;
      }
    }
  }

  // Default optimal update
  return 0.05;
}

// =============================================================================
// OVERREACTION DETECTION
// =============================================================================

/**
 * Analyze a market for recency bias / overreaction
 *
 * ADVERSARIAL LOGIC:
 * - When markets move sharply on news, they often overshoot
 * - Optimal response is smaller than emotional response
 * - Fade the overreaction toward base rate
 */
export function analyzeRecencyBias(
  market: Market,
  priorPrice: number,
  daysSinceMove: number = 1,
  newsType?: string
): RecencyBiasSignal | null {
  const category = detectMarketCategory(market);
  const baseRate = getBaseRate(market, category);

  if (baseRate === null) {
    return null;
  }

  const currentPrice = market.price;
  const priceMove = currentPrice - priorPrice;
  const absPriceMove = Math.abs(priceMove);

  // Only analyze if there was a significant move
  if (absPriceMove < 0.05) {
    return null;
  }

  // Estimate what the optimal update should have been
  const optimalUpdate = estimateOptimalUpdate(category, newsType);

  // Calculate overreaction factor
  const overreactionFactor = absPriceMove / optimalUpdate;

  // Only signal if overreaction is significant (>1.5x optimal)
  if (overreactionFactor < 1.5) {
    return null;
  }

  // Calculate adjusted probability
  // Blend current price with base rate, weighted by overreaction severity
  const reversion = Math.min(0.5, (overreactionFactor - 1) * 0.2);  // Max 50% reversion
  const adjustedProbability = currentPrice - (priceMove * reversion);

  const edge = adjustedProbability - currentPrice;

  // If overreaction was positive (price went up too much), sell
  // If overreaction was negative (price went down too much), buy
  const direction = edge > 0 ? 'buy_yes' : 'buy_no';

  // Confidence based on overreaction factor and days since move
  let confidence = 0.5;
  if (overreactionFactor > 2.0) confidence += 0.15;
  if (overreactionFactor > 3.0) confidence += 0.1;
  if (daysSinceMove <= 2) confidence += 0.1;  // More confident on fresh overreactions
  confidence = Math.min(confidence, 0.8);

  const reasoning = `Category: ${category}. ` +
    `Price moved ${(priceMove * 100).toFixed(1)}% in ${daysSinceMove}d. ` +
    `Optimal update: ${(optimalUpdate * 100).toFixed(1)}%. ` +
    `Overreaction: ${overreactionFactor.toFixed(1)}x. ` +
    `Base rate: ${(baseRate * 100).toFixed(0)}%. ` +
    `Fade ${(reversion * 100).toFixed(0)}% toward prior.`;

  return {
    market,
    category,
    currentPrice,
    priorPrice,
    priceMove,
    daysSinceMove,
    historicalBaseRate: baseRate,
    optimalUpdate,
    actualUpdate: absPriceMove,
    overreactionFactor,
    adjustedProbability,
    edge,
    direction,
    confidence,
    reasoning,
  };
}

/**
 * Batch analyze markets for recency bias
 * Requires price history or recent price data
 */
export function analyzeMarketsForRecencyBias(
  markets: Market[],
  priceHistory: Map<string, PriceHistory[]>,
  minEdge: number = 0.04
): RecencyBiasSignal[] {
  const signals: RecencyBiasSignal[] = [];

  for (const market of markets) {
    const history = priceHistory.get(market.id);

    if (!history || history.length < 2) {
      continue;
    }

    // Get price from 24-48 hours ago
    const now = new Date();
    const recentHistory = history.filter(h => {
      const hoursAgo = (now.getTime() - h.timestamp.getTime()) / (1000 * 60 * 60);
      return hoursAgo >= 24 && hoursAgo <= 72;
    });

    if (recentHistory.length === 0) {
      continue;
    }

    // Use oldest price in window as "prior"
    const priorEntry = recentHistory[recentHistory.length - 1];
    const daysSinceMove = Math.round(
      (now.getTime() - priorEntry.timestamp.getTime()) / (1000 * 60 * 60 * 24)
    );

    const signal = analyzeRecencyBias(market, priorEntry.price, daysSinceMove);

    if (signal && Math.abs(signal.edge) >= minEdge) {
      signals.push(signal);
    }
  }

  // Sort by overreaction factor (strongest overreactions first)
  signals.sort((a, b) => b.overreactionFactor - a.overreactionFactor);

  if (signals.length > 0) {
    logger.info(`Found ${signals.length} recency bias signals`);
  }

  return signals;
}

/**
 * Simple version: analyze without full price history
 * Uses current price and estimates prior from category base rate
 */
export function analyzeMarketsForRecencyBiasSimple(
  markets: Market[],
  minEdge: number = 0.05
): RecencyBiasSignal[] {
  const signals: RecencyBiasSignal[] = [];

  for (const market of markets) {
    const category = detectMarketCategory(market);
    const baseRate = getBaseRate(market, category);

    if (baseRate === null) continue;

    // Estimate if price has deviated significantly from base rate
    const deviation = market.price - baseRate;
    const absDeviation = Math.abs(deviation);

    // Only flag large deviations
    if (absDeviation < 0.15) continue;

    // Assume deviation happened recently (conservative)
    const signal = analyzeRecencyBias(market, baseRate, 3);

    if (signal && Math.abs(signal.edge) >= minEdge) {
      signals.push(signal);
    }
  }

  signals.sort((a, b) => b.overreactionFactor - a.overreactionFactor);

  return signals;
}

/**
 * Convert RecencyBiasSignal to MacroEdgeSignal for unified handling
 */
export function recencyBiasToMacroEdgeSignal(signal: RecencyBiasSignal): MacroEdgeSignal {
  // Map category to indicator type (use 'fed' as default for macro categories)
  const indicatorType = signal.category === 'fed' ? 'fed' :
    signal.category === 'macro' ? 'gdp' : 'fed';

  return {
    marketId: signal.market.id,
    marketTitle: signal.market.title ?? '',
    marketPlatform: signal.market.platform,
    marketPrice: signal.currentPrice,
    marketUrl: signal.market.url,
    indicatorType,
    indicatorName: `Recency Bias (${signal.category})`,
    indicatorValue: signal.adjustedProbability,
    indicatorSource: 'Base Rate Analysis',
    impliedProbability: signal.adjustedProbability,
    edge: signal.edge,
    edgePercent: signal.edge * 100,
    confidence: signal.confidence,
    signalStrength: signal.overreactionFactor > 2.5 ? 'strong' :
      signal.overreactionFactor > 1.8 ? 'moderate' : 'weak',
    direction: signal.direction,
    reasoning: signal.reasoning,
    maxLoss: signal.direction === 'buy_yes' ? signal.currentPrice : (1 - signal.currentPrice),
    expectedValue: signal.edge * signal.confidence,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Format recency bias report
 */
export function formatRecencyBiasReport(signals: RecencyBiasSignal[]): string {
  if (signals.length === 0) {
    return 'No recency bias signals detected.';
  }

  const lines: string[] = [
    '**🎯 Recency Bias / Overreaction Analysis**',
    '══════════════════════════════════════════════',
    '',
    '*Markets that moved more than optimal Bayesian update*',
    '',
  ];

  for (const signal of signals.slice(0, 5)) {
    const dirIcon = signal.direction === 'buy_yes' ? '📈' : '📉';
    const heat = signal.overreactionFactor > 2.5 ? '🔥' :
      signal.overreactionFactor > 2.0 ? '⚡' : '💡';

    lines.push(`${dirIcon} ${heat} **${signal.market.title?.slice(0, 50)}**`);
    lines.push(`   Category: ${signal.category}`);
    lines.push(`   Price Move: ${(signal.priceMove * 100).toFixed(1)}% | Optimal: ${(signal.optimalUpdate * 100).toFixed(1)}%`);
    lines.push(`   Overreaction: ${signal.overreactionFactor.toFixed(1)}x`);
    lines.push(`   Base Rate: ${(signal.historicalBaseRate * 100).toFixed(0)}% | Current: ${(signal.currentPrice * 100).toFixed(0)}%`);
    lines.push(`   Edge: ${(signal.edge * 100).toFixed(1)}% | Direction: ${signal.direction.toUpperCase()}`);
    lines.push('');
  }

  lines.push('*Edge source: Tetlock/Kahneman base rate anchoring + optimal updating*');

  return lines.join('\n');
}
