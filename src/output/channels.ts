/**
 * Multi-Channel Discord Output
 *
 * Routes signals to appropriate Discord channels based on type and priority.
 * Each channel has its own webhook and filtering criteria.
 */

import { logger } from '../utils/index.js';
import type {
  DiscordChannel,
  ChannelConfig,
  RoutedAlert,
  EdgeOpportunity,
  MacroEdgeSignal,
  MetaEdgeSignal,
  NewMarket,
  CalibrationReport,
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
    critical: 'DISCORD_WEBHOOK_CRITICAL',
    macro: 'DISCORD_WEBHOOK_MACRO',
    cross_platform: 'DISCORD_WEBHOOK_CROSS_PLATFORM',
    whale: 'DISCORD_WEBHOOK_WHALE',
    sentiment: 'DISCORD_WEBHOOK_SENTIMENT',
    new_markets: 'DISCORD_WEBHOOK_NEW_MARKETS',
    meta: 'DISCORD_WEBHOOK_META',
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
      minEdge: channel === 'critical' ? 0.15 : 0.05,
      minConfidence: channel === 'critical' ? 0.7 : 0.5,
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
// MESSAGE ROUTING
// =============================================================================

/**
 * Send a message to a specific channel
 */
export async function sendToChannel(
  channel: DiscordChannel,
  content: string,
  options?: {
    embeds?: Array<Record<string, unknown>>;
    priority?: 'critical' | 'high' | 'normal' | 'low';
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
        username: `Kalshi Edge | ${channel.toUpperCase()}`,
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

/**
 * Send to multiple channels simultaneously
 */
export async function broadcast(
  channels: DiscordChannel[],
  content: string,
  options?: { embeds?: Array<Record<string, unknown>> }
): Promise<Map<DiscordChannel, boolean>> {
  const results = new Map<DiscordChannel, boolean>();

  await Promise.all(
    channels.map(async (channel) => {
      const success = await sendToChannel(channel, content, options);
      results.set(channel, success);
    })
  );

  return results;
}

// =============================================================================
// SIGNAL ROUTING
// =============================================================================

/**
 * Determine which channel(s) a signal should be routed to
 */
export function routeSignal(signal: {
  type: 'edge' | 'macro' | 'whale' | 'sentiment' | 'new_market' | 'meta';
  edge?: number;
  confidence?: number;
  category?: string;
  urgency?: 'critical' | 'standard' | 'fyi';
}): DiscordChannel[] {
  const channels: DiscordChannel[] = [];

  // Critical channel for high-conviction signals
  if (signal.urgency === 'critical' ||
      (signal.edge && signal.edge > 0.15 && signal.confidence && signal.confidence > 0.7)) {
    channels.push('critical');
  }

  // Route by type
  switch (signal.type) {
    case 'macro':
      channels.push('macro');
      break;
    case 'whale':
      channels.push('whale');
      break;
    case 'sentiment':
      channels.push('sentiment');
      break;
    case 'new_market':
      channels.push('new_markets');
      break;
    case 'meta':
      channels.push('meta');
      break;
    case 'edge':
      // Route to cross_platform by default for edge signals
      channels.push('cross_platform');
      break;
  }

  return [...new Set(channels)]; // Deduplicate
}

// =============================================================================
// FORMATTED MESSAGES
// =============================================================================

/**
 * Format and send an edge opportunity
 */
export async function sendEdgeAlert(opportunity: EdgeOpportunity): Promise<void> {
  const channels = routeSignal({
    type: 'edge',
    edge: opportunity.edge,
    confidence: opportunity.confidence,
    urgency: opportunity.urgency,
  });

  const emoji = opportunity.urgency === 'critical' ? '🔴' :
                opportunity.urgency === 'standard' ? '🟡' : '🟢';

  const content = [
    `${emoji} **${opportunity.urgency.toUpperCase()} EDGE**`,
    '',
    `**${opportunity.market.title?.slice(0, 80)}**`,
    `Platform: ${opportunity.market.platform} | Price: ${(opportunity.market.price * 100).toFixed(0)}%`,
    `Edge: ${(opportunity.edge * 100).toFixed(1)}% | Direction: **${opportunity.direction}**`,
    `Confidence: ${(opportunity.confidence * 100).toFixed(0)}%`,
    '',
    opportunity.market.url ? `[View Market](${opportunity.market.url})` : '',
  ].filter(Boolean).join('\n');

  await Promise.all(channels.map(ch => sendToChannel(ch, content)));
}

/**
 * Format and send a macro edge signal
 */
export async function sendMacroAlert(signal: MacroEdgeSignal): Promise<void> {
  const channels = routeSignal({
    type: 'macro',
    edge: signal.edge,
    confidence: signal.confidence,
    urgency: signal.signalStrength === 'strong' ? 'critical' : 'standard',
  });

  const dirEmoji = signal.direction === 'buy_yes' ? '🟢' : '🔴';
  const strength = signal.signalStrength === 'strong' ? '💪' :
                   signal.signalStrength === 'moderate' ? '📊' : '📉';

  const content = [
    `${strength} **MACRO EDGE: ${signal.indicatorType.toUpperCase()}**`,
    '',
    `**${signal.marketTitle.slice(0, 80)}**`,
    `${dirEmoji} **${signal.direction.toUpperCase()}** @ ${(signal.marketPrice * 100).toFixed(0)}%`,
    '',
    `Indicator: ${signal.indicatorName}`,
    `Source: ${signal.indicatorSource}`,
    `Implied: ${(signal.impliedProbability * 100).toFixed(0)}% | Edge: ${signal.edgePercent.toFixed(1)}%`,
    `Confidence: ${(signal.confidence * 100).toFixed(0)}%`,
    '',
    signal.reasoning,
    '',
    signal.marketUrl ? `[View Market](${signal.marketUrl})` : '',
  ].filter(Boolean).join('\n');

  await Promise.all(channels.map(ch => sendToChannel(ch, content)));
}

/**
 * Format and send a new market alert
 */
export async function sendNewMarketAlert(market: NewMarket): Promise<void> {
  const channels = routeSignal({ type: 'new_market' });

  const advantageEmoji = market.earlyMoverAdvantage === 'high' ? '🚀' :
                         market.earlyMoverAdvantage === 'medium' ? '⚡' : '📌';

  const content = [
    `${advantageEmoji} **NEW MARKET DETECTED**`,
    '',
    `**${market.market.title}**`,
    `Platform: ${market.market.platform} | Category: ${market.market.category}`,
    `Age: ${market.ageMinutes} minutes | Liquidity: $${market.currentLiquidity.toLocaleString()}`,
    '',
    `Early Mover Advantage: **${market.earlyMoverAdvantage.toUpperCase()}**`,
    market.hasExternalReference
      ? `External Estimate: ${((market.externalEstimate ?? 0) * 100).toFixed(0)}% | Potential Edge: ${((market.potentialEdge ?? 0) * 100).toFixed(1)}%`
      : 'No external reference available',
    '',
    market.market.url ? `[View Market](${market.market.url})` : '',
  ].filter(Boolean).join('\n');

  await Promise.all(channels.map(ch => sendToChannel(ch, content)));
}

/**
 * Format and send a meta edge signal
 */
export async function sendMetaAlert(signal: MetaEdgeSignal): Promise<void> {
  const channels = routeSignal({
    type: 'meta',
    edge: signal.metaEdge,
    confidence: signal.metaConfidence,
  });

  const dirEmoji = signal.direction === 'buy_yes' ? '🟢' : '🔴';

  const lines = [
    `🧠 **META EDGE SIGNAL**`,
    '',
    `**${signal.marketTitle.slice(0, 80)}**`,
    `${dirEmoji} **${signal.direction.toUpperCase()}** @ ${(signal.currentPrice * 100).toFixed(0)}%`,
    `Meta Edge: ${(signal.metaEdge * 100).toFixed(1)}% | Confidence: ${(signal.metaConfidence * 100).toFixed(0)}%`,
    '',
  ];

  if (signal.optionsImplied) {
    lines.push(`📈 Options (${signal.optionsImplied.source}): ${(signal.optionsImplied.edge * 100).toFixed(1)}% edge`);
  }

  if (signal.calibrationAdjustment) {
    lines.push(`📊 Calibration: ${(signal.calibrationAdjustment.historicalBias * 100).toFixed(1)}% historical bias`);
  }

  if (signal.newMarketBonus) {
    lines.push(`🆕 New Market: ${signal.newMarketBonus.ageMinutes}min old, ${(signal.newMarketBonus.earlyMoverEdge * 100).toFixed(1)}% early edge`);
  }

  lines.push('', signal.reasoning);
  lines.push('', signal.url ? `[View Market](${signal.url})` : '');

  const content = lines.filter(Boolean).join('\n');
  await Promise.all(channels.map(ch => sendToChannel(ch, content)));
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
  const content = [
    `📋 **DAILY DIGEST** - ${new Date().toLocaleDateString()}`,
    '',
    `**Summary**`,
    `Total Opportunities: ${stats.totalOpportunities}`,
    `Critical Alerts: ${stats.criticalAlerts}`,
    `New Markets: ${stats.newMarkets}`,
    `Whale Signals: ${stats.whaleSignals}`,
    '',
    stats.topEdge
      ? `**Top Edge:** ${stats.topEdge.title.slice(0, 50)}... (${(stats.topEdge.edge * 100).toFixed(1)}%)`
      : 'No significant edges today',
    '',
    `Avg Confidence: ${(stats.avgConfidence * 100).toFixed(0)}%`,
    `Calibration Score: ${stats.calibrationScore.toFixed(3)} (lower is better)`,
  ].join('\n');

  await sendToChannel('digest', content);
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
  const emoji = status.healthy ? '✅' : '⚠️';

  const content = [
    `${emoji} **SYSTEM STATUS**`,
    '',
    `Health: ${status.healthy ? 'Healthy' : 'Degraded'}`,
    `Uptime: ${Math.floor(status.uptime / 3600)}h ${Math.floor((status.uptime % 3600) / 60)}m`,
    `Last Scan: ${status.lastScan}`,
    `Markets Tracked: ${status.marketsTracked}`,
    `Active Predictions: ${status.predictionsActive}`,
    '',
    status.errors.length > 0
      ? `**Recent Errors:**\n${status.errors.slice(0, 3).map(e => `- ${e}`).join('\n')}`
      : 'No recent errors',
  ].join('\n');

  await sendToChannel('status', content);
}

// Initialize on module load
initializeChannels();
