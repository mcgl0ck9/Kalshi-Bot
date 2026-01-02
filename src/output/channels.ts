/**
 * Multi-Channel Discord Output
 *
 * Routes signals to appropriate Discord channels based on Kalshi market categories.
 * Channels align with Kalshi's classification system for easy organization.
 */

import { logger } from '../utils/index.js';
import type {
  DiscordChannel,
  ChannelConfig,
  EdgeOpportunity,
  MacroEdgeSignal,
  MetaEdgeSignal,
  NewMarket,
  MarketCategory,
} from '../types/index.js';

// =============================================================================
// CHANNEL CONFIGURATION
// =============================================================================

const CHANNEL_CONFIGS: Map<DiscordChannel, ChannelConfig> = new Map();

/**
 * Initialize channel configurations from environment
 */
export function initializeChannels(): void {
  const channelEnvMap: Record<DiscordChannel, string> = {
    sports: 'DISCORD_WEBHOOK_SPORTS',
    weather: 'DISCORD_WEBHOOK_WEATHER',
    economics: 'DISCORD_WEBHOOK_ECONOMICS',
    mentions: 'DISCORD_WEBHOOK_MENTIONS',
    entertainment: 'DISCORD_WEBHOOK_ENTERTAINMENT',
    health: 'DISCORD_WEBHOOK_HEALTH',
    politics: 'DISCORD_WEBHOOK_POLITICS',
    crypto: 'DISCORD_WEBHOOK_CRYPTO',
    digest: 'DISCORD_WEBHOOK_DIGEST',
    status: 'DISCORD_WEBHOOK_STATUS',
  };

  // Fallback webhook for channels without specific URL
  const fallbackWebhook = process.env.DISCORD_WEBHOOK_URL ?? '';

  for (const [channel, envVar] of Object.entries(channelEnvMap)) {
    const webhookUrl = process.env[envVar] ?? fallbackWebhook;

    CHANNEL_CONFIGS.set(channel as DiscordChannel, {
      name: channel as DiscordChannel,
      webhookUrl,
      enabled: !!webhookUrl,
      minEdge: 0.03,
      minConfidence: 0.40,
    });
  }

  const enabledCount = Array.from(CHANNEL_CONFIGS.values()).filter(c => c.enabled).length;
  logger.info(`Initialized ${enabledCount} Discord channels`);
}

/**
 * Get configuration for a channel
 */
export function getChannelConfig(channel: DiscordChannel): ChannelConfig | undefined {
  return CHANNEL_CONFIGS.get(channel);
}

// =============================================================================
// CHANNEL ROUTING
// =============================================================================

/**
 * Map market category to Discord channel
 */
function categoryToChannel(category: MarketCategory | string): DiscordChannel {
  switch (category) {
    case 'sports':
      return 'sports';
    case 'weather':
      return 'weather';
    case 'macro':
      return 'economics';
    case 'politics':
    case 'geopolitics':
      return 'politics';
    case 'crypto':
      return 'crypto';
    case 'entertainment':
      return 'entertainment';
    case 'tech':
      return 'economics'; // Tech often relates to earnings/economic
    default:
      return 'digest'; // Fallback
  }
}

/**
 * Route an opportunity to the appropriate channel based on source and category
 */
export function routeOpportunity(opportunity: EdgeOpportunity): DiscordChannel {
  const { source, market, signals } = opportunity;

  // Route by signal source first (more specific)
  switch (source) {
    case 'measles':
      return 'health';

    case 'earnings':
      return 'mentions';

    case 'sports':
      return 'sports';

    case 'macro':
    case 'options':
      return 'economics';

    case 'new-market':
      // New markets go to digest for visibility
      return 'digest';

    case 'whale':
      // Whale signals go to economics (most whale bets are macro/politics)
      return 'economics';

    case 'sentiment':
    case 'cross-platform':
    case 'combined':
    default:
      break;
  }

  // Check for specific signal types
  if (signals.whaleConviction) {
    // Whale conviction signals go to economics
    return 'economics';
  }
  if (signals.newMarket) {
    // New market signals go to digest
    return 'digest';
  }
  if (signals.fedSpeech) {
    return 'mentions';
  }
  if (signals.measles) {
    return 'health';
  }
  if (signals.enhancedSports || signals.sportsConsensus !== undefined) {
    return 'sports';
  }
  if (signals.macroEdge || signals.optionsImplied) {
    return 'economics';
  }
  if (signals.entertainment) {
    return 'entertainment';
  }

  // Fall back to market category
  return categoryToChannel(market.category);
}

// =============================================================================
// MESSAGE SENDING
// =============================================================================

/**
 * Send a message to a specific channel
 */
export async function sendToChannel(
  channel: DiscordChannel,
  content: string,
  options?: {
    embeds?: Array<Record<string, unknown>>;
  }
): Promise<boolean> {
  const config = CHANNEL_CONFIGS.get(channel);

  if (!config?.enabled || !config.webhookUrl) {
    logger.debug(`Channel ${channel} not configured, skipping`);
    return false;
  }

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: `Kalshi | ${channel.charAt(0).toUpperCase() + channel.slice(1)}`,
        embeds: options?.embeds,
      }),
    });

    if (!response.ok) {
      logger.error(`Channel ${channel} webhook error: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Channel ${channel} send error: ${error}`);
    return false;
  }
}

// =============================================================================
// ALERT FORMATTING
// =============================================================================

// Track sent market IDs to avoid duplicates in same session
const sentMarkets = new Set<string>();

/**
 * Format a clear, actionable alert for an edge opportunity
 */
function formatClearAlert(opportunity: EdgeOpportunity): string {
  const { market, edge, confidence, direction, urgency, signals, sizing } = opportunity;

  const price = market.price * 100;
  const isYes = direction === 'BUY YES';
  const fairValue = isYes ? price + (edge * 100) : price - (edge * 100);

  const lines: string[] = [];

  // Crystal clear action header
  if (isYes) {
    lines.push(`**BUY YES @ ${price.toFixed(0)}¢**`);
    lines.push(`Pay ${price.toFixed(0)}¢ → Win ${(100 - price).toFixed(0)}¢ if YES`);
  } else {
    lines.push(`**BUY NO @ ${(100 - price).toFixed(0)}¢**`);
    lines.push(`Pay ${(100 - price).toFixed(0)}¢ → Win ${price.toFixed(0)}¢ if NO`);
  }
  lines.push('');

  // Market title
  lines.push(`**${market.title}**`);
  lines.push('');

  // Edge explanation
  lines.push('```');
  lines.push(`Market price: ${price.toFixed(0)}¢ YES / ${(100-price).toFixed(0)}¢ NO`);
  lines.push(`Our estimate: ${fairValue.toFixed(0)}¢ YES`);
  lines.push(`Edge:         +${(edge * 100).toFixed(1)}%`);
  lines.push('```');

  // Why this edge exists - be specific
  lines.push('');
  lines.push('**Why:**');

  if (signals.measles) {
    // Use reasoning if available (handles early-year case properly)
    if (signals.measles.reasoning) {
      lines.push(signals.measles.reasoning);
    } else if (signals.measles.weekNumber && signals.measles.weekNumber <= 8) {
      // Early in year - probability based on historical patterns, not YTD
      lines.push(`Week ${signals.measles.weekNumber} of year. Historical data suggests threshold of ${signals.measles.threshold} cases.`);
    } else {
      lines.push(`CDC: ${signals.measles.currentCases} cases YTD, projecting ${signals.measles.projectedYearEnd} by year end`);
      lines.push(`Threshold is ${signals.measles.threshold} cases`);
    }
  } else if (signals.fedSpeech) {
    lines.push(`Historical Fed transcripts show "${signals.fedSpeech.keyword}" appears ${(signals.fedSpeech.historicalFrequency * 100).toFixed(0)}% of the time`);
  } else if (signals.earnings) {
    lines.push(`${signals.earnings.company} earnings: "${signals.earnings.keyword}" analysis suggests ${(signals.earnings.impliedProbability * 100).toFixed(0)}% probability`);
  } else if (signals.enhancedSports) {
    const s = signals.enhancedSports;
    lines.push(`${s.awayTeam} @ ${s.homeTeam}`);
    lines.push(`${s.primaryReason}`);
    if (s.sharpEdge) lines.push(`Sharp money edge: ${(s.sharpEdge * 100).toFixed(1)}%`);
  } else if (signals.sportsConsensus !== undefined) {
    lines.push(`Sportsbook consensus: ${(signals.sportsConsensus * 100).toFixed(0)}%`);
    if (signals.matchedGame) lines.push(`Game: ${signals.matchedGame}`);
  } else if (signals.macroEdge) {
    lines.push(`${signals.macroEdge.indicatorName}: ${signals.macroEdge.reasoning}`);
  } else if (signals.optionsImplied) {
    lines.push(`${signals.optionsImplied.reasoning}`);
  } else if (signals.whaleConviction) {
    const wc = signals.whaleConviction;
    lines.push(`Polymarket whales betting ${(wc.whaleImpliedPrice * 100).toFixed(0)}¢ vs Kalshi ${(wc.polymarketPrice * 100).toFixed(0)}¢`);
    lines.push(`${wc.topWhaleCount} top traders with ${(wc.convictionStrength * 100).toFixed(0)}% conviction`);
    lines.push(`Smart money sees value here`);
  } else if (signals.newMarket) {
    const nm = signals.newMarket;
    lines.push(`Fresh market (${nm.ageMinutes} min old) - early mover advantage`);
    if (nm.potentialEdge && nm.potentialEdge > 0.03) {
      lines.push(`Potential edge: +${(nm.potentialEdge * 100).toFixed(1)}%`);
    }
    lines.push(`Liquidity trend: ${nm.liquidityTrend}`);
    if (nm.hasExternalReference) {
      lines.push(`Has external data sources for validation`);
    }
  } else if (signals.recencyBias) {
    lines.push(`Market overreacted to recent news`);
    lines.push(`Price will likely revert toward base rate`);
  } else if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    lines.push(`Kalshi: ${(cp.kalshiPrice * 100).toFixed(0)} cents vs Polymarket: ${(cp.polymarketPrice * 100).toFixed(0)} cents`);
  } else if (signals.sentiment) {
    lines.push(`News sentiment: ${signals.sentiment.sentimentLabel} (${signals.sentiment.articleCount} articles)`);
  } else if (signals.entertainment) {
    const ent = signals.entertainment;
    const scoreIcon = ent.currentScore >= 60 ? '🍅' : '🤢';
    lines.push(`${scoreIcon} RT Score: ${ent.currentScore}% (${ent.reviewCount ?? 'unknown'} reviews)`);
    lines.push(`Threshold: ${ent.threshold}% | Buffer: ${ent.buffer > 0 ? '+' : ''}${ent.buffer} points`);
    if (ent.buffer > 0) {
      lines.push(`Score is ABOVE threshold - high probability of staying above`);
    } else {
      lines.push(`Score is BELOW threshold - unlikely to rise`);
    }
  } else if (signals.playerProp) {
    const pp = signals.playerProp;
    lines.push(`${pp.playerName}: ${pp.propType} ${pp.isOver ? 'Over' : 'Under'} ${pp.line}`);
    lines.push(`Sportsbooks: ${(pp.consensusProb * 100).toFixed(0)}% vs Kalshi price`);
    lines.push(pp.reasoning);
  } else if (signals.lineMove) {
    const lm = signals.lineMove;
    const moveEmoji = lm.moveType === 'steam' ? '🔥' : lm.moveType === 'opening_value' ? '📊' : '📈';
    lines.push(`${moveEmoji} ${lm.moveType.toUpperCase()} MOVE toward ${lm.direction}`);
    lines.push(`Line: ${(lm.previousProb * 100).toFixed(0)}% → ${(lm.currentProb * 100).toFixed(0)}% (${lm.timeframeMinutes} min)`);
    if (lm.openingProb) {
      lines.push(`Opener: ${(lm.openingProb * 100).toFixed(0)}%`);
    }
    lines.push(lm.reasoning);
  } else {
    lines.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
  }

  // Position sizing if available
  if (sizing && sizing.positionSize > 0) {
    lines.push('');
    lines.push(`Suggested bet: $${sizing.positionSize.toFixed(0)}`);
  }

  // Trade link
  if (market.url) {
    lines.push('');
    lines.push(`[Trade on Kalshi](${market.url})`);
  }

  return lines.join('\n');
}

/**
 * Validate a market for quality before alerting
 */
function validateMarket(opportunity: EdgeOpportunity): string | null {
  const market = opportunity.market;
  const price = market.price ?? 0;
  const title = market.title ?? '';

  // Invalid or missing price
  if (!price || price <= 0) {
    return `invalid price: ${price}`;
  }

  // Edge is unrealistically high (depends on signal type)
  const isPlayerProp = opportunity.signals?.playerProp !== undefined;
  const isSportsOdds = opportunity.signals?.sportsConsensus !== undefined || opportunity.signals?.enhancedSports !== undefined;
  const isEarnings = opportunity.signals?.earnings !== undefined;
  const isFedSpeech = opportunity.signals?.fedSpeech !== undefined;
  const maxEdge = (isPlayerProp || isSportsOdds || isEarnings || isFedSpeech) ? 0.90 : 0.50;

  if (opportunity.edge > maxEdge) {
    return `suspicious edge: ${(opportunity.edge * 100).toFixed(0)}%`;
  }

  // Price too close to extremes (illiquid markets)
  if (price < 0.02 || price > 0.98) {
    return `extreme price: ${(price * 100).toFixed(0)} cents (likely illiquid)`;
  }

  // Confidence too low (lowered from 40% to 35%)
  if (opportunity.confidence < 0.35) {
    return `low confidence: ${(opportunity.confidence * 100).toFixed(0)}%`;
  }

  // Duplicate market in same session (by ID)
  const marketKey = `${market.platform}:${market.id}`;
  if (sentMarkets.has(marketKey)) {
    return 'duplicate market (already alerted)';
  }

  return null;
}

/**
 * Format and send an edge opportunity to the appropriate channel
 */
export async function sendEdgeAlert(opportunity: EdgeOpportunity): Promise<void> {
  // Validate market data
  const validationError = validateMarket(opportunity);
  if (validationError) {
    logger.debug(`Skipping alert for "${opportunity.market.title?.slice(0, 50)}" - ${validationError}`);
    return;
  }

  // Mark as sent to avoid duplicates
  const marketKey = `${opportunity.market.platform}:${opportunity.market.id}`;
  sentMarkets.add(marketKey);

  // Route to appropriate channel
  const channel = routeOpportunity(opportunity);

  // Format the alert
  const content = formatClearAlert(opportunity);

  await sendToChannel(channel, content);
}

/**
 * Format and send a macro edge signal
 * These are always Fed/CPI/Jobs/GDP signals -> economics channel
 */
export async function sendMacroAlert(signal: MacroEdgeSignal): Promise<void> {
  const dirMark = signal.direction === 'buy_yes' ? '++' : '--';

  const lines = [
    `**${dirMark} ${signal.direction.toUpperCase()}**`,
    '',
    `**${signal.marketTitle.slice(0, 100)}**`,
    '',
    '```',
    `Current:  ${(signal.marketPrice * 100).toFixed(0)} cents`,
    `Implied:  ${(signal.impliedProbability * 100).toFixed(0)} cents`,
    `Edge:     +${signal.edgePercent.toFixed(1)}%`,
    '```',
    '',
    '**Why:**',
    `${signal.indicatorType.toUpperCase()}: ${signal.indicatorName}`,
    signal.reasoning,
    '',
    signal.marketUrl ? `[Trade on Kalshi](${signal.marketUrl})` : '',
  ].filter(Boolean);

  await sendToChannel('economics', lines.join('\n'));
}

/**
 * Format and send a new market alert
 */
export async function sendNewMarketAlert(market: NewMarket): Promise<void> {
  const channel = categoryToChannel(market.market.category);

  const advantageEmoji = market.earlyMoverAdvantage === 'high' ? '!!' :
                         market.earlyMoverAdvantage === 'medium' ? '!' : '';

  const lines = [
    `**NEW MARKET${advantageEmoji}**`,
    '',
    `**${market.market.title}**`,
    '',
    `Age: ${market.ageMinutes} minutes`,
    `Liquidity: $${market.currentLiquidity.toLocaleString()}`,
    `Early mover advantage: ${market.earlyMoverAdvantage}`,
    '',
    market.potentialEdge && market.potentialEdge > 0.03
      ? `Potential edge: +${(market.potentialEdge * 100).toFixed(1)}%`
      : '',
    '',
    market.market.url ? `[View Market](${market.market.url})` : '',
  ].filter(Boolean);

  await sendToChannel(channel, lines.join('\n'));
}

/**
 * Send daily digest
 */
export async function sendDailyDigest(stats: {
  totalOpportunities: number;
  criticalAlerts: number;
  topEdge: { title: string; edge: number } | null;
  avgConfidence: number;
  newMarkets: number;
  whaleSignals: number;
  calibrationScore: number;
}): Promise<void> {
  const lines = [
    `**DAILY DIGEST** - ${new Date().toLocaleDateString()}`,
    '',
    `Opportunities: ${stats.totalOpportunities}`,
    `New Markets: ${stats.newMarkets}`,
    '',
    stats.topEdge
      ? `Top Edge: ${stats.topEdge.title.slice(0, 50)}... (+${(stats.topEdge.edge * 100).toFixed(1)}%)`
      : 'No significant edges today',
    '',
    `Avg Confidence: ${(stats.avgConfidence * 100).toFixed(0)}%`,
    `Calibration: ${stats.calibrationScore.toFixed(3)} Brier`,
  ];

  await sendToChannel('digest', lines.join('\n'));
}

/**
 * Send system status update
 */
export async function sendStatusUpdate(status: {
  healthy: boolean;
  uptime: number;
  lastScan: string;
  errors: string[];
  marketsTracked: number;
  predictionsActive: number;
}): Promise<void> {
  const emoji = status.healthy ? 'OK' : 'WARN';

  const lines = [
    `**SYSTEM STATUS: ${emoji}**`,
    '',
    `Uptime: ${Math.floor(status.uptime / 3600)}h ${Math.floor((status.uptime % 3600) / 60)}m`,
    `Last Scan: ${status.lastScan}`,
    `Markets Tracked: ${status.marketsTracked}`,
    `Active Predictions: ${status.predictionsActive}`,
    '',
    status.errors.length > 0
      ? `Errors:\n${status.errors.slice(0, 3).map(e => `- ${e}`).join('\n')}`
      : 'No errors',
  ];

  await sendToChannel('status', lines.join('\n'));
}

/**
 * Clear sent markets cache (call between scans)
 */
export function clearSentMarketsCache(): void {
  sentMarkets.clear();
}

// Initialize on module load
initializeChannels();
