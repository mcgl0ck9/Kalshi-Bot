/**
 * Unusual Activity Detection for Polymarket
 *
 * Detects anomalous market behavior that may indicate:
 * - Whale entries (large position builds)
 * - Flash moves (sudden price spikes)
 * - Volume spikes (unusual trading activity)
 * - Spread collapses (liquidity changes)
 *
 * Based on:
 * - Order flow imbalance research (arXiv:2004.08290)
 * - VPIN toxicity detection
 * - Market microstructure analysis
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/index.js';
import type { OrderbookUpdate, TradeUpdate, PriceChangeEvent } from './polymarket-stream.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface UnusualActivityConfig {
  // Flash move detection
  flashMoveThresholdPercent: number;    // Price move % in window
  flashMoveWindowMs: number;            // Time window for flash detection

  // Volume spike detection
  volumeSpikeMultiple: number;          // Multiple of average volume
  volumeWindowMs: number;               // Window for volume averaging

  // Whale detection
  whalePositionUsd: number;             // Minimum USD for whale alert
  whaleTradeUsd: number;                // Minimum USD per trade for whale

  // Spread detection
  spreadCollapsePercent: number;        // Spread shrinks by this %

  // Rate limiting
  alertCooldownMs: number;              // Cooldown between same alerts
}

export const DEFAULT_CONFIG: UnusualActivityConfig = {
  flashMoveThresholdPercent: 10,        // 10% move
  flashMoveWindowMs: 5 * 60 * 1000,     // 5 minutes

  volumeSpikeMultiple: 3,               // 3x normal volume
  volumeWindowMs: 60 * 60 * 1000,       // 1 hour baseline

  whalePositionUsd: 10000,              // $10K positions
  whaleTradeUsd: 5000,                  // $5K single trade

  spreadCollapsePercent: 50,            // Spread shrinks 50%

  alertCooldownMs: 5 * 60 * 1000,       // 5 min between same alerts
};

// =============================================================================
// TYPES
// =============================================================================

export type UnusualActivityType =
  | 'whale_entry'
  | 'flash_move'
  | 'volume_spike'
  | 'spread_collapse'
  | 'orderbook_imbalance';

export interface UnusualActivityAlert {
  type: UnusualActivityType;
  market: string;
  marketTitle?: string;
  magnitude: number;              // How unusual (0-1 or stddev)
  direction: 'bullish' | 'bearish' | 'neutral';
  timestamp: Date;
  details: {
    priceMove?: number;
    volumeMultiple?: number;
    tradeSize?: number;
    spreadChange?: number;
    imbalanceRatio?: number;
  };
  kalshiOpportunity?: {
    ticker: string;
    priceDiff: number;
    action: string;
  };
  reasoning: string;

  // Insider Score: 0-100 indicating likelihood of informed trading
  // Based on: low probability bets, unusual size, timing, historical accuracy
  insiderScore?: number;
}

// =============================================================================
// INSIDER SCORE CALCULATION
// =============================================================================

/**
 * Factors used to calculate insider score (0-100)
 * Higher scores indicate higher likelihood of informed/insider trading
 *
 * Based on PolyWhaler methodology:
 * - Low probability bets (betting on <15% or >85% outcomes)
 * - Unusual trade size relative to market norm
 * - Suspicious timing (near news events)
 * - Historical wallet accuracy (if tracked)
 * - First mover advantage in new markets
 */
export interface InsiderScoreFactors {
  // Is this a bet on a low probability outcome (<15% or >85%)?
  lowProbabilityBet: boolean;

  // Trade size as multiple of average (e.g., 5x normal = 5.0)
  sizeMultiple: number;

  // Market age in hours (newer = higher score potential)
  marketAgeHours: number;

  // Current price of the outcome being bet on (0-1)
  outcomePrice: number;

  // Optional: Known wallet win rate (0-1)
  walletWinRate?: number;
}

/**
 * Calculate insider score (0-100) based on trade characteristics
 *
 * Methodology based on PolyWhaler and academic research:
 * - Large bets on unlikely outcomes suggest informed trading
 * - Unusual size relative to normal activity is suspicious
 * - Early positions in new markets may indicate advance knowledge
 */
export function calculateInsiderScore(factors: InsiderScoreFactors): number {
  let score = 0;

  // Low probability bet: +25 points
  // Betting big on <15% or >85% outcomes is unusual unless you know something
  if (factors.lowProbabilityBet) {
    score += 25;
  }

  // Unusual size: up to +25 points (5x normal = max)
  // Larger trades relative to market norm suggest conviction
  score += Math.min(25, factors.sizeMultiple * 5);

  // New market first mover: up to +15 points
  // Being early in new markets suggests monitoring advantage
  if (factors.marketAgeHours < 1) {
    score += 15;
  } else if (factors.marketAgeHours < 6) {
    score += 10;
  } else if (factors.marketAgeHours < 24) {
    score += 5;
  }

  // Extreme price positioning: up to +15 points
  // Betting on very unlikely outcomes with size is suspicious
  if (factors.outcomePrice < 0.10 || factors.outcomePrice > 0.90) {
    score += 15;
  } else if (factors.outcomePrice < 0.20 || factors.outcomePrice > 0.80) {
    score += 8;
  }

  // Historical wallet accuracy: up to +20 points
  // Whales with proven track records get weighted higher
  if (factors.walletWinRate !== undefined) {
    score += factors.walletWinRate * 20;
  }

  return Math.min(100, Math.round(score));
}

interface PriceHistory {
  price: number;
  timestamp: number;
}

interface VolumeHistory {
  volume: number;
  timestamp: number;
}

interface SpreadHistory {
  spread: number;
  timestamp: number;
}

// =============================================================================
// UNUSUAL ACTIVITY DETECTOR
// =============================================================================

export class UnusualActivityDetector extends EventEmitter {
  private config: UnusualActivityConfig;

  // Historical data for analysis
  private priceHistory: Map<string, PriceHistory[]> = new Map();
  private volumeHistory: Map<string, VolumeHistory[]> = new Map();
  private spreadHistory: Map<string, SpreadHistory[]> = new Map();

  // Cooldown tracking
  private lastAlerts: Map<string, number> = new Map();

  // Market title mapping (for better alerts)
  private marketTitles: Map<string, string> = new Map();

  constructor(config: Partial<UnusualActivityConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set market title for better alert messages
   */
  setMarketTitle(assetId: string, title: string): void {
    this.marketTitles.set(assetId, title);
  }

  /**
   * Process orderbook update and detect anomalies
   */
  processBookUpdate(update: OrderbookUpdate): UnusualActivityAlert[] {
    const alerts: UnusualActivityAlert[] = [];

    // Calculate spread
    const bestBid = update.bids[0] ? parseFloat(update.bids[0].price) : 0;
    const bestAsk = update.asks[0] ? parseFloat(update.asks[0].price) : 1;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    // Store spread history
    this.addSpreadHistory(update.asset_id, spread, update.timestamp);

    // Check for spread collapse
    const spreadAlert = this.detectSpreadCollapse(update.asset_id, spread);
    if (spreadAlert) alerts.push(spreadAlert);

    // Check for orderbook imbalance
    const imbalanceAlert = this.detectOrderbookImbalance(update);
    if (imbalanceAlert) alerts.push(imbalanceAlert);

    // Update price history from mid-price
    this.addPriceHistory(update.asset_id, midPrice, update.timestamp);

    return alerts;
  }

  /**
   * Process trade update and detect anomalies
   */
  processTradeUpdate(update: TradeUpdate): UnusualActivityAlert[] {
    const alerts: UnusualActivityAlert[] = [];

    const price = parseFloat(update.price);
    const size = parseFloat(update.size);
    const volumeUsd = price * size;

    // Store price and volume history
    this.addPriceHistory(update.asset_id, price, update.timestamp);
    this.addVolumeHistory(update.asset_id, volumeUsd, update.timestamp);

    // Check for whale trade
    const whaleAlert = this.detectWhaleTrade(update, volumeUsd);
    if (whaleAlert) alerts.push(whaleAlert);

    // Check for volume spike
    const volumeAlert = this.detectVolumeSpike(update.asset_id);
    if (volumeAlert) alerts.push(volumeAlert);

    return alerts;
  }

  /**
   * Process price change and detect flash moves
   */
  processPriceChange(event: PriceChangeEvent): UnusualActivityAlert | null {
    // Check for flash move
    return this.detectFlashMove(event);
  }

  /**
   * Analyze market for all types of unusual activity
   */
  analyzeMarket(assetId: string): UnusualActivityAlert[] {
    const alerts: UnusualActivityAlert[] = [];

    // Check flash move from price history
    const flashAlert = this.detectFlashMoveFromHistory(assetId);
    if (flashAlert) alerts.push(flashAlert);

    // Check volume spike
    const volumeAlert = this.detectVolumeSpike(assetId);
    if (volumeAlert) alerts.push(volumeAlert);

    return alerts;
  }

  /**
   * Clear old historical data to prevent memory growth
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = Math.max(
      this.config.flashMoveWindowMs,
      this.config.volumeWindowMs
    ) * 2;

    for (const [assetId, history] of this.priceHistory) {
      this.priceHistory.set(
        assetId,
        history.filter(h => now - h.timestamp < maxAge)
      );
    }

    for (const [assetId, history] of this.volumeHistory) {
      this.volumeHistory.set(
        assetId,
        history.filter(h => now - h.timestamp < maxAge)
      );
    }

    for (const [assetId, history] of this.spreadHistory) {
      this.spreadHistory.set(
        assetId,
        history.filter(h => now - h.timestamp < maxAge)
      );
    }
  }

  // =============================================================================
  // DETECTION METHODS
  // =============================================================================

  private detectFlashMove(event: PriceChangeEvent): UnusualActivityAlert | null {
    if (Math.abs(event.changePercent) < this.config.flashMoveThresholdPercent) {
      return null;
    }

    // Check cooldown
    const alertKey = `flash_move:${event.asset_id}`;
    if (this.isOnCooldown(alertKey)) return null;

    const direction = event.changePercent > 0 ? 'bullish' : 'bearish';
    const magnitude = Math.abs(event.changePercent) / 100;

    const alert: UnusualActivityAlert = {
      type: 'flash_move',
      market: event.asset_id,
      marketTitle: this.marketTitles.get(event.asset_id),
      magnitude,
      direction,
      timestamp: new Date(event.timestamp),
      details: {
        priceMove: event.changePercent,
      },
      reasoning: `Price ${direction === 'bullish' ? 'spiked' : 'dropped'} ${Math.abs(event.changePercent).toFixed(1)}% ` +
        `from ${(event.oldPrice * 100).toFixed(0)}¢ to ${(event.newPrice * 100).toFixed(0)}¢`,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  private detectFlashMoveFromHistory(assetId: string): UnusualActivityAlert | null {
    const history = this.priceHistory.get(assetId);
    if (!history || history.length < 2) return null;

    const now = Date.now();
    const windowStart = now - this.config.flashMoveWindowMs;

    const recentPrices = history.filter(h => h.timestamp >= windowStart);
    if (recentPrices.length < 2) return null;

    const firstPrice = recentPrices[0].price;
    const lastPrice = recentPrices[recentPrices.length - 1].price;
    const changePercent = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (Math.abs(changePercent) < this.config.flashMoveThresholdPercent) {
      return null;
    }

    const alertKey = `flash_move:${assetId}`;
    if (this.isOnCooldown(alertKey)) return null;

    const direction = changePercent > 0 ? 'bullish' : 'bearish';

    const alert: UnusualActivityAlert = {
      type: 'flash_move',
      market: assetId,
      marketTitle: this.marketTitles.get(assetId),
      magnitude: Math.abs(changePercent) / 100,
      direction,
      timestamp: new Date(),
      details: {
        priceMove: changePercent,
      },
      reasoning: `Price ${direction === 'bullish' ? 'jumped' : 'fell'} ${Math.abs(changePercent).toFixed(1)}% ` +
        `in the last ${Math.round(this.config.flashMoveWindowMs / 60000)} minutes`,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  private detectWhaleTrade(update: TradeUpdate, volumeUsd: number): UnusualActivityAlert | null {
    if (volumeUsd < this.config.whaleTradeUsd) return null;

    const alertKey = `whale_entry:${update.asset_id}`;
    if (this.isOnCooldown(alertKey)) return null;

    const direction = update.side === 'BUY' ? 'bullish' : 'bearish';
    const price = parseFloat(update.price);

    // Calculate insider score for this whale trade
    const avgVolume = this.getAverageVolume(update.asset_id);
    const sizeMultiple = avgVolume > 0 ? volumeUsd / avgVolume : 2.0;
    const marketAgeHours = this.getMarketAgeHours(update.asset_id);

    const insiderScore = calculateInsiderScore({
      lowProbabilityBet: price < 0.15 || price > 0.85,
      sizeMultiple,
      marketAgeHours,
      outcomePrice: update.side === 'BUY' ? price : 1 - price,
    });

    // Build reasoning with insider score context
    let reasoning = `Large ${update.side} trade of $${volumeUsd.toLocaleString()} ` +
      `at ${(price * 100).toFixed(0)}¢`;

    if (insiderScore >= 60) {
      reasoning += ` | 🔥 HIGH insider score (${insiderScore}/100) - likely informed`;
    } else if (insiderScore >= 40) {
      reasoning += ` | ⚠️ MEDIUM insider score (${insiderScore}/100)`;
    }

    const alert: UnusualActivityAlert = {
      type: 'whale_entry',
      market: update.asset_id,
      marketTitle: this.marketTitles.get(update.asset_id),
      magnitude: volumeUsd / this.config.whalePositionUsd,
      direction,
      timestamp: new Date(update.timestamp),
      details: {
        tradeSize: volumeUsd,
      },
      reasoning,
      insiderScore,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  /**
   * Get average trade volume for a market
   */
  private getAverageVolume(assetId: string): number {
    const history = this.volumeHistory.get(assetId);
    if (!history || history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.volume, 0) / history.length;
  }

  /**
   * Get market age in hours (placeholder - would need market creation time)
   */
  private getMarketAgeHours(assetId: string): number {
    // For now, estimate based on price history length
    // In production, this would query market creation timestamp
    const history = this.priceHistory.get(assetId);
    if (!history || history.length === 0) return 24; // Default to "not new"

    const firstTimestamp = history[0].timestamp;
    const hoursAgo = (Date.now() - firstTimestamp) / (1000 * 60 * 60);
    return Math.max(hoursAgo, 1); // At least 1 hour of observation
  }

  private detectVolumeSpike(assetId: string): UnusualActivityAlert | null {
    const history = this.volumeHistory.get(assetId);
    if (!history || history.length < 5) return null;

    const now = Date.now();
    const windowStart = now - this.config.volumeWindowMs;
    const recentStart = now - this.config.flashMoveWindowMs;

    // Calculate baseline average
    const baselineVolumes = history.filter(
      h => h.timestamp >= windowStart && h.timestamp < recentStart
    );
    if (baselineVolumes.length < 3) return null;

    const avgBaseline = baselineVolumes.reduce((sum, h) => sum + h.volume, 0) / baselineVolumes.length;

    // Calculate recent volume
    const recentVolumes = history.filter(h => h.timestamp >= recentStart);
    if (recentVolumes.length === 0) return null;

    const avgRecent = recentVolumes.reduce((sum, h) => sum + h.volume, 0) / recentVolumes.length;

    const volumeMultiple = avgRecent / avgBaseline;

    if (volumeMultiple < this.config.volumeSpikeMultiple) return null;

    const alertKey = `volume_spike:${assetId}`;
    if (this.isOnCooldown(alertKey)) return null;

    const alert: UnusualActivityAlert = {
      type: 'volume_spike',
      market: assetId,
      marketTitle: this.marketTitles.get(assetId),
      magnitude: volumeMultiple / this.config.volumeSpikeMultiple,
      direction: 'neutral',
      timestamp: new Date(),
      details: {
        volumeMultiple,
      },
      reasoning: `Volume is ${volumeMultiple.toFixed(1)}x normal ` +
        `($${avgRecent.toLocaleString()} vs $${avgBaseline.toLocaleString()} baseline)`,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  private detectSpreadCollapse(assetId: string, currentSpread: number): UnusualActivityAlert | null {
    const history = this.spreadHistory.get(assetId);
    if (!history || history.length < 3) return null;

    // Get average spread over window
    const avgSpread = history.reduce((sum, h) => sum + h.spread, 0) / history.length;

    if (avgSpread <= 0) return null;

    const spreadChange = ((avgSpread - currentSpread) / avgSpread) * 100;

    if (spreadChange < this.config.spreadCollapsePercent) return null;

    const alertKey = `spread_collapse:${assetId}`;
    if (this.isOnCooldown(alertKey)) return null;

    const alert: UnusualActivityAlert = {
      type: 'spread_collapse',
      market: assetId,
      marketTitle: this.marketTitles.get(assetId),
      magnitude: spreadChange / 100,
      direction: 'neutral',
      timestamp: new Date(),
      details: {
        spreadChange,
      },
      reasoning: `Bid-ask spread collapsed ${spreadChange.toFixed(0)}% ` +
        `from ${(avgSpread * 100).toFixed(1)}¢ to ${(currentSpread * 100).toFixed(1)}¢ - whale incoming?`,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  private detectOrderbookImbalance(update: OrderbookUpdate): UnusualActivityAlert | null {
    // Calculate total depth on each side
    const bidDepth = update.bids.reduce((sum, b) => sum + parseFloat(b.size), 0);
    const askDepth = update.asks.reduce((sum, a) => sum + parseFloat(a.size), 0);

    if (bidDepth + askDepth === 0) return null;

    const imbalanceRatio = (bidDepth - askDepth) / (bidDepth + askDepth);

    // Only alert on extreme imbalances (>70% one-sided)
    if (Math.abs(imbalanceRatio) < 0.7) return null;

    const alertKey = `orderbook_imbalance:${update.asset_id}`;
    if (this.isOnCooldown(alertKey)) return null;

    const direction = imbalanceRatio > 0 ? 'bullish' : 'bearish';

    const alert: UnusualActivityAlert = {
      type: 'orderbook_imbalance',
      market: update.asset_id,
      marketTitle: this.marketTitles.get(update.asset_id),
      magnitude: Math.abs(imbalanceRatio),
      direction,
      timestamp: new Date(update.timestamp),
      details: {
        imbalanceRatio,
      },
      reasoning: `Orderbook is ${(Math.abs(imbalanceRatio) * 100).toFixed(0)}% ` +
        `${direction === 'bullish' ? 'bid' : 'ask'}-heavy - potential price move incoming`,
    };

    this.recordAlert(alertKey);
    this.emit('alert', alert);
    return alert;
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  private addPriceHistory(assetId: string, price: number, timestamp: number): void {
    if (!this.priceHistory.has(assetId)) {
      this.priceHistory.set(assetId, []);
    }
    this.priceHistory.get(assetId)!.push({ price, timestamp });
  }

  private addVolumeHistory(assetId: string, volume: number, timestamp: number): void {
    if (!this.volumeHistory.has(assetId)) {
      this.volumeHistory.set(assetId, []);
    }
    this.volumeHistory.get(assetId)!.push({ volume, timestamp });
  }

  private addSpreadHistory(assetId: string, spread: number, timestamp: number): void {
    if (!this.spreadHistory.has(assetId)) {
      this.spreadHistory.set(assetId, []);
    }
    this.spreadHistory.get(assetId)!.push({ spread, timestamp });
  }

  private isOnCooldown(alertKey: string): boolean {
    const lastAlert = this.lastAlerts.get(alertKey);
    if (!lastAlert) return false;
    return Date.now() - lastAlert < this.config.alertCooldownMs;
  }

  private recordAlert(alertKey: string): void {
    this.lastAlerts.set(alertKey, Date.now());
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new unusual activity detector
 */
export function createUnusualActivityDetector(
  config?: Partial<UnusualActivityConfig>
): UnusualActivityDetector {
  return new UnusualActivityDetector(config);
}
