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
 */
export function formatEdgeAlert(opportunity: EdgeOpportunity): string {
  const { market, edge, confidence, direction, urgency, signals } = opportunity;
  const emoji = getUrgencyEmoji(urgency);

  const lines: string[] = [
    `${emoji} **${urgency.toUpperCase()} EDGE DETECTED**`,
    '',
    `**${market.title?.slice(0, 80)}**`,
    `Platform: ${market.platform} | Current: ${(market.price * 100).toFixed(0)}¢`,
    `Edge: ${(edge * 100).toFixed(1)}% | Direction: **${direction}**`,
    `Confidence: ${(confidence * 100).toFixed(0)}%`,
  ];

  // Add signal details
  if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    lines.push('');
    lines.push(`📊 Cross-Platform: Kalshi ${(cp.kalshiPrice * 100).toFixed(0)}¢ vs Poly ${(cp.polymarketPrice * 100).toFixed(0)}¢`);
  }

  if (signals.sentiment) {
    const s = signals.sentiment;
    lines.push(`📰 Sentiment: ${s.sentimentLabel} (${s.articleCount} articles)`);
  }

  if (signals.whale) {
    const w = signals.whale;
    lines.push(`🐋 Whale: ${w.whale} is ${w.sentiment}`);
  }

  // Add sizing if available
  if (opportunity.sizing && opportunity.sizing.positionSize > 0) {
    lines.push('');
    lines.push(`💰 Suggested: ${formatCurrency(opportunity.sizing.positionSize)}`);
  }

  // Add link
  if (market.url) {
    lines.push('');
    lines.push(`[View on ${market.platform}](${market.url})`);
  }

  return lines.join('\n');
}

/**
 * Format a summary report for Discord
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
  const lines: string[] = [
    '📊 **Market Intelligence Report**',
    '',
    '**Stats**',
    `Markets scanned: ${stats.totalMarkets} (Kalshi: ${stats.kalshiMarkets}, Poly: ${stats.polymarketMarkets})`,
    `Articles analyzed: ${stats.articlesAnalyzed}`,
    '',
  ];

  // Top opportunities
  if (opportunities.length > 0) {
    lines.push('**Top Opportunities**');
    for (const opp of opportunities.slice(0, 5)) {
      const emoji = getUrgencyEmoji(opp.urgency);
      lines.push(
        `${emoji} ${opp.market.title?.slice(0, 40)}... | ${(opp.edge * 100).toFixed(0)}% edge | ${opp.direction}`
      );
    }
    lines.push('');
  }

  // Top divergences
  if (divergences.length > 0) {
    lines.push('**Cross-Platform Divergences**');
    for (const div of divergences.slice(0, 3)) {
      const dir = div.polymarketMoreBullish ? 'P↑' : 'K↑';
      lines.push(
        `${dir} ${div.kalshi.title?.slice(0, 40)}... | Δ${(div.absDifference * 100).toFixed(0)}%`
      );
    }
    lines.push('');
  }

  // Whale activity
  if (whaleSignals.length > 0) {
    lines.push('**Whale Activity**');
    for (const signal of whaleSignals.slice(0, 3)) {
      const emoji = signal.sentiment === 'bullish' ? '🟢' : signal.sentiment === 'bearish' ? '🔴' : '⚪';
      lines.push(`${emoji} ${signal.whale}: ${signal.text.slice(0, 50)}...`);
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
