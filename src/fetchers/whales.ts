/**
 * Whale Tracker Module
 *
 * Monitors top prediction market traders via public profiles.
 * Note: Twitter scraping may be unreliable. Future versions should
 * integrate with official APIs or on-chain data.
 */

import type { Whale, WhaleSignal } from '../types/index.js';
import { logger, delay } from '../utils/index.js';
import { KNOWN_WHALES } from '../config.js';

// =============================================================================
// WHALE DATA
// =============================================================================

/**
 * Get info about a specific whale
 */
export function getWhaleInfo(whaleName: string): Whale | null {
  const info = KNOWN_WHALES[whaleName];
  if (!info) return null;

  return {
    name: whaleName,
    twitter: info.twitter,
    platform: info.platform,
    profit: info.profit,
    specialty: info.specialty,
    description: info.description,
  };
}

/**
 * Get all known whales
 */
export function getAllWhales(): Whale[] {
  return Object.entries(KNOWN_WHALES).map(([name, info]) => ({
    name,
    twitter: info.twitter,
    platform: info.platform,
    profit: info.profit,
    specialty: info.specialty,
    description: info.description,
  }));
}

// =============================================================================
// SIGNAL ANALYSIS
// =============================================================================

const BULLISH_KEYWORDS = ['buying', 'long', 'bullish', 'undervalued', 'cheap', 'going up', 'yes on', 'all in'];
const BEARISH_KEYWORDS = ['selling', 'short', 'bearish', 'overvalued', 'expensive', 'going down', 'no on', 'exit'];
const MARKET_KEYWORDS = ['kalshi', 'polymarket', 'prediction', 'market', 'betting', 'position', 'trade'];

/**
 * Analyze a piece of text for market signals
 */
export function analyzeWhaleText(
  text: string,
  whale: Whale
): WhaleSignal | null {
  const textLower = text.toLowerCase();

  // Check if it's market-related
  const isMarketRelated = MARKET_KEYWORDS.some(kw => textLower.includes(kw));

  if (!isMarketRelated) return null;

  // Determine sentiment
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';

  if (BULLISH_KEYWORDS.some(kw => textLower.includes(kw))) {
    sentiment = 'bullish';
  } else if (BEARISH_KEYWORDS.some(kw => textLower.includes(kw))) {
    sentiment = 'bearish';
  }

  // Extract potential tickers mentioned
  const tickerPattern = /\b(KX[A-Z0-9]+|INX[A-Z0-9]+|\$[A-Z]{2,})\b/gi;
  const tickerMatches = text.match(tickerPattern) ?? [];
  const tickers = tickerMatches.map(t => t.toUpperCase());

  return {
    whale: whale.name,
    whaleProfit: whale.profit,
    text,
    sentiment,
    tickersMentioned: tickers,
    specialty: whale.specialty,
  };
}

// =============================================================================
// MOCK WHALE ACTIVITY (for demo purposes)
// =============================================================================

/**
 * Check for whale activity signals
 *
 * Note: In production, this would scrape or use APIs to get real data.
 * For now, returns empty array - implement real data source integration.
 */
export async function checkWhaleActivity(): Promise<WhaleSignal[]> {
  logger.info('Checking whale activity...');

  // TODO: Implement real whale tracking via:
  // 1. Nitter/Twitter scraping (unreliable)
  // 2. Polymarket on-chain data (requires blockchain indexing)
  // 3. Public API endpoints if available

  const signals: WhaleSignal[] = [];

  // Placeholder - in real implementation, fetch actual whale activity
  logger.info(`Found ${signals.length} whale activity signals`);

  return signals;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format whale activity for Discord
 */
export function formatWhaleActivity(signals: WhaleSignal[]): string {
  if (signals.length === 0) {
    return 'No recent whale activity detected.';
  }

  const lines: string[] = ['**Whale Activity**\n'];

  for (const signal of signals.slice(0, 5)) {
    const emoji = signal.sentiment === 'bullish' ? '🟢' : signal.sentiment === 'bearish' ? '🔴' : '⚪';
    const profitStr = signal.whaleProfit >= 1_000_000
      ? `$${(signal.whaleProfit / 1_000_000).toFixed(1)}M`
      : `$${(signal.whaleProfit / 1_000).toFixed(0)}K`;

    lines.push(`${emoji} **${signal.whale}** (${profitStr} profit)`);
    lines.push(`   ${signal.text.slice(0, 100)}...`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get whale leaderboard for display
 */
export function getWhaleLeaderboard(): string {
  const whales = getAllWhales().sort((a, b) => b.profit - a.profit);

  const lines: string[] = ['**Top Prediction Market Whales**\n'];

  for (let i = 0; i < Math.min(10, whales.length); i++) {
    const whale = whales[i];
    const profitStr = whale.profit >= 1_000_000
      ? `$${(whale.profit / 1_000_000).toFixed(1)}M`
      : `$${(whale.profit / 1_000).toFixed(0)}K`;

    lines.push(
      `${i + 1}. **${whale.name}** - ${profitStr} - ${whale.specialty.join(', ')}`
    );
  }

  return lines.join('\n');
}
