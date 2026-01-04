/**
 * Velocity Tracker Unit Tests
 *
 * Tests rate-of-change monitoring for market metrics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VelocityTracker,
  MarketVelocityMonitor,
  createVelocityTracker,
  createMarketVelocityMonitor,
} from '../../../src/realtime/velocity-tracker.js';

describe('VelocityTracker', () => {
  let tracker: VelocityTracker;

  beforeEach(() => {
    tracker = createVelocityTracker({
      minDataPoints: 3,
    });
  });

  describe('addPoint', () => {
    it('should add points without error', () => {
      expect(() => tracker.addPoint('test', 100, 1000)).not.toThrow();
      expect(() => tracker.addPoint('test', 110, 2000)).not.toThrow();
    });

    it('should handle multiple metrics', () => {
      tracker.addPoint('price:BTC', 50000, 1000);
      tracker.addPoint('volume:BTC', 1000000, 1000);

      expect(tracker.getTrackedCount()).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('should return null with insufficient data', () => {
      tracker.addPoint('test', 100, 1000);
      tracker.addPoint('test', 110, 2000);

      const metrics = tracker.getMetrics('test');
      expect(metrics).toBeNull();
    });

    it('should calculate velocity with sufficient data', () => {
      const baseTime = Date.now();

      // Add points with known velocity
      tracker.addPoint('test', 100, baseTime);
      tracker.addPoint('test', 110, baseTime + 1000); // +10 in 1 second = 10/s
      tracker.addPoint('test', 120, baseTime + 2000); // +10 in 1 second = 10/s
      tracker.addPoint('test', 130, baseTime + 3000); // +10 in 1 second = 10/s

      const metrics = tracker.getMetrics('test');

      expect(metrics).not.toBeNull();
      expect(metrics?.currentVelocity).toBeCloseTo(10, 1);
      expect(metrics?.avgVelocity).toBeCloseTo(10, 1);
    });

    it('should detect acceleration', () => {
      const baseTime = Date.now();

      // Start slow, then accelerate
      tracker.addPoint('test', 100, baseTime);
      tracker.addPoint('test', 101, baseTime + 1000); // +1/s
      tracker.addPoint('test', 103, baseTime + 2000); // +2/s
      tracker.addPoint('test', 108, baseTime + 3000); // +5/s
      tracker.addPoint('test', 118, baseTime + 4000); // +10/s

      const metrics = tracker.getMetrics('test');

      expect(metrics?.direction).toBe('accelerating');
      expect(metrics?.acceleration).toBeGreaterThan(0);
    });

    it('should detect deceleration', () => {
      const baseTime = Date.now();

      // Start fast, then slow down
      tracker.addPoint('test', 100, baseTime);
      tracker.addPoint('test', 120, baseTime + 1000); // +20/s
      tracker.addPoint('test', 130, baseTime + 2000); // +10/s
      tracker.addPoint('test', 135, baseTime + 3000); // +5/s
      tracker.addPoint('test', 136, baseTime + 4000); // +1/s

      const metrics = tracker.getMetrics('test');

      expect(metrics?.direction).toBe('decelerating');
      expect(metrics?.acceleration).toBeLessThan(0);
    });
  });

  describe('isUnusual', () => {
    it('should detect unusual velocity', () => {
      const baseTime = Date.now();

      // Normal velocities
      for (let i = 0; i < 10; i++) {
        tracker.addPoint('test', 100 + i, baseTime + i * 1000);
      }

      // Check not unusual during normal period
      const normalMetrics = tracker.getMetrics('test');
      expect(normalMetrics?.isUnusual).toBe(false);

      // Add unusual spike
      tracker.addPoint('test', 200, baseTime + 10000); // Huge jump

      const spikeMetrics = tracker.getMetrics('test');
      expect(spikeMetrics?.isUnusual).toBe(true);
    });
  });

  describe('trackPrice and trackVolume', () => {
    it('should track price velocity', () => {
      const baseTime = Date.now();

      tracker.trackPrice('BTC', 50000, baseTime);
      tracker.trackPrice('BTC', 50100, baseTime + 1000);
      tracker.trackPrice('BTC', 50200, baseTime + 2000);
      tracker.trackPrice('BTC', 50300, baseTime + 3000);

      const velocity = tracker.getPriceVelocity('BTC');
      expect(velocity).not.toBeNull();
      expect(velocity?.currentVelocity).toBeCloseTo(100, 1);
    });

    it('should track volume velocity', () => {
      const baseTime = Date.now();

      tracker.trackVolume('ETH', 1000, baseTime);
      tracker.trackVolume('ETH', 1500, baseTime + 1000);
      tracker.trackVolume('ETH', 2000, baseTime + 2000);
      tracker.trackVolume('ETH', 2500, baseTime + 3000);

      const velocity = tracker.getVolumeVelocity('ETH');
      expect(velocity).not.toBeNull();
      expect(velocity?.currentVelocity).toBeCloseTo(500, 1);
    });
  });

  describe('clearMetric and clearAll', () => {
    it('should clear specific metric', () => {
      tracker.addPoint('metric1', 100, 1000);
      tracker.addPoint('metric2', 200, 1000);

      tracker.clearMetric('metric1');

      expect(tracker.getTrackedCount()).toBe(1);
    });

    it('should clear all metrics', () => {
      tracker.addPoint('metric1', 100, 1000);
      tracker.addPoint('metric2', 200, 1000);
      tracker.addPoint('metric3', 300, 1000);

      tracker.clearAll();

      expect(tracker.getTrackedCount()).toBe(0);
    });
  });

  describe('getCurrentVelocity', () => {
    it('should return null for unknown metric', () => {
      expect(tracker.getCurrentVelocity('unknown')).toBeNull();
    });

    it('should return current velocity', () => {
      const baseTime = Date.now();

      tracker.addPoint('test', 100, baseTime);
      tracker.addPoint('test', 120, baseTime + 1000);

      const velocity = tracker.getCurrentVelocity('test');
      expect(velocity).toBeCloseTo(20, 1);
    });
  });
});

describe('MarketVelocityMonitor', () => {
  let monitor: MarketVelocityMonitor;

  beforeEach(() => {
    monitor = createMarketVelocityMonitor({
      minDataPoints: 3,
    });
  });

  describe('recordTrade', () => {
    it('should record trades for velocity tracking', () => {
      const baseTime = Date.now();

      monitor.recordTrade('BTC-YES', 0.55, 1000, baseTime);
      monitor.recordTrade('BTC-YES', 0.56, 1500, baseTime + 1000);
      monitor.recordTrade('BTC-YES', 0.58, 2000, baseTime + 2000);
      monitor.recordTrade('BTC-YES', 0.60, 2500, baseTime + 3000);

      const state = monitor.getMarketState('BTC-YES');

      expect(state.priceVelocity).not.toBeNull();
      expect(state.volumeVelocity).not.toBeNull();
    });
  });

  describe('getMarketState', () => {
    it('should return calm state for stable market', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        monitor.recordTrade('stable-market', 0.50, 100, baseTime + i * 1000);
      }

      const state = monitor.getMarketState('stable-market');

      expect(state.overallState).toBe('calm');
      expect(state.alerts).toHaveLength(0);
    });

    it('should detect volatile market', () => {
      const baseTime = Date.now();

      // Normal trades
      for (let i = 0; i < 5; i++) {
        monitor.recordTrade('volatile-market', 0.50 + i * 0.001, 100, baseTime + i * 1000);
      }

      // Spike
      monitor.recordTrade('volatile-market', 0.70, 10000, baseTime + 5000);

      const state = monitor.getMarketState('volatile-market');

      // Should detect something unusual
      if (state.priceVelocity?.isUnusual || state.volumeVelocity?.isUnusual) {
        expect(state.overallState).not.toBe('calm');
      }
    });
  });

  describe('getUnusualMarkets', () => {
    it('should return empty array when all markets are calm', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        monitor.recordTrade('market1', 0.50, 100, baseTime + i * 1000);
        monitor.recordTrade('market2', 0.60, 100, baseTime + i * 1000);
      }

      const unusual = monitor.getUnusualMarkets();

      // Calm markets should not appear
      expect(unusual.filter(m => m.overallState === 'calm')).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      monitor.recordTrade('market1', 0.50, 100);
      monitor.recordTrade('market2', 0.60, 100);

      monitor.clear();

      const unusual = monitor.getUnusualMarkets();
      expect(unusual).toHaveLength(0);
    });
  });
});
