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
      // Route new markets by their category
      return categoryToChannel(market.category);

    case 'sentiment':
    case 'whale':
    case 'cross-platform':
    case 'combined':
    default:
      break;
  }

  // Check for specific signal types
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

  // Header with urgency
  const urgencyEmoji = urgency === 'critical' ? '!!' : urgency === 'standard' ? '!' : '';
  const actionEmoji = isYes ? '++' : '--';

  const lines: string[] = [];

  // Clear action line
  lines.push(`**${actionEmoji} ${direction}${urgencyEmoji}**`);
  lines.push('');

  // Market title
  lines.push(`**${market.title}**`);
  lines.push('');

  // Simple price box
  lines.push('```');
  lines.push(`Current:    ${price.toFixed(0)} cents`);
  lines.push(`Fair Value: ${fairValue.toFixed(0)} cents`);
  lines.push(`Edge:       +${(edge * 100).toFixed(1)}%`);
  lines.push('```');

  // Why this edge exists - be specific
  lines.push('');
  lines.push('**Why:**');

  if (signals.measles) {
    lines.push(`CDC has ${signals.measles.currentCases} cases YTD, projecting ${signals.measles.projectedYearEnd} by year end`);
    lines.push(`Threshold is ${signals.measles.threshold} cases`);
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
  } else if (signals.newMarket) {
    lines.push(`New market (${signals.newMarket.ageMinutes} min old)`);
    lines.push(`Early mover advantage: ${signals.newMarket.earlyMoverAdvantage}`);
  } else if (signals.recencyBias) {
    lines.push(`Market overreacted to recent news`);
    lines.push(`Price will likely revert toward base rate`);
  } else if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    lines.push(`Kalshi: ${(cp.kalshiPrice * 100).toFixed(0)} cents vs Polymarket: ${(cp.polymarketPrice * 100).toFixed(0)} cents`);
  } else if (signals.sentiment) {
    lines.push(`News sentiment: ${signals.sentiment.sentimentLabel} (${signals.sentiment.articleCount} articles)`);
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

  // Edge is unrealistically high (>50%)
  if (opportunity.edge > 0.50) {
    return `suspicious edge: ${(opportunity.edge * 100).toFixed(0)}%`;
  }

  // Price too close to extremes (illiquid markets)
  if (price < 0.02 || price > 0.98) {
    return `extreme price: ${(price * 100).toFixed(0)} cents (likely illiquid)`;
  }

  // Confidence too low
  if (opportunity.confidence < 0.40) {
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
