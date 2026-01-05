/**
 * Real-Time Polymarket Monitor - Standalone Entry Point
 *
 * Runs the WebSocket monitoring system as a background daemon.
 * Detects unusual activity and sends Discord alerts.
 *
 * Usage:
 *   npm run daemon:start   (starts all services including this)
 *   node dist/realtime-monitor.js  (standalone)
 */

import 'dotenv/config';
import { startRealtimeMonitor, type RealtimeMonitor, type UnusualActivityAlert } from './realtime/index.js';
import { logger } from './utils/index.js';

// Configuration
const MONITORED_MARKETS: string[] = [
  // Add token IDs for markets you want to monitor in real-time
  // These can be fetched from Polymarket's API or configured via env
];

// Discord webhook for unusual activity alerts
const DISCORD_WEBHOOK_WHALE = process.env.DISCORD_WEBHOOK_WHALE;

/**
 * Send alert to Discord
 */
async function sendDiscordAlert(alert: UnusualActivityAlert): Promise<void> {
  if (!DISCORD_WEBHOOK_WHALE) {
    logger.warn('DISCORD_WEBHOOK_WHALE not configured');
    return;
  }

  const emoji = getAlertEmoji(alert.type);
  const directionEmoji = alert.direction === 'bullish' ? '🟢' : alert.direction === 'bearish' ? '🔴' : '⚪';

  const content = [
    `${emoji} **UNUSUAL ACTIVITY DETECTED** ${directionEmoji}`,
    '',
    `**Market**: ${alert.marketTitle || alert.market}`,
    `**Type**: ${formatAlertType(alert.type)}`,
    `**Magnitude**: ${alert.magnitude.toFixed(1)}σ from baseline`,
    '',
    `**Details**:`,
    `${alert.reasoning}`,
    '',
    `_Detected at ${new Date(alert.timestamp).toLocaleTimeString()}_`,
  ].join('\n');

  try {
    const response = await fetch(DISCORD_WEBHOOK_WHALE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      logger.error(`Discord webhook failed: ${response.status}`);
    }
  } catch (error) {
    logger.error(`Discord webhook error: ${error}`);
  }
}

/**
 * Get emoji for alert type
 */
function getAlertEmoji(type: string): string {
  switch (type) {
    case 'whale_entry':
      return '🐋';
    case 'flash_move':
      return '⚡';
    case 'volume_spike':
      return '📈';
    case 'spread_collapse':
      return '💥';
    case 'orderbook_imbalance':
      return '⚖️';
    default:
      return '🔔';
  }
}

/**
 * Format alert type for display
 */
function formatAlertType(type: string): string {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('Starting Real-Time Polymarket Monitor...');

  // Check for required config
  if (MONITORED_MARKETS.length === 0) {
    logger.warn('No markets configured for monitoring. Add token IDs to MONITORED_MARKETS array.');
    logger.info('Monitor will start but needs markets to be added dynamically.');
  }

  let monitor: RealtimeMonitor | null = null;

  try {
    // Start the monitor
    monitor = await startRealtimeMonitor({
      tokenIds: MONITORED_MARKETS,
      onAlert: async (alert) => {
        logger.info(`Alert: ${alert.type} on ${alert.market} (${alert.magnitude.toFixed(1)}σ)`);
        await sendDiscordAlert(alert);
      },
      autoReconnect: true,
    });

    logger.info(`Monitor started, watching ${monitor.getSubscribedCount()} markets`);

    // Keep process alive
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down...');
      monitor?.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down...');
      monitor?.stop();
      process.exit(0);
    });

    // Signal ready to PM2
    if (process.send) {
      process.send('ready');
    }

    // Periodic health check
    setInterval(() => {
      if (monitor) {
        const connected = monitor.isConnected();
        const count = monitor.getSubscribedCount();
        logger.debug(`Health check: connected=${connected}, markets=${count}`);

        // Check for unusual velocity in any markets
        const unusual = monitor.getUnusualVelocityMarkets();
        if (unusual.length > 0) {
          logger.info(`${unusual.length} markets showing unusual velocity`);
        }
      }
    }, 60000); // Every minute

  } catch (error) {
    logger.error(`Monitor startup failed: ${error}`);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
