/**
 * Velocity Tracker for Rate-of-Change Monitoring
 *
 * Tracks the velocity (rate of change) of market metrics to detect:
 * - Accelerating price movements
 * - Volume momentum
 * - Sentiment shifts
 *
 * Based on momentum and velocity indicators from quantitative finance.
 */

import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface VelocityPoint {
  value: number;
  timestamp: number;
}

export interface VelocityMetrics {
  currentVelocity: number;      // Current rate of change
  avgVelocity: number;          // Average velocity over window
  acceleration: number;         // Rate of change of velocity
  direction: 'accelerating' | 'decelerating' | 'stable';
  isUnusual: boolean;           // Velocity > 2 stddev from mean
  stddevFromMean: number;       // How many stddevs from mean
}

export interface VelocityTrackerConfig {
  windowMs: number;             // Window for velocity calculation
  minDataPoints: number;        // Minimum points for calculation
  velocityThresholdStddev: number; // Stddevs for unusual detection
}

const DEFAULT_CONFIG: VelocityTrackerConfig = {
  windowMs: 5 * 60 * 1000,      // 5 minutes
  minDataPoints: 5,
  velocityThresholdStddev: 2.0,
};

// =============================================================================
// VELOCITY TRACKER
// =============================================================================

export class VelocityTracker {
  private config: VelocityTrackerConfig;
  private data: Map<string, VelocityPoint[]> = new Map();
  private velocities: Map<string, number[]> = new Map();

  constructor(config: Partial<VelocityTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a new data point for tracking
   */
  addPoint(metricId: string, value: number, timestamp: number = Date.now()): void {
    if (!this.data.has(metricId)) {
      this.data.set(metricId, []);
      this.velocities.set(metricId, []);
    }

    const points = this.data.get(metricId)!;
    points.push({ value, timestamp });

    // Calculate velocity from last two points
    if (points.length >= 2) {
      const prev = points[points.length - 2];
      const current = points[points.length - 1];
      const timeDelta = (current.timestamp - prev.timestamp) / 1000; // seconds

      if (timeDelta > 0) {
        const velocity = (current.value - prev.value) / timeDelta;
        this.velocities.get(metricId)!.push(velocity);
      }
    }

    // Cleanup old data
    this.cleanupMetric(metricId);
  }

  /**
   * Get velocity metrics for a metric
   */
  getMetrics(metricId: string): VelocityMetrics | null {
    const velocityHistory = this.velocities.get(metricId);

    if (!velocityHistory || velocityHistory.length < this.config.minDataPoints) {
      return null;
    }

    // Current velocity (last value)
    const currentVelocity = velocityHistory[velocityHistory.length - 1];

    // Average velocity
    const avgVelocity = velocityHistory.reduce((sum, v) => sum + v, 0) / velocityHistory.length;

    // Standard deviation
    const variance = velocityHistory.reduce(
      (sum, v) => sum + Math.pow(v - avgVelocity, 2),
      0
    ) / velocityHistory.length;
    const stddev = Math.sqrt(variance);

    // Calculate acceleration (change in velocity)
    let acceleration = 0;
    if (velocityHistory.length >= 2) {
      const prevVelocity = velocityHistory[velocityHistory.length - 2];
      acceleration = currentVelocity - prevVelocity;
    }

    // Determine direction
    let direction: 'accelerating' | 'decelerating' | 'stable';
    if (acceleration > stddev * 0.5) {
      direction = 'accelerating';
    } else if (acceleration < -stddev * 0.5) {
      direction = 'decelerating';
    } else {
      direction = 'stable';
    }

    // Check if unusual
    const stddevFromMean = stddev > 0 ? Math.abs(currentVelocity - avgVelocity) / stddev : 0;
    const isUnusual = stddevFromMean > this.config.velocityThresholdStddev;

    return {
      currentVelocity,
      avgVelocity,
      acceleration,
      direction,
      isUnusual,
      stddevFromMean,
    };
  }

  /**
   * Check if a metric is showing unusual velocity
   */
  isUnusual(metricId: string): boolean {
    const metrics = this.getMetrics(metricId);
    return metrics?.isUnusual ?? false;
  }

  /**
   * Get the current velocity for a metric
   */
  getCurrentVelocity(metricId: string): number | null {
    const velocityHistory = this.velocities.get(metricId);
    if (!velocityHistory || velocityHistory.length === 0) return null;
    return velocityHistory[velocityHistory.length - 1];
  }

  /**
   * Get price velocity for a specific market
   */
  getPriceVelocity(marketId: string): VelocityMetrics | null {
    return this.getMetrics(`price:${marketId}`);
  }

  /**
   * Get volume velocity for a specific market
   */
  getVolumeVelocity(marketId: string): VelocityMetrics | null {
    return this.getMetrics(`volume:${marketId}`);
  }

  /**
   * Track price change
   */
  trackPrice(marketId: string, price: number, timestamp?: number): void {
    this.addPoint(`price:${marketId}`, price, timestamp);
  }

  /**
   * Track volume
   */
  trackVolume(marketId: string, volume: number, timestamp?: number): void {
    this.addPoint(`volume:${marketId}`, volume, timestamp);
  }

  /**
   * Clear all data for a metric
   */
  clearMetric(metricId: string): void {
    this.data.delete(metricId);
    this.velocities.delete(metricId);
  }

  /**
   * Clear all tracked data
   */
  clearAll(): void {
    this.data.clear();
    this.velocities.clear();
  }

  /**
   * Get count of tracked metrics
   */
  getTrackedCount(): number {
    return this.data.size;
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private cleanupMetric(metricId: string): void {
    const now = Date.now();
    const cutoff = now - this.config.windowMs * 2;

    const points = this.data.get(metricId);
    if (points) {
      const filtered = points.filter(p => p.timestamp > cutoff);
      this.data.set(metricId, filtered);
    }

    // Keep velocities in sync (roughly)
    const velocities = this.velocities.get(metricId);
    if (velocities && velocities.length > 100) {
      this.velocities.set(metricId, velocities.slice(-50));
    }
  }
}

// =============================================================================
// MULTI-MARKET VELOCITY MONITOR
// =============================================================================

export interface MarketVelocityState {
  marketId: string;
  priceVelocity: VelocityMetrics | null;
  volumeVelocity: VelocityMetrics | null;
  overallState: 'calm' | 'active' | 'volatile' | 'extreme';
  alerts: string[];
}

export class MarketVelocityMonitor {
  private tracker: VelocityTracker;

  constructor(config?: Partial<VelocityTrackerConfig>) {
    this.tracker = new VelocityTracker(config);
  }

  /**
   * Record a trade for velocity tracking
   */
  recordTrade(marketId: string, price: number, volume: number, timestamp?: number): void {
    this.tracker.trackPrice(marketId, price, timestamp);
    this.tracker.trackVolume(marketId, volume, timestamp);
  }

  /**
   * Record a price update
   */
  recordPrice(marketId: string, price: number, timestamp?: number): void {
    this.tracker.trackPrice(marketId, price, timestamp);
  }

  /**
   * Get the velocity state for a market
   */
  getMarketState(marketId: string): MarketVelocityState {
    const priceVelocity = this.tracker.getPriceVelocity(marketId);
    const volumeVelocity = this.tracker.getVolumeVelocity(marketId);

    const alerts: string[] = [];
    let overallState: 'calm' | 'active' | 'volatile' | 'extreme' = 'calm';

    // Analyze price velocity
    if (priceVelocity) {
      if (priceVelocity.isUnusual) {
        alerts.push(`Price velocity is ${priceVelocity.stddevFromMean.toFixed(1)} stddev from mean`);
        overallState = 'volatile';
      }
      if (priceVelocity.direction === 'accelerating' && priceVelocity.isUnusual) {
        alerts.push('Price is accelerating rapidly');
        overallState = 'extreme';
      }
    }

    // Analyze volume velocity
    if (volumeVelocity) {
      if (volumeVelocity.isUnusual) {
        alerts.push(`Volume velocity is ${volumeVelocity.stddevFromMean.toFixed(1)} stddev from mean`);
        if (overallState === 'calm') overallState = 'active';
      }
    }

    // Combined analysis
    if (priceVelocity?.isUnusual && volumeVelocity?.isUnusual) {
      overallState = 'extreme';
      alerts.push('Both price and volume showing unusual velocity - major move underway');
    }

    return {
      marketId,
      priceVelocity,
      volumeVelocity,
      overallState,
      alerts,
    };
  }

  /**
   * Get all markets with unusual velocity
   */
  getUnusualMarkets(): MarketVelocityState[] {
    const unusual: MarketVelocityState[] = [];

    // Get unique market IDs from tracked metrics
    const marketIds = new Set<string>();
    for (const metricId of this.tracker['data'].keys()) {
      const match = metricId.match(/^(price|volume):(.+)$/);
      if (match) {
        marketIds.add(match[2]);
      }
    }

    for (const marketId of marketIds) {
      const state = this.getMarketState(marketId);
      if (state.overallState !== 'calm') {
        unusual.push(state);
      }
    }

    return unusual;
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.tracker.clearAll();
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a velocity tracker
 */
export function createVelocityTracker(
  config?: Partial<VelocityTrackerConfig>
): VelocityTracker {
  return new VelocityTracker(config);
}

/**
 * Create a market velocity monitor
 */
export function createMarketVelocityMonitor(
  config?: Partial<VelocityTrackerConfig>
): MarketVelocityMonitor {
  return new MarketVelocityMonitor(config);
}
