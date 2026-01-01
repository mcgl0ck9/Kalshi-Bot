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
