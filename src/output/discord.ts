/**
 * Discord Output Module
 *
 * Handles sending messages to Discord via:
 * - Webhooks (for scheduled reports)
 * - Bot commands (for interactive queries)
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { EdgeOpportunity, CrossPlatformMatch, TopicSentiment, WhaleSignal } from '../types/index.js';
import { logger, getUrgencyEmoji, formatCurrency } from '../utils/index.js';
import { DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN } from '../config.js';
import {
  fetchWeekendBoxOffice,
  fetchRottenTomatoesScore,
  searchRottenTomatoes,
  formatWeekendBoxOfficeReport,
  formatMovieScore,
} from '../fetchers/entertainment.js';

// =============================================================================
// WEBHOOK MESSAGING
// =============================================================================

/**
 * Send a message via Discord webhook
 */
export async function sendWebhookMessage(
  content: string,
  options?: {
    username?: string;
    embeds?: Array<Record<string, unknown>>;
  }
): Promise<boolean> {
  if (!DISCORD_WEBHOOK_URL) {
    logger.warn('Discord webhook URL not configured');
    return false;
  }

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: options?.username ?? 'Kalshi Edge Detector',
        embeds: options?.embeds,
      }),
    });

    if (!response.ok) {
      logger.error(`Webhook error: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Webhook send error: ${error}`);
    return false;
  }
}

/**
 * Test the Discord webhook connection
 */
export async function testWebhook(): Promise<boolean> {
  const testMessage = `🔍 **Kalshi Edge Detector** - Connection Test\n\nWebhook is working! Ready to send alerts.`;
  return sendWebhookMessage(testMessage);
}

// =============================================================================
// MESSAGE FORMATTING
// =============================================================================

/**
 * Format an edge opportunity for Discord
 * COMPACT format - one-line action, key signals only
 */
export function formatEdgeAlert(opportunity: EdgeOpportunity): string {
  const { market, edge, confidence, direction, urgency, signals } = opportunity;

  // Determine urgency indicator
  const urgencyBar = urgency === 'critical' ? '🔴 CRITICAL' :
                     urgency === 'standard' ? '🟡 STANDARD' : '🟢 FYI';

  // Action with color
  const isYes = direction === 'BUY YES';
  const actionEmoji = isYes ? '🟢' : '🔴';
  const currentPrice = market.price * 100;
  const fairValue = isYes ? currentPrice + (edge * 100) : currentPrice - (edge * 100);

  const lines: string[] = [
    `**${urgencyBar}** | ${actionEmoji} **${direction}** @ ${currentPrice.toFixed(0)}¢ → ${fairValue.toFixed(0)}¢`,
    `${market.title?.slice(0, 65)}${(market.title?.length ?? 0) > 65 ? '...' : ''}`,
    `Edge: **+${(edge * 100).toFixed(1)}%** | Conf: ${(confidence * 100).toFixed(0)}%`,
  ];

  // Compact signals - one line per type
  const signalsList: string[] = [];

  if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    const cheaper = cp.kalshiPrice < cp.polymarketPrice ? 'K' : 'P';
    signalsList.push(`K:${(cp.kalshiPrice * 100).toFixed(0)}¢/P:${(cp.polymarketPrice * 100).toFixed(0)}¢ (buy ${cheaper})`);
  }
  if (signals.sportsConsensus !== undefined) {
    signalsList.push(`Sports: ${(signals.sportsConsensus * 100).toFixed(0)}% consensus`);
  }
  if (signals.sentiment) {
    signalsList.push(`Sentiment: ${signals.sentiment.sentimentLabel} (${signals.sentiment.articleCount} articles)`);
  }
  if (signals.whale) {
    signalsList.push(`Whale: ${signals.whale.sentiment}`);
  }
  if (signals.fedRegime) {
    signalsList.push(`Fed: ${signals.fedRegime}`);
  }
  if (signals.injuryOverreaction) {
    signalsList.push('Injury overreaction');
  }
  if (signals.weatherBias) {
    signalsList.push(`Weather: ${signals.weatherBias}`);
  }
  if (signals.recencyBias) {
    signalsList.push('Recency bias');
  }
  if (signals.measles) {
    signalsList.push(`Measles: ${signals.measles.currentCases}→${signals.measles.projectedYearEnd} (threshold: ${signals.measles.threshold})`);
  }

  if (signalsList.length > 0) {
    lines.push(`Signals: ${signalsList.slice(0, 3).join(' | ')}`);
  }

  // Position sizing (compact)
  if (opportunity.sizing && opportunity.sizing.positionSize > 0) {
    lines.push(`Size: ${formatCurrency(opportunity.sizing.positionSize)} (${(opportunity.sizing.kellyFraction ?? 0) * 100}% Kelly)`);
  }

  // Trade link
  if (market.url) {
    lines.push(`[Trade on ${market.platform?.toUpperCase()}](${market.url})`);
  }

  return lines.join('\n');
}

/**
 * Format a summary report for Discord
 * COMPACT format for quick scanning
 */
export function formatSummaryReport(
  opportunities: EdgeOpportunity[],
  divergences: CrossPlatformMatch[],
  whaleSignals: WhaleSignal[],
  stats: {
    totalMarkets: number;
    kalshiMarkets: number;
    polymarketMarkets: number;
    articlesAnalyzed: number;
  }
): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const lines: string[] = [
    `📊 **SCAN REPORT** | ${now} ET`,
    `Markets: ${stats.totalMarkets} | Articles: ${stats.articlesAnalyzed} | Edges: ${opportunities.length}`,
    '',
  ];

  // Filter valid opportunities
  const validOpportunities = opportunities.filter(opp =>
    opp.market.price > 0 && opp.edge <= 0.50
  );

  // Group by urgency
  const critical = validOpportunities.filter(o => o.urgency === 'critical');
  const standard = validOpportunities.filter(o => o.urgency === 'standard');
  const fyi = validOpportunities.filter(o => o.urgency === 'fyi');

  // Critical alerts first
  if (critical.length > 0) {
    lines.push('🔴 **CRITICAL** ────────────────');
    for (const opp of critical.slice(0, 3)) {
      const action = opp.direction === 'BUY YES' ? '🟢 YES' : '🔴 NO';
      lines.push(`${action} @ ${(opp.market.price * 100).toFixed(0)}¢ | +${(opp.edge * 100).toFixed(0)}% | ${opp.market.title?.slice(0, 40)}...`);
      if (opp.market.url) lines.push(`  └─ [Trade](${opp.market.url})`);
    }
    lines.push('');
  }

  // Standard alerts
  if (standard.length > 0) {
    lines.push('🟡 **STANDARD** ────────────────');
    for (const opp of standard.slice(0, 5)) {
      const action = opp.direction === 'BUY YES' ? '🟢' : '🔴';
      lines.push(`${action} ${(opp.market.price * 100).toFixed(0)}¢→${((opp.market.price + opp.edge) * 100).toFixed(0)}¢ | ${opp.market.title?.slice(0, 45)}...`);
    }
    lines.push('');
  }

  // FYI (just count)
  if (fyi.length > 0) {
    lines.push(`🟢 **FYI**: ${fyi.length} lower-priority edges detected`);
    lines.push('');
  }

  // Cross-platform (compact)
  if (divergences.length > 0) {
    lines.push('📊 **ARBITRAGE** ────────────────');
    for (const div of divergences.slice(0, 3)) {
      const cheaper = div.kalshi.price < div.polymarket.price ? 'K' : 'P';
      lines.push(`${div.kalshi.title?.slice(0, 35)}... | K:${(div.kalshi.price * 100).toFixed(0)}¢ P:${(div.polymarket.price * 100).toFixed(0)}¢ (buy ${cheaper})`);
    }
    lines.push('');
  }

  // Whale activity (compact)
  if (whaleSignals.length > 0) {
    lines.push(`🐋 **WHALES**: ${whaleSignals.length} signals`);
    for (const s of whaleSignals.slice(0, 2)) {
      const emoji = s.sentiment === 'bullish' ? '🟢' : s.sentiment === 'bearish' ? '🔴' : '⚪';
      lines.push(`  ${emoji} ${s.whale}: ${s.text.slice(0, 50)}...`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// DISCORD BOT
// =============================================================================

let client: Client | null = null;

/**
 * Create and configure the Discord bot
 */
export function createBot(): Client {
  if (client) return client;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
  });

  return client;
}

/**
 * Register slash commands
 */
export async function registerCommands(clientId: string, guildId?: string): Promise<void> {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN not configured');
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('scan')
      .setDescription('Run an immediate market scan'),
    new SlashCommandBuilder()
      .setName('whales')
      .setDescription('Check recent whale activity'),
    new SlashCommandBuilder()
      .setName('divergences')
      .setDescription('Show cross-platform price divergences'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Bot status and configuration'),
    new SlashCommandBuilder()
      .setName('boxoffice')
      .setDescription('Get current weekend box office numbers'),
    new SlashCommandBuilder()
      .setName('rt')
      .setDescription('Get Rotten Tomatoes score for a movie')
      .addStringOption(option =>
        option
          .setName('movie')
          .setDescription('Movie slug (e.g., "the_dark_knight" or search term)')
          .setRequired(true)
      ),
  ].map(cmd => cmd.toJSON());

  const rest = new REST().setToken(DISCORD_BOT_TOKEN);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
    logger.info('Registered slash commands');
  } catch (error) {
    logger.error(`Failed to register commands: ${error}`);
  }
}

/**
 * Start the Discord bot
 */
export async function startBot(
  onScan: () => Promise<void>,
  onWhales: () => Promise<string>,
  onDivergences: () => Promise<string>,
  onStatus: () => Promise<string>
): Promise<void> {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN not configured');
  }

  const bot = createBot();

  bot.on('ready', () => {
    logger.info(`Discord bot logged in as ${bot.user?.tag}`);
  });

  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
      await interaction.deferReply();

      switch (commandName) {
        case 'scan':
          await interaction.followUp('🔍 Starting market scan...');
          await onScan();
          await interaction.followUp('✅ Scan complete! Check the channel for results.');
          break;

        case 'whales':
          const whalesMsg = await onWhales();
          await interaction.followUp(whalesMsg.slice(0, 2000));
          break;

        case 'divergences':
          const divMsg = await onDivergences();
          await interaction.followUp(divMsg.slice(0, 2000));
          break;

        case 'status':
          const statusMsg = await onStatus();
          await interaction.followUp(statusMsg.slice(0, 2000));
          break;

        case 'boxoffice':
          const boxOfficeData = await fetchWeekendBoxOffice();
          const boxOfficeMsg = formatWeekendBoxOfficeReport(boxOfficeData);
          await interaction.followUp(boxOfficeMsg.slice(0, 2000));
          break;

        case 'rt':
          const movieInput = interaction.options.getString('movie', true);
          // Try direct slug first, then search
          let rtScore = await fetchRottenTomatoesScore(movieInput.replace(/\s+/g, '_').toLowerCase());

          if (!rtScore) {
            // Search for the movie
            const searchResults = await searchRottenTomatoes(movieInput);
            if (searchResults.length > 0) {
              // Get the first result's slug
              const slug = searchResults[0].url.split('/m/')[1];
              if (slug) {
                rtScore = await fetchRottenTomatoesScore(slug);
              }
            }
          }

          if (rtScore) {
            await interaction.followUp(formatMovieScore(rtScore));
          } else {
            await interaction.followUp(`Could not find Rotten Tomatoes data for "${movieInput}"`);
          }
          break;

        default:
          await interaction.followUp('Unknown command');
      }
    } catch (error) {
      logger.error(`Command error: ${error}`);
      await interaction.followUp(`Error: ${String(error).slice(0, 200)}`);
    }
  });

  await bot.login(DISCORD_BOT_TOKEN);
}
