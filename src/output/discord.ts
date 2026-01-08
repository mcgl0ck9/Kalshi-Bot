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
import type { EdgeOpportunity, CrossPlatformMatch, TopicSentiment, WhaleSignal, Market } from '../types/index.js';
import { logger } from '../utils/index.js';
import { DISCORD_WEBHOOK_URL, DISCORD_BOT_TOKEN } from '../config.js';
import {
  fetchWeekendBoxOffice,
  fetchRottenTomatoesScore,
  searchRottenTomatoes,
  formatWeekendBoxOfficeReport,
  formatMovieScore,
} from '../fetchers/_legacy/entertainment.js';
import {
  formatTimeDecayInfo,
  enhanceWithTimeDecay,
} from '../models/index.js';
import {
  formatLimitOrderDisplay,
  suggestLimitOrder,
} from '../models/index.js';
import {
  buildEnhancedCommands,
  handlePortfolioCommand,
  handleAlertsCommand,
  handleResearchCommand,
  handleBacktestCommand,
} from './slash-commands.js';

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

    // Plain English time pressure explanation (no options jargon)
    if (td.theta > 0.05) {
      // Translate theta into plain English based on urgency
      if (td.urgencyLevel === 'critical') {
        lines.push('⚡ **Time pressure: HIGH** - Edge shrinks quickly as expiry approaches');
        lines.push(`   Edge decays ~${(td.thetaPerDay * 100).toFixed(1)}% per day`);
      } else if (td.urgencyLevel === 'high') {
        lines.push('⏰ **Time pressure: MODERATE** - Don\'t wait too long to act');
        lines.push(`   Edge decays ~${(td.thetaPerDay * 100).toFixed(1)}% per day`);
      } else {
        lines.push('📆 **Time pressure: LOW** - Plenty of time, can use limit orders');
      }
    }

    // Adjusted edge if different from raw (plain language)
    if (Math.abs(td.adjustedEdge - edge) > 0.005) {
      lines.push(`   (Accounting for time, effective edge is +${(td.adjustedEdge * 100).toFixed(1)}%)`);
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

    // Only show real RT data - no speculation
    if (ent.currentScore !== undefined && ent.reviewCount !== undefined && ent.reviewCount > 0) {
      const scoreIcon = ent.currentScore >= 60 ? '🍅' : '🤢';

      lines.push(`${scoreIcon} **Current RT Score: ${ent.currentScore}%**`);
      lines.push(`   Based on ${ent.reviewCount} critic reviews`);
      lines.push('');

      // Clear explanation of the edge
      if (ent.buffer > 0) {
        lines.push(`📊 **The math:**`);
        lines.push(`   Market threshold: ${ent.threshold}%`);
        lines.push(`   Current score: ${ent.currentScore}% (${ent.buffer} points ABOVE)`);
        lines.push('');
        if (ent.buffer >= 10) {
          lines.push(`✅ **Strong edge**: Score is ${ent.buffer} points above threshold.`);
          lines.push(`   RT scores rarely drop 10+ points with ${ent.reviewCount}+ reviews.`);
        } else if (ent.buffer >= 5) {
          lines.push(`✅ **Moderate edge**: Score has ${ent.buffer} point cushion.`);
          lines.push(`   Would need ${ent.buffer + 1}+ negative reviews to drop below.`);
        } else {
          lines.push(`⚠️ **Thin margin**: Only ${ent.buffer} points above threshold.`);
          lines.push(`   Could swing with a few negative reviews.`);
        }
      } else {
        const pointsBelow = Math.abs(ent.buffer);
        lines.push(`📊 **The math:**`);
        lines.push(`   Market threshold: ${ent.threshold}%`);
        lines.push(`   Current score: ${ent.currentScore}% (${pointsBelow} points BELOW)`);
        lines.push('');
        lines.push(`❌ **Why it's unlikely to rise:**`);
        lines.push(`   RT scores typically DROP over time as more critics review.`);
        lines.push(`   Would need unusually positive late reviews to gain ${pointsBelow}+ points.`);
      }

      lines.push('');
      lines.push(`_Source: Rotten Tomatoes (${ent.reviewCount} reviews)_`);
    } else {
      // No actual data - shouldn't happen but fallback
      lines.push(`⚠️ No RT score data available yet`);
      lines.push(`Movie may not be released or reviewed`);
    }
  } else if (signals.cryptoPrice) {
    // Crypto price bucket edge with current spot price context
    const crypto = signals.cryptoPrice;
    const priceStr = crypto.currentPrice.toLocaleString();
    const thresholdStr = crypto.threshold.toLocaleString();
    const diff = Math.abs(crypto.currentPrice - crypto.threshold);
    const diffPct = ((diff / crypto.threshold) * 100).toFixed(1);
    const above = crypto.currentPrice > crypto.threshold;

    const symbol = crypto.symbol === 'BTC' ? '₿' : 'Ξ';
    lines.push(`${symbol} **${crypto.symbol} Current Price: $${priceStr}**`);
    lines.push('');

    // Clear explanation based on current price vs threshold
    if (above) {
      lines.push(`📊 **The math:**`);
      lines.push(`   Market threshold: $${thresholdStr}`);
      lines.push(`   Current price: $${priceStr} (**${diffPct}% ABOVE**)`);
      lines.push('');
      if (crypto.daysToExpiry <= 1) {
        lines.push(`✅ **Strong edge**: Price is $${diff.toLocaleString()} above threshold.`);
        lines.push(`   With <24h to expiry, ${diffPct}% move down is very unlikely.`);
      } else if (diff / crypto.currentPrice > 0.05) {
        lines.push(`✅ **Solid edge**: Price has ${diffPct}% cushion above threshold.`);
        lines.push(`   Would need a ${diffPct}%+ drop in ${crypto.daysToExpiry} days.`);
      } else {
        lines.push(`⚠️ **Thin margin**: Only ${diffPct}% above threshold.`);
        lines.push(`   Crypto volatility could close this gap.`);
      }
    } else {
      lines.push(`📊 **The math:**`);
      lines.push(`   Market threshold: $${thresholdStr}`);
      lines.push(`   Current price: $${priceStr} (**${diffPct}% BELOW**)`);
      lines.push('');
      if (crypto.daysToExpiry <= 1) {
        lines.push(`❌ **Low probability**: Price is $${diff.toLocaleString()} below threshold.`);
        lines.push(`   Would need ${diffPct}%+ rally in <24h - very unlikely.`);
      } else {
        lines.push(`❌ **Uphill climb**: Price needs ${diffPct}%+ rally.`);
        lines.push(`   ${crypto.daysToExpiry} days may not be enough for such a move.`);
      }
    }

    // Show probability assessment
    lines.push('');
    const impliedPct = (crypto.impliedProb * 100).toFixed(0);
    const marketPct = (crypto.marketPrice * 100).toFixed(0);
    lines.push(`Model estimate: ${impliedPct}% vs market ${marketPct}%`);

    // Show secondary signals if present
    if (crypto.fundingSignal) {
      lines.push(`📈 ${crypto.fundingSignal}`);
    }
    if (crypto.fearGreedSignal) {
      lines.push(`😱 ${crypto.fearGreedSignal}`);
    }

    lines.push('');
    lines.push(`_Source: CoinGecko spot price, live data_`);
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
  } else if (signals.weather) {
    // Premium weather alert with full evidence
    const w = signals.weather;
    const weatherIcon = w.measurementType === 'snow' ? '❄️' :
                        w.measurementType === 'rain' ? '🌧️' : '🌡️';

    // Show the specific bucket they should bet on
    if (w.bucket) {
      lines.push(`**${weatherIcon} Bucket: ${w.bucket}**`);
      if (w.ticker) {
        lines.push(`Ticker: \`${w.ticker}\``);
      }
    }
    lines.push('');

    // Evidence box - show the data sources
    lines.push('**📊 Evidence:**');
    lines.push('```');
    lines.push(`Month-to-date: ${w.monthToDate.toFixed(1)} ${w.unit}`);
    lines.push(`Days remaining: ${w.daysRemaining}`);
    lines.push(`Historical avg: ${w.historicalAverage.toFixed(1)} ${w.unit}/month`);
    lines.push(`Variability:   ±${w.historicalStdDev.toFixed(1)} ${w.unit} (std dev)`);
    lines.push('```');

    // Probability comparison
    lines.push('');
    lines.push('**🎯 Analysis:**');
    const ourProb = w.climatologicalProb * 100;
    const marketProb = w.marketPrice * 100;
    const probDiff = Math.abs(ourProb - marketProb);
    lines.push(`Our estimate: ${ourProb.toFixed(0)}% chance of >${w.threshold}${w.unit}`);
    lines.push(`Market price: ${marketProb.toFixed(0)}%`);
    lines.push(`Gap: ${probDiff.toFixed(0)} percentage points`);

    // Plain English explanation
    lines.push('');
    if (w.measurementType === 'snow') {
      const needed = w.threshold - w.monthToDate;
      if (needed > 0) {
        lines.push(`💡 ${w.city} needs ${needed.toFixed(1)}" more snow in ${w.daysRemaining} days.`);
        if (needed > w.historicalAverage * 0.8) {
          lines.push(`   That's a LOT - historical avg is only ${w.historicalAverage.toFixed(1)}"/month.`);
        } else if (needed < w.historicalAverage * 0.3) {
          lines.push(`   Very achievable - avg is ${w.historicalAverage.toFixed(1)}"/month.`);
        }
      } else {
        lines.push(`💡 ${w.city} already has ${w.monthToDate.toFixed(1)}" - threshold met!`);
      }
    }

    // Data source attribution
    lines.push('');
    lines.push('_Source: NOAA 30-year climate normals + Open-Meteo MTD_');
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

  // Basic commands
  const basicCommands = [
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

  // Enhanced commands from slash-commands.ts
  const enhancedCommands = buildEnhancedCommands();

  // Combine all commands
  const commands = [...basicCommands, ...enhancedCommands];

  const rest = new REST().setToken(DISCORD_BOT_TOKEN);

  try {
    logger.info(`Registering ${commands.length} slash commands...`);
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
    logger.info(`Registered ${commands.length} slash commands successfully`);
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
  onStatus: () => Promise<string>,
  onGetMarket?: (ticker: string) => Promise<Market | null>,
  onGetWhalePositions?: (ticker: string) => Promise<any[]>
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
          await interaction.followUp('Starting market scan...');
          await onScan();
          await interaction.followUp('Scan complete! Check the channel for results.');
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

        // =================================================================
        // ENHANCED COMMANDS (from slash-commands.ts)
        // =================================================================

        case 'portfolio':
          const portfolioMsg = await handlePortfolioCommand(interaction);
          await interaction.followUp(portfolioMsg.slice(0, 2000));
          break;

        case 'alerts':
          const alertsMsg = await handleAlertsCommand(interaction);
          await interaction.followUp(alertsMsg.slice(0, 2000));
          break;

        case 'research':
          // Use provided callbacks or fallback to stub implementations
          const getMarket = onGetMarket ?? (async () => null);
          const getWhalePositions = onGetWhalePositions ?? (async () => []);
          const researchMsg = await handleResearchCommand(interaction, getMarket, getWhalePositions);
          await interaction.followUp(researchMsg.slice(0, 2000));
          break;

        case 'backtest':
          const backtestMsg = await handleBacktestCommand(interaction);
          await interaction.followUp(backtestMsg.slice(0, 2000));
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
