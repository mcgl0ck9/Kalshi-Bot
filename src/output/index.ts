/**
 * Output module exports
 */

export {
  sendWebhookMessage,
  testWebhook,
  formatEdgeAlert,
  formatSummaryReport,
  createBot,
  registerCommands,
  startBot,
} from './discord.js';

// Multi-channel Discord output
export {
  initializeChannels,
  getChannelConfig,
  sendToChannel,
  routeOpportunity,
  sendEdgeAlert,
  sendMacroAlert,
  sendNewMarketAlert,
  sendDailyDigest,
  sendStatusUpdate,
  clearSentMarketsCache,
} from './channels.js';

// Enhanced slash commands
export {
  buildEnhancedCommands,
  handlePortfolioCommand,
  handleAlertsCommand,
  handleResearchCommand,
  handleBacktestCommand,
  shouldReceiveAlert,
  getUsersForAlert,
  type Position,
  type PortfolioData,
  type UserAlertPreferences,
  type AlertPreferencesData,
  type BacktestResult,
} from './slash-commands.js';
