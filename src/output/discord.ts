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
 * Enhanced with clear position guidance and action-oriented formatting
 */
export function formatEdgeAlert(opportunity: EdgeOpportunity): string {
  const { market, edge, confidence, direction, urgency, signals } = opportunity;
  const emoji = getUrgencyEmoji(urgency);

  // Determine action color and symbol
  const isYes = direction === 'BUY YES';
  const actionEmoji = isYes ? '🟢' : '🔴';
  const actionVerb = isYes ? 'BUY YES' : 'BUY NO';

  // Calculate fair value (current price + edge)
  const currentPrice = market.price * 100;
  const fairValue = isYes ? currentPrice + (edge * 100) : currentPrice - (edge * 100);

  const lines: string[] = [
    `${emoji} **${urgency.toUpperCase()} EDGE DETECTED**`,
    '',
    `**${market.title?.slice(0, 80)}**`,
    '',
    // ═══════════════════════════════════════════════════════════════════
    // PROMINENT ACTION SECTION
    // ═══════════════════════════════════════════════════════════════════
    '```',
    `${actionEmoji} ACTION: ${actionVerb} @ ${currentPrice.toFixed(0)}¢`,
    '```',
    '',
    // Pricing breakdown
    `📍 **Current Price:** ${currentPrice.toFixed(0)}¢`,
    `📊 **Fair Value:** ${fairValue.toFixed(0)}¢`,
    `📈 **Edge:** +${(edge * 100).toFixed(1)}%`,
    `🎯 **Confidence:** ${(confidence * 100).toFixed(0)}%`,
    '',
  ];

  // ═══════════════════════════════════════════════════════════════════
  // SIGNAL EXPLANATIONS - WHY we think this is mispriced
  // ═══════════════════════════════════════════════════════════════════
  lines.push('**Why this edge exists:**');

  if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    const kalshiP = (cp.kalshiPrice * 100).toFixed(0);
    const polyP = (cp.polymarketPrice * 100).toFixed(0);
    const cheaper = cp.kalshiPrice < cp.polymarketPrice ? 'Kalshi' : 'Polymarket';
    lines.push(`• Cross-platform divergence: Kalshi ${kalshiP}¢ vs Poly ${polyP}¢ (${cheaper} is cheaper)`);
  }

  if (signals.sentiment) {
    const s = signals.sentiment;
    const sentimentDir = s.sentimentLabel === 'bullish' ? 'positive' : s.sentimentLabel === 'bearish' ? 'negative' : 'neutral';
    lines.push(`• News sentiment is ${sentimentDir} (${s.articleCount} articles) but price hasn't adjusted`);
  }

  if (signals.whale) {
    const w = signals.whale;
    lines.push(`• Whale activity: ${w.whale} showing ${w.sentiment} conviction`);
  }

  if (signals.sportsConsensus !== undefined) {
    const consensus = (signals.sportsConsensus * 100).toFixed(0);
    lines.push(`• Sportsbook consensus: ${consensus}% (sharper money says this is mispriced)`);
    if (signals.matchedGame) {
      lines.push(`• Game: ${signals.matchedGame}`);
    }
  }

  if (signals.fedRegime) {
    lines.push(`• Fed regime bias: ${signals.fedRegime} (historical FedWatch adjustment)`);
  }

  if (signals.injuryOverreaction) {
    lines.push(`• Injury overreaction detected: market moved too far on injury news`);
  }

  if (signals.weatherBias) {
    lines.push(`• Weather forecast bias: ${signals.weatherBias} (climatological adjustment)`);
  }

  if (signals.recencyBias) {
    lines.push(`• Recency bias: price overreacted vs base rates`);
  }

  // Add sizing if available
  if (opportunity.sizing && opportunity.sizing.positionSize > 0) {
    lines.push('');
    lines.push('**Position Sizing:**');
    lines.push(`• Suggested size: **${formatCurrency(opportunity.sizing.positionSize)}**`);
    if (opportunity.sizing.kellyFraction) {
      lines.push(`• Kelly fraction: ${(opportunity.sizing.kellyFraction * 100).toFixed(1)}%`);
    }
  }

  // Platform and link
  lines.push('');
  lines.push(`Platform: **${market.platform?.toUpperCase() ?? 'UNKNOWN'}**`);
  if (market.url) {
    lines.push(`[>>> TRADE NOW <<<](${market.url})`);
  }

  return lines.join('\n');
}

/**
 * Format a summary report for Discord
 * Enhanced with clear action items and position guidance
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
    '📊 **MARKET INTELLIGENCE REPORT**',
    `_${now} ET_`,
    '',
    '═══════════════════════════════════════',
    '',
  ];

  // Quick stats
  lines.push('**Scan Summary:**');
  lines.push(`• Markets: ${stats.totalMarkets} (Kalshi: ${stats.kalshiMarkets}, Poly: ${stats.polymarketMarkets})`);
  lines.push(`• Articles: ${stats.articlesAnalyzed}`);
  lines.push(`• Edges found: ${opportunities.length}`);
  lines.push('');

  // ═══════════════════════════════════════════════════════════════════
  // ACTIONABLE OPPORTUNITIES - Most important section
  // ═══════════════════════════════════════════════════════════════════
  if (opportunities.length > 0) {
    lines.push('═══════════════════════════════════════');
    lines.push('**🎯 ACTIONABLE OPPORTUNITIES**');
    lines.push('');

    for (const opp of opportunities.slice(0, 5)) {
      const emoji = getUrgencyEmoji(opp.urgency);
      const actionEmoji = opp.direction === 'BUY YES' ? '🟢' : '🔴';
      const price = (opp.market.price * 100).toFixed(0);
      const edgePct = (opp.edge * 100).toFixed(0);

      lines.push(`${emoji} **${opp.market.title?.slice(0, 50)}**`);
      lines.push(`   ${actionEmoji} ${opp.direction} @ ${price}¢ | Edge: ${edgePct}% | Conf: ${(opp.confidence * 100).toFixed(0)}%`);

      if (opp.sizing && opp.sizing.positionSize > 0) {
        lines.push(`   💰 Size: ${formatCurrency(opp.sizing.positionSize)}`);
      }
      if (opp.market.url) {
        lines.push(`   [Trade](${opp.market.url})`);
      }
      lines.push('');
    }
  } else {
    lines.push('_No actionable edges found this scan._');
    lines.push('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // CROSS-PLATFORM DIVERGENCES
  // ═══════════════════════════════════════════════════════════════════
  if (divergences.length > 0) {
    lines.push('═══════════════════════════════════════');
    lines.push('**📊 CROSS-PLATFORM DIVERGENCES**');
    lines.push('');

    for (const div of divergences.slice(0, 3)) {
      const kalshiP = (div.kalshi.price * 100).toFixed(0);
      const polyP = (div.polymarket.price * 100).toFixed(0);
      const diffPct = (div.absDifference * 100).toFixed(0);
      const cheaper = div.kalshi.price < div.polymarket.price ? 'Kalshi' : 'Poly';
      const actionEmoji = div.polymarketMoreBullish ? '🔴' : '🟢';

      lines.push(`${actionEmoji} **${div.kalshi.title?.slice(0, 45)}**`);
      lines.push(`   K: ${kalshiP}¢ vs P: ${polyP}¢ (Δ${diffPct}%) - Buy YES on ${cheaper}`);
      lines.push('');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // WHALE ACTIVITY
  // ═══════════════════════════════════════════════════════════════════
  if (whaleSignals.length > 0) {
    lines.push('═══════════════════════════════════════');
    lines.push('**🐋 WHALE ACTIVITY**');
    lines.push('');

    for (const signal of whaleSignals.slice(0, 3)) {
      const emoji = signal.sentiment === 'bullish' ? '🟢' : signal.sentiment === 'bearish' ? '🔴' : '⚪';
      lines.push(`${emoji} **${signal.whale}** (${signal.sentiment})`);
      lines.push(`   "${signal.text.slice(0, 60)}..."`);
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════');

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
