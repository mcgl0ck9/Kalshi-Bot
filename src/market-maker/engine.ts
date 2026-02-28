#!/usr/bin/env node
/**
 * Market Maker Engine
 *
 * Main orchestration loop for the Kalshi market maker.
 *
 * Lifecycle:
 *   1. Discover top 20 most liquid markets
 *   2. Every 5 seconds: check fills, update positions
 *   3. Every 30 seconds: cancel stale quotes, place fresh ones
 *   4. Graceful shutdown: cancel all open orders
 *
 * Usage:
 *   npx tsx src/market-maker/engine.ts           # Live mode
 *   npx tsx src/market-maker/engine.ts --dry-run  # Dry-run (no real orders)
 */

import 'dotenv/config';
import { discoverMarkets, type DiscoveredMarket } from './discovery.js';
import { calculateQuotes, refreshMarketPrices, type Quote, type QuoteParams } from './quoter.js';
import { placeOrder, cancelOrder, cancelAllOrders, getOpenOrders, type OpenOrder } from './kalshi-orders.js';
import { RiskManager, type TradeRecord } from './risk.js';
import { hasKalshiAuth } from '../utils/kalshi-auth.js';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface EngineConfig {
  /** Check fills interval (ms) */
  fillCheckInterval: number;
  /** Quote refresh interval (ms) */
  quoteRefreshInterval: number;
  /** Market rediscovery interval (ms) */
  discoveryInterval: number;
  /** Max markets to quote */
  maxMarkets: number;
  /** Quoting parameters */
  quoteParams: QuoteParams;
  /** Dry-run mode (log but don't trade) */
  dryRun: boolean;
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  fillCheckInterval: 5_000,        // 5 seconds
  quoteRefreshInterval: 30_000,    // 30 seconds
  discoveryInterval: 300_000,      // 5 minutes
  maxMarkets: 20,
  quoteParams: {
    baseSpreadCents: 3,
    inventoryLimit: 30,
    maxSkewCents: 4,
    volatilityWindow: 20,
  },
  dryRun: false,
};

// =============================================================================
// ENGINE
// =============================================================================

class MarketMakerEngine {
  private config: EngineConfig;
  private riskManager: RiskManager;
  private markets: DiscoveredMarket[] = [];
  private activeOrders: Map<string, OpenOrder[]> = new Map();  // ticker -> orders
  private running = false;
  private iteration = 0;
  private lastQuoteRefresh = 0;
  private lastDiscovery = 0;
  private startTime = 0;

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.riskManager = new RiskManager({
      inventoryLimit: this.config.quoteParams.inventoryLimit,
      riskLimit: 100,
    });
  }

  /**
   * Start the market maker engine.
   */
  async start(): Promise<void> {
    // Preflight checks
    if (!hasKalshiAuth()) {
      logger.error('Cannot start market maker: Kalshi auth not configured');
      logger.error('Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY in .env');
      process.exit(1);
    }

    // Check balance
    const { ok, balance } = await this.riskManager.checkBalance();
    if (!ok) {
      logger.error(`Balance too low: $${(balance / 100).toFixed(2)} (minimum $50.00)`);
      if (!this.config.dryRun) {
        process.exit(1);
      }
      logger.warn('Continuing in dry-run mode despite low balance');
    }

    logger.info(`[*] Starting Kalshi Market Maker${this.config.dryRun ? ' (DRY RUN)' : ''}`);
    logger.info(`[*] Balance: $${(balance / 100).toFixed(2)}`);
    logger.info(`[*] Config: spread=${this.config.quoteParams.baseSpreadCents}¢, limit=${this.config.quoteParams.inventoryLimit}, risk=${100}`);

    // Register shutdown handler
    this.registerShutdownHandler();

    // Initial discovery
    this.markets = await discoverMarkets(this.config.maxMarkets);
    this.lastDiscovery = Date.now();

    if (this.markets.length === 0) {
      logger.error('No liquid markets found. Exiting.');
      process.exit(1);
    }

    logger.info(`[+] Selected ${this.markets.length} markets`);

    // Sync positions
    await this.riskManager.syncPositions();

    // Start main loop
    this.running = true;
    this.startTime = Date.now();
    await this.mainLoop();
  }

  /**
   * Main loop: check fills every 5s, refresh quotes every 30s.
   */
  private async mainLoop(): Promise<void> {
    logger.info('[*] Starting main loop (Ctrl+C to stop)...');

    while (this.running) {
      this.iteration++;
      const now = Date.now();

      try {
        // --- Always: Check fills and update positions ---
        await this.checkFills();

        // --- Every 30s: Refresh quotes ---
        if (now - this.lastQuoteRefresh >= this.config.quoteRefreshInterval) {
          await this.refreshQuotes();
          this.lastQuoteRefresh = now;
        }

        // --- Every 5m: Rediscover markets ---
        if (now - this.lastDiscovery >= this.config.discoveryInterval) {
          const newMarkets = await discoverMarkets(this.config.maxMarkets);
          if (newMarkets.length > 0) {
            this.markets = newMarkets;
            logger.info(`[+] Rediscovered ${newMarkets.length} markets`);
          }
          this.lastDiscovery = now;
        }

        // Log status periodically
        if (this.iteration % 6 === 0) {  // Every 30s (6 * 5s)
          this.logStatus();
        }

      } catch (e) {
        logger.error(`Main loop error: ${e}`);
      }

      // Wait for next tick
      await new Promise(r => setTimeout(r, this.config.fillCheckInterval));
    }
  }

  /**
   * Check for fills by comparing open orders with previous state.
   */
  private async checkFills(): Promise<void> {
    const openOrders = await getOpenOrders();
    if (!openOrders) return;

    // Group by ticker
    const ordersByTicker = new Map<string, OpenOrder[]>();
    for (const order of openOrders) {
      const existing = ordersByTicker.get(order.ticker) ?? [];
      existing.push(order);
      ordersByTicker.set(order.ticker, existing);
    }

    // Detect fills: orders that were open before but now have reduced count
    for (const [ticker, prevOrders] of this.activeOrders) {
      for (const prevOrder of prevOrders) {
        const currentOrder = openOrders.find(o => o.order_id === prevOrder.order_id);

        if (!currentOrder) {
          // Order no longer open - fully filled or cancelled
          if (prevOrder.remaining_count > 0) {
            const filledQty = prevOrder.remaining_count;
            logger.info(`[FILL] ${prevOrder.action} ${filledQty}x ${ticker} ${prevOrder.side} @ ${prevOrder.yes_price}¢`);

            this.riskManager.recordTrade({
              timestamp: new Date().toISOString(),
              ticker,
              side: prevOrder.side as 'yes' | 'no',
              action: prevOrder.action as 'buy' | 'sell',
              price: prevOrder.yes_price,
              quantity: filledQty,
              orderId: prevOrder.order_id,
            });
          }
        } else if (currentOrder.remaining_count < prevOrder.remaining_count) {
          // Partially filled
          const filledQty = prevOrder.remaining_count - currentOrder.remaining_count;
          logger.info(`[PARTIAL FILL] ${prevOrder.action} ${filledQty}x ${ticker} ${prevOrder.side} @ ${prevOrder.yes_price}¢`);

          this.riskManager.recordTrade({
            timestamp: new Date().toISOString(),
            ticker,
            side: prevOrder.side as 'yes' | 'no',
            action: prevOrder.action as 'buy' | 'sell',
            price: prevOrder.yes_price,
            quantity: filledQty,
            orderId: prevOrder.order_id,
          });
        }
      }
    }

    this.activeOrders = ordersByTicker;
  }

  /**
   * Cancel all stale quotes and place fresh ones.
   */
  private async refreshQuotes(): Promise<void> {
    // Step 1: Cancel all existing orders
    const cancelCount = this.config.dryRun ? 0 : await cancelAllOrders();

    // Step 2: Refresh market prices from orderbook
    await refreshMarketPrices(this.markets);

    // Step 3: Calculate new quotes
    const inventories = this.riskManager.getAllInventories();
    const quotes = calculateQuotes(this.markets, inventories, this.config.quoteParams);

    // Step 4: Place new orders
    let placedCount = 0;
    for (const quote of quotes) {
      // Check risk before placing
      const bidCheck = this.riskManager.canTrade(quote.ticker, quote.bidQuantity);
      const askCheck = this.riskManager.canTrade(quote.ticker, quote.askQuantity);

      if (bidCheck.allowed) {
        if (this.config.dryRun) {
          logger.info(`[DRY] BID ${quote.bidQuantity}x ${quote.ticker} yes @ ${quote.bidPrice}¢`);
        } else {
          await placeOrder({
            ticker: quote.ticker,
            side: 'yes',
            action: 'buy',
            count: quote.bidQuantity,
            yes_price: quote.bidPrice,
            post_only: true,
            time_in_force: 'good_till_canceled',
          });
        }
        placedCount++;
      }

      if (askCheck.allowed) {
        // Selling YES at askPrice = buying NO at (100 - askPrice)
        if (this.config.dryRun) {
          logger.info(`[DRY] ASK ${quote.askQuantity}x ${quote.ticker} yes @ ${quote.askPrice}¢`);
        } else {
          await placeOrder({
            ticker: quote.ticker,
            side: 'no',
            action: 'buy',
            count: quote.askQuantity,
            no_price: 100 - quote.askPrice,  // Equiv to selling YES at askPrice
            post_only: true,
            time_in_force: 'good_till_canceled',
          });
        }
        placedCount++;
      }

      // Rate limit: ~8 orders/sec to stay under 10/sec basic tier
      if (!this.config.dryRun) {
        await new Promise(r => setTimeout(r, 130));
      }
    }

    logger.info(`[Iteration ${this.iteration}] Cancelled ${cancelCount}, placed ${placedCount} orders across ${quotes.length} markets`);
  }

  /**
   * Log current status.
   */
  private logStatus(): void {
    const summary = this.riskManager.getSessionSummary();
    const uptime = Math.round((Date.now() - this.startTime) / 1000);

    logger.info(`[Status] Trades: ${summary.totalTrades} | P&L: ${summary.totalPnlCents}¢ ($${(summary.totalPnlCents / 100).toFixed(2)}) | Exposure: ${summary.totalExposure} contracts | Uptime: ${uptime}s`);
  }

  /**
   * Graceful shutdown: cancel all open orders.
   */
  private registerShutdownHandler(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n[!] Received ${signal}, shutting down gracefully...`);
      this.running = false;

      if (!this.config.dryRun) {
        logger.info('[!] Cancelling all open orders...');
        const cancelled = await cancelAllOrders();
        logger.info(`[!] Cancelled ${cancelled} orders`);
      }

      // Save state
      this.riskManager.saveState();

      // Print session summary
      const summary = this.riskManager.getSessionSummary();
      logger.info('\n=== SESSION SUMMARY ===');
      logger.info(`Total trades: ${summary.totalTrades}`);
      logger.info(`Total P&L: ${summary.totalPnlCents}¢ ($${(summary.totalPnlCents / 100).toFixed(2)})`);
      logger.info(`Final exposure: ${summary.totalExposure} contracts`);

      if (summary.byMarket.length > 0) {
        logger.info('\nBy market:');
        for (const m of summary.byMarket) {
          logger.info(`  ${m.ticker}: ${m.tradeCount} trades, P&L ${m.realizedPnl}¢`);
        }
      }

      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');

  const engine = new MarketMakerEngine({ dryRun });
  await engine.start();
}

main().catch(error => {
  logger.error(`Fatal: ${error}`);
  process.exit(1);
});
