/**
 * Market Maker Risk Management
 *
 * Enforces:
 * 1. Per-market position limits
 * 2. Total portfolio risk limit
 * 3. Realized P&L tracking
 * 4. Balance floor check
 */

import { type Position, getPositions, getBalance } from './kalshi-orders.js';
import { type InventoryState } from './quoter.js';
import { logger } from '../utils/index.js';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface RiskConfig {
  /** Max contracts per market per side */
  inventoryLimit: number;
  /** Max total contracts across all markets */
  riskLimit: number;
  /** Minimum account balance (cents) before refusing to trade */
  minBalanceCents: number;
  /** Position at which we start auto-hedging */
  hedgeThreshold: number;
  /** Path to trade log file */
  tradeLogPath: string;
}

export interface TradeRecord {
  timestamp: string;
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  price: number;             // In cents
  quantity: number;
  orderId: string;
}

export interface MarketPnL {
  ticker: string;
  realizedPnl: number;      // In cents
  totalBought: number;
  totalSold: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  tradeCount: number;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: RiskConfig = {
  inventoryLimit: 30,
  riskLimit: 100,
  minBalanceCents: 5000,     // $50 minimum
  hedgeThreshold: 20,
  tradeLogPath: 'data/maker_trades.jsonl',
};

// =============================================================================
// RISK MANAGER
// =============================================================================

export class RiskManager {
  private config: RiskConfig;
  private inventories: Map<string, InventoryState> = new Map();
  private trades: TradeRecord[] = [];
  private pnlByMarket: Map<string, MarketPnL> = new Map();

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if we can place a new order for this market.
   */
  canTrade(ticker: string, quantity: number): { allowed: boolean; reason?: string } {
    // Check per-market limit
    const inventory = this.inventories.get(ticker);
    const currentPos = Math.abs(inventory?.position ?? 0);
    if (currentPos + quantity > this.config.inventoryLimit) {
      return {
        allowed: false,
        reason: `Position limit: ${currentPos}+${quantity} > ${this.config.inventoryLimit} for ${ticker}`,
      };
    }

    // Check total portfolio risk
    const totalExposure = this.getTotalExposure();
    if (totalExposure + quantity > this.config.riskLimit) {
      return {
        allowed: false,
        reason: `Risk limit: total ${totalExposure}+${quantity} > ${this.config.riskLimit}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check account balance is above minimum.
   */
  async checkBalance(): Promise<{ ok: boolean; balance: number }> {
    const balanceData = await getBalance();
    if (!balanceData) {
      return { ok: false, balance: 0 };
    }
    return {
      ok: balanceData.balance >= this.config.minBalanceCents,
      balance: balanceData.balance,
    };
  }

  /**
   * Sync positions from Kalshi API.
   */
  async syncPositions(): Promise<void> {
    const positions = await getPositions();
    this.inventories.clear();

    for (const pos of positions) {
      this.inventories.set(pos.ticker, { position: pos.position });
    }

    logger.debug(`Synced ${positions.length} positions from Kalshi`);
  }

  /**
   * Record a fill/trade.
   */
  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);

    // Update inventory
    const inv = this.inventories.get(trade.ticker) ?? { position: 0 };
    if (trade.side === 'yes' && trade.action === 'buy') {
      inv.position += trade.quantity;
    } else if (trade.side === 'yes' && trade.action === 'sell') {
      inv.position -= trade.quantity;
    } else if (trade.side === 'no' && trade.action === 'buy') {
      inv.position -= trade.quantity;
    } else if (trade.side === 'no' && trade.action === 'sell') {
      inv.position += trade.quantity;
    }
    this.inventories.set(trade.ticker, inv);

    // Update P&L tracking
    this.updatePnL(trade);

    // Append to trade log
    this.appendTradeLog(trade);
  }

  /**
   * Get inventory state for a market.
   */
  getInventory(ticker: string): InventoryState {
    return this.inventories.get(ticker) ?? { position: 0 };
  }

  /**
   * Get all inventories.
   */
  getAllInventories(): Map<string, InventoryState> {
    return this.inventories;
  }

  /**
   * Get total absolute exposure across all markets.
   */
  getTotalExposure(): number {
    let total = 0;
    for (const inv of this.inventories.values()) {
      total += Math.abs(inv.position);
    }
    return total;
  }

  /**
   * Check if any market needs auto-hedging.
   */
  getMarketsNeedingHedge(): string[] {
    const needsHedge: string[] = [];
    for (const [ticker, inv] of this.inventories) {
      if (Math.abs(inv.position) >= this.config.hedgeThreshold) {
        needsHedge.push(ticker);
      }
    }
    return needsHedge;
  }

  /**
   * Get session P&L summary.
   */
  getSessionSummary(): {
    totalTrades: number;
    totalPnlCents: number;
    byMarket: MarketPnL[];
    totalExposure: number;
  } {
    return {
      totalTrades: this.trades.length,
      totalPnlCents: Array.from(this.pnlByMarket.values()).reduce((s, p) => s + p.realizedPnl, 0),
      byMarket: Array.from(this.pnlByMarket.values()),
      totalExposure: this.getTotalExposure(),
    };
  }

  /**
   * Save state to disk for recovery.
   */
  saveState(filepath: string = 'data/maker_state.json'): void {
    const state = {
      timestamp: new Date().toISOString(),
      positions: Object.fromEntries(this.inventories),
      pnl: Object.fromEntries(this.pnlByMarket),
      totalTrades: this.trades.length,
    };

    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(state, null, 2));
    logger.debug(`Saved maker state to ${filepath}`);
  }

  // ===========================================================================
  // PRIVATE
  // ===========================================================================

  private updatePnL(trade: TradeRecord): void {
    const pnl = this.pnlByMarket.get(trade.ticker) ?? {
      ticker: trade.ticker,
      realizedPnl: 0,
      totalBought: 0,
      totalSold: 0,
      avgBuyPrice: 0,
      avgSellPrice: 0,
      tradeCount: 0,
    };

    pnl.tradeCount++;

    if (trade.action === 'buy') {
      const prevTotal = pnl.avgBuyPrice * pnl.totalBought;
      pnl.totalBought += trade.quantity;
      pnl.avgBuyPrice = pnl.totalBought > 0
        ? (prevTotal + trade.price * trade.quantity) / pnl.totalBought
        : 0;
    } else {
      const prevTotal = pnl.avgSellPrice * pnl.totalSold;
      pnl.totalSold += trade.quantity;
      pnl.avgSellPrice = pnl.totalSold > 0
        ? (prevTotal + trade.price * trade.quantity) / pnl.totalSold
        : 0;
    }

    // Realized P&L = (avg sell - avg buy) * min(bought, sold)
    const closedQuantity = Math.min(pnl.totalBought, pnl.totalSold);
    pnl.realizedPnl = Math.round((pnl.avgSellPrice - pnl.avgBuyPrice) * closedQuantity);

    this.pnlByMarket.set(trade.ticker, pnl);
  }

  private appendTradeLog(trade: TradeRecord): void {
    try {
      const dir = path.dirname(this.config.tradeLogPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        this.config.tradeLogPath,
        JSON.stringify(trade) + '\n',
      );
    } catch (e) {
      logger.debug(`Failed to write trade log: ${e}`);
    }
  }
}
