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
import { logger } from '../utils/index.js';
import { DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN } from '../config.js';
import {
  fetchWeekendBoxOffice,
  fetchRottenTomatoesScore,
  searchRottenTomatoes,
  formatWeekendBoxOfficeReport,
  formatMovieScore,
} from '../fetchers/entertainment.js';
import {
  formatTimeDecayInfo,
  enhanceWithTimeDecay,
} from '../edge/time-decay-edge.js';
import {
  formatLimitOrderDisplay,
  suggestLimitOrder,
} from '../models/index.js';

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
 * Clear, actionable format with specific reasoning
 */
export function formatEdgeAlert(opportunity: EdgeOpportunity): string {
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

  // Market title - include subtitle for multi-outcome markets
  if (market.subtitle) {
    lines.push(`**${market.title}**`);
    lines.push(`*Outcome: ${market.subtitle}*`);
  } else {
    lines.push(`**${market.title}**`);
  }
  lines.push('');

  // Price box
  lines.push('```');
  lines.push(`Market price: ${price.toFixed(0)}¢ YES / ${(100-price).toFixed(0)}¢ NO`);
  lines.push(`Our estimate: ${fairValue.toFixed(0)}¢ YES`);
  lines.push(`Edge:         +${(edge * 100).toFixed(1)}%`);
  lines.push('```');

  // Time decay information (if available)
  if (signals.timeDecay) {
    const td = signals.timeDecay;
    const urgencyEmoji = td.urgencyLevel === 'critical' ? '🚨'
      : td.urgencyLevel === 'high' ? '⚠️'
      : td.urgencyLevel === 'medium' ? '⏳'
      : '📅';

    const timeStr = td.daysToExpiry < 1
      ? `${Math.round(td.hoursToExpiry)}h`
      : `${Math.round(td.daysToExpiry)}d`;

    lines.push('');
    lines.push(`${urgencyEmoji} **Expires: ${timeStr}**`);

    // Show theta decay if significant
    if (td.theta > 0.05) {
      const thetaPct = (td.theta * 100).toFixed(0);
      lines.push(`📉 Theta decay: ${thetaPct}% (~${(td.thetaPerDay * 100).toFixed(2)}%/day)`);
    }

    // Adjusted edge if different from raw
    if (Math.abs(td.adjustedEdge - edge) > 0.005) {
      lines.push(`Edge after decay: +${(td.adjustedEdge * 100).toFixed(1)}%`);
    }

    // Order type recommendation
    lines.push('');
    if (td.recommendedOrderType === 'market') {
      lines.push('💡 **Recommended: MARKET ORDER**');
      lines.push('   Time is critical - prioritize fill over price');
    } else if (td.limitOrderSuggestion) {
      const limit = td.limitOrderSuggestion;
      const limitPrice = (limit.price * 100).toFixed(0);
      const fillProb = (limit.fillProbability * 100).toFixed(0);
      lines.push('💡 **Order Options:**');
      lines.push('```');
      lines.push(`MARKET @ ${price.toFixed(0)}¢  → Instant fill, full edge`);
      lines.push(`LIMIT  @ ${limitPrice}¢  → ${fillProb}% fill in ${limit.estimatedFillTime}`);
      lines.push('```');
      if (td.daysToExpiry > 3) {
        lines.push('⚠️ Capital tied up until filled or cancelled');
      }
    }
  }

  // Why this edge exists
  lines.push('');
  lines.push('**Why:**');

  if (signals.measles) {
    // Use reasoning if available (handles early-year case properly)
    if (signals.measles.reasoning) {
      lines.push(signals.measles.reasoning);
    } else if (signals.measles.weekNumber && signals.measles.weekNumber <= 8) {
      lines.push(`Week ${signals.measles.weekNumber}: Historical patterns suggest probability for ${signals.measles.threshold} threshold`);
    } else {
      lines.push(`CDC: ${signals.measles.currentCases} cases YTD -> ${signals.measles.projectedYearEnd} projected`);
      lines.push(`Threshold: ${signals.measles.threshold} cases`);
    }
  } else if (signals.fedSpeech) {
    lines.push(`Fed transcripts: "${signals.fedSpeech.keyword}" appears ${(signals.fedSpeech.historicalFrequency * 100).toFixed(0)}% of time`);
  } else if (signals.earnings) {
    lines.push(`**Bet:** Will "${signals.earnings.keyword}" be mentioned?`);
    lines.push(`Estimate: ${(signals.earnings.impliedProbability * 100).toFixed(0)}% chance of mention`);
  } else if (signals.enhancedSports) {
    const s = signals.enhancedSports;
    lines.push(`${s.awayTeam} @ ${s.homeTeam}`);
    lines.push(s.primaryReason);
  } else if (signals.sportsConsensus !== undefined) {
    lines.push(`Sportsbook consensus: ${(signals.sportsConsensus * 100).toFixed(0)}%`);
    if (signals.matchedGame) lines.push(`Game: ${signals.matchedGame}`);
  } else if (signals.macroEdge) {
    lines.push(`${signals.macroEdge.indicatorName}`);
    lines.push(signals.macroEdge.reasoning);
  } else if (signals.optionsImplied) {
    lines.push(signals.optionsImplied.reasoning);
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
  } else if (signals.recencyBias) {
    lines.push(`Market overreacted to recent news`);
    lines.push(`Price will likely revert toward base rate`);
  } else if (signals.crossPlatform) {
    const cp = signals.crossPlatform;
    lines.push(`Kalshi: ${(cp.kalshiPrice * 100).toFixed(0)}¢ vs Polymarket: ${(cp.polymarketPrice * 100).toFixed(0)}¢`);
    if (cp.kalshi.subtitle) {
      lines.push(`Outcome: "${cp.kalshi.subtitle}"`);
    }
    if (cp.polymarketMoreBullish) {
      lines.push(`Polymarket is bullish → Kalshi may be underpriced`);
    } else {
      lines.push(`Kalshi is bullish → may be overpriced`);
    }
  } else if (signals.sentiment) {
    lines.push(`Sentiment: ${signals.sentiment.sentimentLabel} (${signals.sentiment.articleCount} articles)`);
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

  // Position sizing
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

  bot.on('ready', async () => {
    logger.info(`Discord bot logged in as ${bot.user?.tag}`);

    // Register slash commands with Discord API
    if (bot.user) {
      try {
        await registerCommands(bot.user.id);
        logger.info('Slash commands registered successfully');
      } catch (error) {
        logger.error(`Failed to register slash commands: ${error}`);
      }
    }
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
