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
  broadcast,
  routeSignal,
  sendEdgeAlert,
  sendMacroAlert,
  sendNewMarketAlert,
  sendMetaAlert,
  sendDailyDigest,
  sendStatusUpdate,
} from './channels.js';
