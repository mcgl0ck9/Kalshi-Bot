#!/usr/bin/env node
/**
 * Kalshi Edge Detector v2
 *
 * Multi-signal edge detection for Kalshi prediction markets.
 *
 * Strategy: Hunt for edges using three converging signals:
 * 1. Cross-Platform Price Divergence - Polymarket vs Kalshi price gaps
 * 2. Sentiment-Price Divergence - News sentiment vs market price
 * 3. Whale Activity - Large positions from top traders
 *
 * Usage:
 *   npm run dev           # Watch mode for development
 *   npm run scan          # Run scan immediately
 *   npm run bot           # Start Discord bot
 */

import 'dotenv/config';
import { logger } from './utils/index.js';
import { validateConfig, BANKROLL, TIMEZONE, SCHEDULE } from './config.js';
import { runPipeline, getDivergencesReport, getStatusReport } from './pipeline.js';
import { testWebhook, startBot } from './output/index.js';
import { formatWhaleActivity, checkWhaleActivity } from './fetchers/index.js';

// =============================================================================
// CLI PARSING
// =============================================================================

interface CliArgs {
  runNow: boolean;
  test: boolean;
  bot: boolean;
  bankroll: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  return {
    runNow: args.includes('--run-now') || args.includes('--scan'),
    test: args.includes('--test'),
    bot: args.includes('--bot'),
    bankroll: (() => {
      const idx = args.indexOf('--bankroll');
      if (idx !== -1 && args[idx + 1]) {
        return parseFloat(args[idx + 1]);
      }
      return BANKROLL;
    })(),
  };
}

// =============================================================================
// SCHEDULED MODE
// =============================================================================

async function runScheduled(): Promise<void> {
  logger.info('Starting scheduler...');
  logger.info(`Schedule: ${SCHEDULE.map(s => `${s.hour}:${String(s.minute).padStart(2, '0')}`).join(', ')} ${TIMEZONE}`);

  while (true) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Check if it's time to run
    for (const scheduled of SCHEDULE) {
      if (currentHour === scheduled.hour && currentMinute === scheduled.minute) {
        logger.info(`Scheduled run at ${scheduled.hour}:${String(scheduled.minute).padStart(2, '0')}`);

        try {
          await runPipeline();
        } catch (error) {
          logger.error(`Pipeline error: ${error}`);
        }

        // Wait 61 seconds to avoid re-triggering
        await new Promise(resolve => setTimeout(resolve, 61000));
        break;
      }
    }

    // Check every 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

// =============================================================================
// BOT MODE
// =============================================================================

async function runBotMode(): Promise<void> {
  logger.info('Starting Discord bot...');

  await startBot(
    // onScan
    async () => {
      await runPipeline();
    },

    // onWhales
    async () => {
      const signals = await checkWhaleActivity();
      return formatWhaleActivity(signals);
    },

    // onDivergences
    async () => {
      return getDivergencesReport();
    },

    // onStatus
    async () => {
      return getStatusReport();
    }
  );
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  KALSHI EDGE DETECTOR v2                   ║
║         Multi-Signal Edge Detection for Kalshi             ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate config
  const configCheck = validateConfig();
  if (!configCheck.valid) {
    logger.error('Configuration errors:');
    for (const error of configCheck.errors) {
      logger.error(`  - ${error}`);
    }
    logger.info('Please check your .env file');
    process.exit(1);
  }

  // Parse CLI args
  const args = parseArgs();

  if (args.test) {
    // Test webhook
    logger.info('Testing Discord webhook...');
    const success = await testWebhook();
    process.exit(success ? 0 : 1);
  }

  if (args.bot) {
    // Start Discord bot
    await runBotMode();
    return;
  }

  if (args.runNow) {
    // Run once
    const result = await runPipeline();
    const success = result.errors.length === 0;
    process.exit(success ? 0 : 1);
  }

  // Default: run on schedule
  await runScheduled();
}

// Run
main().catch(error => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
