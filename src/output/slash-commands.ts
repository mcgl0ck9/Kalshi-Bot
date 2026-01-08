/**
 * Enhanced Discord Slash Commands
 *
 * Implements advanced slash commands for the Kalshi Edge Detector Bot:
 * - /portfolio - Track positions and P&L
 * - /alerts - Manage notification preferences
 * - /research - Deep dive on a market
 * - /backtest - Historical strategy validation
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type CacheType,
  EmbedBuilder,
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
import type { Market, MarketCategory, EdgeOpportunity } from '../types/index.js';

// =============================================================================
// DATA PATHS
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const PORTFOLIO_PATH = join(DATA_DIR, 'portfolio.json');
const ALERT_PREFS_PATH = join(DATA_DIR, 'alert-preferences.json');
const PREDICTIONS_PATH = join(DATA_DIR, 'predictions.json');
const PRICE_HISTORY_PATH = join(DATA_DIR, 'price-history.json');

// =============================================================================
// TYPES
// =============================================================================

export interface Position {
  id: string;
  userId: string;
  marketTicker: string;
  marketTitle: string;
  side: 'YES' | 'NO';
  amount: number;  // in cents
  entryPrice: number;  // 0-1
  timestamp: string;
  currentPrice?: number;
  resolved?: boolean;
  outcome?: 'WIN' | 'LOSS';
  pnl?: number;
}

export interface PortfolioData {
  positions: Position[];
  history: Position[];  // Closed positions
}

export interface UserAlertPreferences {
  userId: string;
  subscribedChannels: MarketCategory[];
  mutedCategories: { category: MarketCategory; muteUntil: string }[];
  edgeThreshold: number;  // Minimum edge % to receive alerts
}

export interface AlertPreferencesData {
  users: Record<string, UserAlertPreferences>;
  channels: Record<string, { subscribedUsers: string[] }>;
}

export interface BacktestResult {
  strategy: string;
  startDate: string;
  endDate: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgEdge: number;
}

// =============================================================================
// DATA HELPERS
// =============================================================================

function loadPortfolio(): PortfolioData {
  try {
    if (existsSync(PORTFOLIO_PATH)) {
      const data = readFileSync(PORTFOLIO_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Failed to load portfolio: ${error}`);
  }
  return { positions: [], history: [] };
}

function savePortfolio(data: PortfolioData): void {
  try {
    writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Failed to save portfolio: ${error}`);
  }
}

function loadAlertPreferences(): AlertPreferencesData {
  try {
    if (existsSync(ALERT_PREFS_PATH)) {
      const data = readFileSync(ALERT_PREFS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Failed to load alert preferences: ${error}`);
  }
  return { users: {}, channels: {} };
}

function saveAlertPreferences(data: AlertPreferencesData): void {
  try {
    writeFileSync(ALERT_PREFS_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error(`Failed to save alert preferences: ${error}`);
  }
}

function loadPredictions(): any[] {
  try {
    if (existsSync(PREDICTIONS_PATH)) {
      const data = readFileSync(PREDICTIONS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Failed to load predictions: ${error}`);
  }
  return [];
}

function loadPriceHistory(): Record<string, any> {
  try {
    if (existsSync(PRICE_HISTORY_PATH)) {
      const data = readFileSync(PRICE_HISTORY_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error(`Failed to load price history: ${error}`);
  }
  return {};
}

// =============================================================================
// COMMAND DEFINITIONS
// =============================================================================

/**
 * Build all enhanced slash commands
 */
export function buildEnhancedCommands(): ReturnType<SlashCommandBuilder['toJSON']>[] {
  return [
    // /portfolio command with subcommands
    new SlashCommandBuilder()
      .setName('portfolio')
      .setDescription('Track your positions and P&L')
      .addSubcommand(subcommand =>
        subcommand
          .setName('show')
          .setDescription('Display your current positions')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a new position')
          .addStringOption(option =>
            option
              .setName('market')
              .setDescription('Market ticker (e.g., KXBTC-25JAN10-B100)')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('side')
              .setDescription('YES or NO')
              .setRequired(true)
              .addChoices(
                { name: 'YES', value: 'YES' },
                { name: 'NO', value: 'NO' }
              )
          )
          .addNumberOption(option =>
            option
              .setName('amount')
              .setDescription('Amount in dollars (e.g., 100 for $100)')
              .setRequired(true)
          )
          .addNumberOption(option =>
            option
              .setName('price')
              .setDescription('Entry price in cents (e.g., 45 for 45 cents)')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('pnl')
          .setDescription('Show your P&L summary')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('close')
          .setDescription('Close a position')
          .addStringOption(option =>
            option
              .setName('position_id')
              .setDescription('Position ID to close')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('outcome')
              .setDescription('Did you win or lose?')
              .setRequired(true)
              .addChoices(
                { name: 'WIN', value: 'WIN' },
                { name: 'LOSS', value: 'LOSS' }
              )
          )
      )
      .toJSON(),

    // /alerts command with subcommands
    new SlashCommandBuilder()
      .setName('alerts')
      .setDescription('Manage your alert preferences')
      .addSubcommand(subcommand =>
        subcommand
          .setName('subscribe')
          .setDescription('Subscribe to a market category')
          .addStringOption(option =>
            option
              .setName('category')
              .setDescription('Market category to subscribe to')
              .setRequired(true)
              .addChoices(
                { name: 'Politics', value: 'politics' },
                { name: 'Crypto', value: 'crypto' },
                { name: 'Sports', value: 'sports' },
                { name: 'Entertainment', value: 'entertainment' },
                { name: 'Economics/Macro', value: 'macro' },
                { name: 'Geopolitics', value: 'geopolitics' },
                { name: 'Weather', value: 'weather' },
                { name: 'Tech', value: 'tech' },
                { name: 'All', value: 'all' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('unsubscribe')
          .setDescription('Unsubscribe from a market category')
          .addStringOption(option =>
            option
              .setName('category')
              .setDescription('Market category to unsubscribe from')
              .setRequired(true)
              .addChoices(
                { name: 'Politics', value: 'politics' },
                { name: 'Crypto', value: 'crypto' },
                { name: 'Sports', value: 'sports' },
                { name: 'Entertainment', value: 'entertainment' },
                { name: 'Economics/Macro', value: 'macro' },
                { name: 'Geopolitics', value: 'geopolitics' },
                { name: 'Weather', value: 'weather' },
                { name: 'Tech', value: 'tech' },
                { name: 'All', value: 'all' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('mute')
          .setDescription('Mute a category temporarily')
          .addStringOption(option =>
            option
              .setName('category')
              .setDescription('Category to mute')
              .setRequired(true)
              .addChoices(
                { name: 'Politics', value: 'politics' },
                { name: 'Crypto', value: 'crypto' },
                { name: 'Sports', value: 'sports' },
                { name: 'Entertainment', value: 'entertainment' },
                { name: 'Economics/Macro', value: 'macro' },
                { name: 'Geopolitics', value: 'geopolitics' },
                { name: 'Weather', value: 'weather' },
                { name: 'Tech', value: 'tech' }
              )
          )
          .addStringOption(option =>
            option
              .setName('duration')
              .setDescription('How long to mute')
              .setRequired(true)
              .addChoices(
                { name: '1 hour', value: '1h' },
                { name: '4 hours', value: '4h' },
                { name: '12 hours', value: '12h' },
                { name: '24 hours', value: '24h' },
                { name: '1 week', value: '1w' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('threshold')
          .setDescription('Set minimum edge threshold for alerts')
          .addNumberOption(option =>
            option
              .setName('edge_percent')
              .setDescription('Minimum edge percentage (e.g., 5 for 5%)')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(50)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Show your current alert preferences')
      )
      .toJSON(),

    // /research command
    new SlashCommandBuilder()
      .setName('research')
      .setDescription('Deep dive analysis on a market')
      .addStringOption(option =>
        option
          .setName('market_ticker')
          .setDescription('Market ticker (e.g., KXBTC-25JAN10-B100)')
          .setRequired(true)
      )
      .toJSON(),

    // /backtest command
    new SlashCommandBuilder()
      .setName('backtest')
      .setDescription('Run historical backtesting on a strategy')
      .addStringOption(option =>
        option
          .setName('strategy')
          .setDescription('Strategy to backtest')
          .setRequired(true)
          .addChoices(
            { name: 'Cross-Platform Arbitrage', value: 'cross-platform' },
            { name: 'Sentiment Divergence', value: 'sentiment' },
            { name: 'Whale Following', value: 'whale' },
            { name: 'Time Decay', value: 'time-decay' },
            { name: 'All Signals Combined', value: 'combined' }
          )
      )
      .addStringOption(option =>
        option
          .setName('start_date')
          .setDescription('Start date (YYYY-MM-DD)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('end_date')
          .setDescription('End date (YYYY-MM-DD)')
          .setRequired(true)
      )
      .toJSON(),
  ];
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

/**
 * Handle /portfolio command
 */
export async function handlePortfolioCommand(
  interaction: ChatInputCommandInteraction<CacheType>
): Promise<string> {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'show':
      return handlePortfolioShow(userId);

    case 'add':
      const market = interaction.options.getString('market', true);
      const side = interaction.options.getString('side', true) as 'YES' | 'NO';
      const amount = interaction.options.getNumber('amount', true);
      const price = interaction.options.getNumber('price', true);
      return handlePortfolioAdd(userId, market, side, amount, price);

    case 'pnl':
      return handlePortfolioPnl(userId);

    case 'close':
      const positionId = interaction.options.getString('position_id', true);
      const outcome = interaction.options.getString('outcome', true) as 'WIN' | 'LOSS';
      return handlePortfolioClose(userId, positionId, outcome);

    default:
      return 'Unknown subcommand';
  }
}

function handlePortfolioShow(userId: string): string {
  const portfolio = loadPortfolio();
  const userPositions = portfolio.positions.filter(p => p.userId === userId);

  if (userPositions.length === 0) {
    return '**Your Portfolio**\n\nNo open positions. Use `/portfolio add` to track a position.';
  }

  const lines: string[] = ['**Your Portfolio**\n'];

  let totalInvested = 0;
  let totalCurrentValue = 0;

  for (const pos of userPositions) {
    const invested = pos.amount;
    const currentPrice = pos.currentPrice ?? pos.entryPrice;
    const currentValue = pos.side === 'YES'
      ? pos.amount * (currentPrice / pos.entryPrice)
      : pos.amount * ((1 - currentPrice) / (1 - pos.entryPrice));

    const pnl = currentValue - invested;
    const pnlPct = (pnl / invested) * 100;
    const pnlEmoji = pnl >= 0 ? '+' : '';

    totalInvested += invested;
    totalCurrentValue += currentValue;

    lines.push(`**${pos.marketTicker}**`);
    lines.push(`  ${pos.side} @ ${(pos.entryPrice * 100).toFixed(0)} | $${invested.toFixed(0)}`);
    lines.push(`  Current: ${(currentPrice * 100).toFixed(0)} | P&L: ${pnlEmoji}$${pnl.toFixed(0)} (${pnlEmoji}${pnlPct.toFixed(1)}%)`);
    lines.push(`  ID: \`${pos.id}\``);
    lines.push('');
  }

  const totalPnl = totalCurrentValue - totalInvested;
  const totalPnlPct = (totalPnl / totalInvested) * 100;

  lines.push('---');
  lines.push(`**Total Invested:** $${totalInvested.toFixed(0)}`);
  lines.push(`**Current Value:** $${totalCurrentValue.toFixed(0)}`);
  lines.push(`**Total P&L:** ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)} (${totalPnl >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%)`);

  return lines.join('\n');
}

function handlePortfolioAdd(
  userId: string,
  market: string,
  side: 'YES' | 'NO',
  amount: number,
  price: number
): string {
  const portfolio = loadPortfolio();

  const position: Position = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    marketTicker: market.toUpperCase(),
    marketTitle: market, // Would need market lookup for full title
    side,
    amount: amount,
    entryPrice: price / 100, // Convert cents to decimal
    timestamp: new Date().toISOString(),
  };

  portfolio.positions.push(position);
  savePortfolio(portfolio);

  return `**Position Added**\n\nMarket: ${position.marketTicker}\nSide: ${side}\nAmount: $${amount}\nEntry: ${price}\nID: \`${position.id}\`\n\nUse \`/portfolio show\` to see all positions.`;
}

function handlePortfolioPnl(userId: string): string {
  const portfolio = loadPortfolio();
  const userPositions = portfolio.positions.filter(p => p.userId === userId);
  const userHistory = portfolio.history.filter(p => p.userId === userId);

  const lines: string[] = ['**P&L Summary**\n'];

  // Open positions summary
  let openPnl = 0;
  let openInvested = 0;
  for (const pos of userPositions) {
    const currentPrice = pos.currentPrice ?? pos.entryPrice;
    const currentValue = pos.side === 'YES'
      ? pos.amount * (currentPrice / pos.entryPrice)
      : pos.amount * ((1 - currentPrice) / (1 - pos.entryPrice));
    openPnl += currentValue - pos.amount;
    openInvested += pos.amount;
  }

  // Closed positions summary
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const pos of userHistory) {
    if (pos.pnl !== undefined) {
      realizedPnl += pos.pnl;
      if (pos.outcome === 'WIN') wins++;
      else losses++;
    }
  }

  lines.push('**Open Positions**');
  lines.push(`Positions: ${userPositions.length}`);
  lines.push(`Invested: $${openInvested.toFixed(0)}`);
  lines.push(`Unrealized P&L: ${openPnl >= 0 ? '+' : ''}$${openPnl.toFixed(0)}`);
  lines.push('');

  lines.push('**Closed Positions**');
  lines.push(`Total: ${userHistory.length} | Wins: ${wins} | Losses: ${losses}`);
  const winRate = userHistory.length > 0 ? (wins / userHistory.length) * 100 : 0;
  lines.push(`Win Rate: ${winRate.toFixed(1)}%`);
  lines.push(`Realized P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(0)}`);
  lines.push('');

  const totalPnl = openPnl + realizedPnl;
  lines.push('---');
  lines.push(`**Total P&L:** ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`);

  return lines.join('\n');
}

function handlePortfolioClose(
  userId: string,
  positionId: string,
  outcome: 'WIN' | 'LOSS'
): string {
  const portfolio = loadPortfolio();
  const posIndex = portfolio.positions.findIndex(
    p => p.id === positionId && p.userId === userId
  );

  if (posIndex === -1) {
    return `Position not found: \`${positionId}\`\n\nUse \`/portfolio show\` to see your positions.`;
  }

  const position = portfolio.positions[posIndex];
  position.resolved = true;
  position.outcome = outcome;

  // Calculate P&L
  if (outcome === 'WIN') {
    // If YES won and we had YES, or NO won and we had NO
    position.pnl = position.side === 'YES'
      ? position.amount * (1 / position.entryPrice - 1)
      : position.amount * (1 / (1 - position.entryPrice) - 1);
  } else {
    // Lost the position
    position.pnl = -position.amount;
  }

  // Move to history
  portfolio.history.push(position);
  portfolio.positions.splice(posIndex, 1);
  savePortfolio(portfolio);

  return `**Position Closed**\n\nMarket: ${position.marketTicker}\nOutcome: ${outcome}\nP&L: ${position.pnl >= 0 ? '+' : ''}$${position.pnl?.toFixed(0) ?? 0}`;
}

/**
 * Handle /alerts command
 */
export async function handleAlertsCommand(
  interaction: ChatInputCommandInteraction<CacheType>
): Promise<string> {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'subscribe':
      const subCategory = interaction.options.getString('category', true);
      return handleAlertsSubscribe(userId, subCategory as MarketCategory | 'all');

    case 'unsubscribe':
      const unsubCategory = interaction.options.getString('category', true);
      return handleAlertsUnsubscribe(userId, unsubCategory as MarketCategory | 'all');

    case 'mute':
      const muteCategory = interaction.options.getString('category', true);
      const duration = interaction.options.getString('duration', true);
      return handleAlertsMute(userId, muteCategory as MarketCategory, duration);

    case 'threshold':
      const edgePercent = interaction.options.getNumber('edge_percent', true);
      return handleAlertsThreshold(userId, edgePercent);

    case 'status':
      return handleAlertsStatus(userId);

    default:
      return 'Unknown subcommand';
  }
}

function handleAlertsSubscribe(userId: string, category: MarketCategory | 'all'): string {
  const prefs = loadAlertPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      userId,
      subscribedChannels: [],
      mutedCategories: [],
      edgeThreshold: 5, // Default 5%
    };
  }

  const allCategories: MarketCategory[] = [
    'politics', 'crypto', 'sports', 'entertainment', 'macro', 'geopolitics', 'weather', 'tech'
  ];

  if (category === 'all') {
    prefs.users[userId].subscribedChannels = allCategories;
  } else if (!prefs.users[userId].subscribedChannels.includes(category)) {
    prefs.users[userId].subscribedChannels.push(category);
  }

  saveAlertPreferences(prefs);

  const subscribed = prefs.users[userId].subscribedChannels.join(', ');
  return `**Subscribed to alerts**\n\nYou are now subscribed to: ${subscribed}\n\nUse \`/alerts status\` to see all preferences.`;
}

function handleAlertsUnsubscribe(userId: string, category: MarketCategory | 'all'): string {
  const prefs = loadAlertPreferences();

  if (!prefs.users[userId]) {
    return 'You have no subscriptions. Use `/alerts subscribe` to start.';
  }

  if (category === 'all') {
    prefs.users[userId].subscribedChannels = [];
  } else {
    prefs.users[userId].subscribedChannels = prefs.users[userId].subscribedChannels.filter(
      c => c !== category
    );
  }

  saveAlertPreferences(prefs);

  const remaining = prefs.users[userId].subscribedChannels;
  if (remaining.length === 0) {
    return '**Unsubscribed**\n\nYou are no longer subscribed to any categories.';
  }
  return `**Unsubscribed from ${category}**\n\nRemaining subscriptions: ${remaining.join(', ')}`;
}

function handleAlertsMute(userId: string, category: MarketCategory, duration: string): string {
  const prefs = loadAlertPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      userId,
      subscribedChannels: [],
      mutedCategories: [],
      edgeThreshold: 5,
    };
  }

  // Calculate mute end time
  const now = new Date();
  let muteUntil: Date;
  switch (duration) {
    case '1h': muteUntil = new Date(now.getTime() + 60 * 60 * 1000); break;
    case '4h': muteUntil = new Date(now.getTime() + 4 * 60 * 60 * 1000); break;
    case '12h': muteUntil = new Date(now.getTime() + 12 * 60 * 60 * 1000); break;
    case '24h': muteUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000); break;
    case '1w': muteUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); break;
    default: muteUntil = new Date(now.getTime() + 60 * 60 * 1000);
  }

  // Remove existing mute for this category if present
  prefs.users[userId].mutedCategories = prefs.users[userId].mutedCategories.filter(
    m => m.category !== category
  );

  prefs.users[userId].mutedCategories.push({
    category,
    muteUntil: muteUntil.toISOString(),
  });

  saveAlertPreferences(prefs);

  return `**Muted ${category}**\n\nYou will not receive ${category} alerts until ${muteUntil.toLocaleString()}`;
}

function handleAlertsThreshold(userId: string, edgePercent: number): string {
  const prefs = loadAlertPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      userId,
      subscribedChannels: [],
      mutedCategories: [],
      edgeThreshold: edgePercent,
    };
  } else {
    prefs.users[userId].edgeThreshold = edgePercent;
  }

  saveAlertPreferences(prefs);

  return `**Edge Threshold Updated**\n\nYou will only receive alerts for edges >= ${edgePercent}%`;
}

function handleAlertsStatus(userId: string): string {
  const prefs = loadAlertPreferences();
  const userPrefs = prefs.users[userId];

  if (!userPrefs) {
    return '**Alert Preferences**\n\nNo preferences set. Use `/alerts subscribe` to get started.';
  }

  const lines: string[] = ['**Your Alert Preferences**\n'];

  // Subscriptions
  if (userPrefs.subscribedChannels.length > 0) {
    lines.push(`**Subscribed:** ${userPrefs.subscribedChannels.join(', ')}`);
  } else {
    lines.push('**Subscribed:** None');
  }

  // Mutes (filter expired ones)
  const now = new Date();
  const activeMutes = userPrefs.mutedCategories.filter(
    m => new Date(m.muteUntil) > now
  );
  if (activeMutes.length > 0) {
    lines.push('');
    lines.push('**Muted:**');
    for (const mute of activeMutes) {
      lines.push(`  - ${mute.category} until ${new Date(mute.muteUntil).toLocaleString()}`);
    }
  }

  // Threshold
  lines.push('');
  lines.push(`**Minimum Edge:** ${userPrefs.edgeThreshold}%`);

  return lines.join('\n');
}

/**
 * Handle /research command
 */
export async function handleResearchCommand(
  interaction: ChatInputCommandInteraction<CacheType>,
  getMarketData: (ticker: string) => Promise<Market | null>,
  getWhalePositions: (ticker: string) => Promise<any[]>
): Promise<string> {
  const ticker = interaction.options.getString('market_ticker', true).toUpperCase();

  // Try to find the market
  const market = await getMarketData(ticker);

  if (!market) {
    return `**Market Not Found**\n\nCould not find market with ticker: \`${ticker}\`\n\nTry using the full Kalshi ticker (e.g., KXBTC-25JAN10-B100)`;
  }

  const lines: string[] = [];

  // Header
  lines.push(`**Deep Dive: ${market.title}**`);
  if (market.subtitle) {
    lines.push(`*${market.subtitle}*`);
  }
  lines.push('');

  // Current Market Data
  lines.push('**Current Market Data**');
  lines.push('```');
  lines.push(`Price:      ${(market.price * 100).toFixed(0)} YES / ${((1 - market.price) * 100).toFixed(0)} NO`);
  if (market.volume24h) {
    lines.push(`24h Volume: $${market.volume24h.toLocaleString()}`);
  }
  if (market.liquidity) {
    lines.push(`Liquidity:  $${market.liquidity.toLocaleString()}`);
  }
  if (market.closeTime) {
    const closeDate = new Date(market.closeTime);
    const daysToExpiry = Math.ceil((closeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    lines.push(`Expires:    ${closeDate.toLocaleDateString()} (${daysToExpiry} days)`);
  }
  lines.push('```');

  // Historical Accuracy (from predictions.json)
  const predictions = loadPredictions();
  const marketPredictions = predictions.filter((p: any) =>
    p.ticker === ticker || p.marketId === market.id
  );

  if (marketPredictions.length > 0) {
    lines.push('');
    lines.push('**Historical Signals**');
    const resolvedPredictions = marketPredictions.filter((p: any) => p.resolved);
    const correctPredictions = resolvedPredictions.filter((p: any) => p.correct);
    const accuracy = resolvedPredictions.length > 0
      ? (correctPredictions.length / resolvedPredictions.length * 100).toFixed(1)
      : 'N/A';
    lines.push(`Past signals: ${marketPredictions.length} | Resolved: ${resolvedPredictions.length} | Accuracy: ${accuracy}%`);
  }

  // Price History
  const priceHistory = loadPriceHistory();
  const marketHistory = priceHistory[ticker] || priceHistory[market.id];

  if (marketHistory && marketHistory.snapshots && marketHistory.snapshots.length > 0) {
    lines.push('');
    lines.push('**Price History (7d)**');
    const snapshots = marketHistory.snapshots.slice(-7);
    const startPrice = snapshots[0]?.price ?? market.price;
    const priceChange = market.price - startPrice;
    const priceChangePct = (priceChange / startPrice) * 100;
    lines.push(`7d change: ${priceChange >= 0 ? '+' : ''}${(priceChange * 100).toFixed(0)} (${priceChange >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}%)`);
  }

  // Whale Positions (if available)
  try {
    const whalePositions = await getWhalePositions(ticker);
    if (whalePositions && whalePositions.length > 0) {
      lines.push('');
      lines.push('**Whale Positions**');
      for (const whale of whalePositions.slice(0, 5)) {
        lines.push(`- ${whale.name || whale.address?.slice(0, 8)}: ${whale.side} $${whale.amount?.toLocaleString() ?? 'N/A'}`);
      }
    }
  } catch {
    // Whale data not available
  }

  // Trade Link
  lines.push('');
  if (market.url) {
    lines.push(`[Trade on Kalshi](${market.url})`);
  }

  return lines.join('\n');
}

/**
 * Handle /backtest command
 */
export async function handleBacktestCommand(
  interaction: ChatInputCommandInteraction<CacheType>
): Promise<string> {
  const strategy = interaction.options.getString('strategy', true);
  const startDate = interaction.options.getString('start_date', true);
  const endDate = interaction.options.getString('end_date', true);

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return '**Invalid Date Format**\n\nPlease use YYYY-MM-DD format (e.g., 2025-01-01)';
  }

  if (start >= end) {
    return '**Invalid Date Range**\n\nStart date must be before end date';
  }

  // Load historical predictions
  const predictions = loadPredictions();

  // Filter predictions by date range
  const filteredPredictions = predictions.filter((p: any) => {
    const predDate = new Date(p.timestamp || p.createdAt);
    return predDate >= start && predDate <= end;
  });

  // Filter by strategy
  let strategyPredictions = filteredPredictions;
  if (strategy !== 'combined') {
    strategyPredictions = filteredPredictions.filter((p: any) => {
      if (strategy === 'cross-platform') return p.source === 'cross-platform';
      if (strategy === 'sentiment') return p.source === 'sentiment';
      if (strategy === 'whale') return p.source === 'whale';
      if (strategy === 'time-decay') return p.signals?.timeDecay;
      return true;
    });
  }

  // Calculate backtest results
  const resolved = strategyPredictions.filter((p: any) => p.resolved);
  const wins = resolved.filter((p: any) => p.correct);
  const losses = resolved.filter((p: any) => !p.correct);

  if (resolved.length === 0) {
    return `**Backtest Results: ${strategy}**\n\n${startDate} to ${endDate}\n\nNo resolved predictions found in this period for the ${strategy} strategy.\n\nTotal unresolved signals: ${strategyPredictions.length}`;
  }

  const winRate = wins.length / resolved.length;
  let totalProfit = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;
  let peak = 0;
  let totalEdge = 0;

  for (const pred of resolved) {
    const pnl = pred.correct
      ? (pred.edge ?? 0.05) * 100 // Win the edge
      : -100; // Lose the stake

    totalProfit += pnl;
    runningPnl += pnl;
    peak = Math.max(peak, runningPnl);
    maxDrawdown = Math.max(maxDrawdown, peak - runningPnl);
    totalEdge += pred.edge ?? 0;
  }

  const avgEdge = totalEdge / resolved.length;
  const sharpeRatio = resolved.length > 1
    ? (totalProfit / resolved.length) / Math.sqrt(resolved.length)
    : 0;

  const lines: string[] = [
    `**Backtest Results: ${strategy}**`,
    `${startDate} to ${endDate}`,
    '',
    '```',
    `Trades:       ${resolved.length}`,
    `Wins:         ${wins.length}`,
    `Losses:       ${losses.length}`,
    `Win Rate:     ${(winRate * 100).toFixed(1)}%`,
    '',
    `Total Profit: ${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(0)}`,
    `Max Drawdown: $${maxDrawdown.toFixed(0)}`,
    `Sharpe Ratio: ${sharpeRatio.toFixed(2)}`,
    `Avg Edge:     ${(avgEdge * 100).toFixed(1)}%`,
    '```',
  ];

  // Performance analysis
  lines.push('');
  if (winRate >= 0.55) {
    lines.push('**Analysis:** Strong edge detected. Strategy is profitable.');
  } else if (winRate >= 0.45) {
    lines.push('**Analysis:** Marginal edge. Consider combining with other signals.');
  } else {
    lines.push('**Analysis:** Negative expectancy. Review strategy parameters.');
  }

  return lines.join('\n');
}

/**
 * Check if a user should receive an alert based on their preferences
 */
export function shouldReceiveAlert(
  userId: string,
  category: MarketCategory,
  edge: number
): boolean {
  const prefs = loadAlertPreferences();
  const userPrefs = prefs.users[userId];

  if (!userPrefs) return false;

  // Check subscriptions
  if (!userPrefs.subscribedChannels.includes(category)) {
    return false;
  }

  // Check mutes (filter expired)
  const now = new Date();
  const isMuted = userPrefs.mutedCategories.some(
    m => m.category === category && new Date(m.muteUntil) > now
  );
  if (isMuted) return false;

  // Check threshold
  if (edge * 100 < userPrefs.edgeThreshold) {
    return false;
  }

  return true;
}

/**
 * Get all users who should receive an alert
 */
export function getUsersForAlert(category: MarketCategory, edge: number): string[] {
  const prefs = loadAlertPreferences();
  const eligibleUsers: string[] = [];

  for (const userId of Object.keys(prefs.users)) {
    if (shouldReceiveAlert(userId, category, edge)) {
      eligibleUsers.push(userId);
    }
  }

  return eligibleUsers;
}
