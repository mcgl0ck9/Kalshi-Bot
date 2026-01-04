/**
 * Time-Decay Model Unit Tests
 *
 * Tests the options-style theta decay calculations for prediction markets.
 * Based on PhD-level research (arXiv:2412.14144, PNAS Iowa Electronic Markets).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTheta,
  calculateThetaPerDay,
  calculateTimeDecay,
  adjustEdgeForTheta,
  parseExpiryTime,
  getUrgencyLevel,
  getRecommendedOrderType,
  getLimitOrderAdjustmentFactor,
  formatThetaDisplay,
} from '../../../src/models/time-decay.js';

describe('Time-Decay Model', () => {
  describe('parseExpiryTime', () => {
    it('should handle undefined closeTime with 1-year default', () => {
      const result = parseExpiryTime(undefined);

      expect(result.daysToExpiry).toBeCloseTo(365, 0);
      expect(result.isExpiringSoon).toBe(false);
      expect(result.isExpired).toBe(false);
      expect(result.formattedExpiry).toBe('No expiry set');
    });

    it('should parse string date correctly', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const result = parseExpiryTime(futureDate.toISOString());

      expect(result.daysToExpiry).toBeCloseTo(30, 0);
      expect(result.hoursToExpiry).toBeCloseTo(30 * 24, 0);
      expect(result.isExpiringSoon).toBe(false);
      expect(result.isExpired).toBe(false);
    });

    it('should parse Date object correctly', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const result = parseExpiryTime(futureDate);

      expect(result.daysToExpiry).toBeCloseTo(5, 0);
      expect(result.isExpiringSoon).toBe(true);
    });

    it('should detect expired markets', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const result = parseExpiryTime(pastDate);

      expect(result.isExpired).toBe(true);
      expect(result.daysToExpiry).toBe(0);
      expect(result.formattedExpiry).toBe('EXPIRED');
    });

    it('should detect expiring soon (within 7 days)', () => {
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      const result = parseExpiryTime(soonDate);

      expect(result.isExpiringSoon).toBe(true);
    });
  });

  describe('calculateTheta', () => {
    it('should return 1.0 for expired markets', () => {
      expect(calculateTheta(0)).toBe(1.0);
      expect(calculateTheta(-1)).toBe(1.0);
    });

    it('should return 0.0 for markets far from expiry', () => {
      expect(calculateTheta(100)).toBe(0.0);
      expect(calculateTheta(365)).toBe(0.0);
    });

    it('should return ~0.5 at inflection point (7 days)', () => {
      const theta = calculateTheta(7);
      expect(theta).toBeCloseTo(0.5, 1);
    });

    it('should increase as expiry approaches', () => {
      const theta30 = calculateTheta(30);
      const theta14 = calculateTheta(14);
      const theta7 = calculateTheta(7);
      const theta3 = calculateTheta(3);
      const theta1 = calculateTheta(1);

      expect(theta14).toBeGreaterThan(theta30);
      expect(theta7).toBeGreaterThan(theta14);
      expect(theta3).toBeGreaterThan(theta7);
      expect(theta1).toBeGreaterThan(theta3);
    });

    it('should follow sigmoid curve (non-linear near inflection)', () => {
      // Theta follows inverse sigmoid: accelerates as we approach inflection point (7 days)
      // then decelerates after passing it
      const theta30 = calculateTheta(30);
      const theta14 = calculateTheta(14);
      const theta7 = calculateTheta(7);

      // The rate of change should be highest around the inflection point
      // Change is greater between 14-7 days than 30-14 days
      const change30to14 = theta14 - theta30;
      const change14to7 = theta7 - theta14;

      expect(change14to7).toBeGreaterThan(change30to14);
    });
  });

  describe('calculateThetaPerDay', () => {
    it('should return 0 for expired markets', () => {
      expect(calculateThetaPerDay(0, 0.10)).toBe(0);
      expect(calculateThetaPerDay(-1, 0.10)).toBe(0);
    });

    it('should return positive decay for active markets with edge', () => {
      const decay = calculateThetaPerDay(7, 0.10);
      expect(decay).toBeGreaterThan(0);
    });

    it('should scale with edge size', () => {
      const decay5 = calculateThetaPerDay(7, 0.05);
      const decay10 = calculateThetaPerDay(7, 0.10);
      const decay20 = calculateThetaPerDay(7, 0.20);

      expect(decay10).toBeGreaterThan(decay5);
      expect(decay20).toBeGreaterThan(decay10);
    });

    it('should be highest around inflection point', () => {
      // Theta per day is based on sigmoid derivative, highest at inflection (7 days)
      const decay30 = calculateThetaPerDay(30, 0.10);
      const decay14 = calculateThetaPerDay(14, 0.10);
      const decay7 = calculateThetaPerDay(7, 0.10);

      // Decay should increase as we approach inflection point
      expect(decay14).toBeGreaterThan(decay30);
      expect(decay7).toBeGreaterThan(decay14);
    });
  });

  describe('getUrgencyLevel', () => {
    it('should return critical for <1 day', () => {
      expect(getUrgencyLevel(0.5)).toBe('critical');
      expect(getUrgencyLevel(1)).toBe('critical');
    });

    it('should return high for 1-3 days', () => {
      expect(getUrgencyLevel(2)).toBe('high');
      expect(getUrgencyLevel(3)).toBe('high');
    });

    it('should return medium for 3-7 days', () => {
      expect(getUrgencyLevel(5)).toBe('medium');
      expect(getUrgencyLevel(7)).toBe('medium');
    });

    it('should return low for >7 days', () => {
      expect(getUrgencyLevel(10)).toBe('low');
      expect(getUrgencyLevel(30)).toBe('low');
      expect(getUrgencyLevel(365)).toBe('low');
    });
  });

  describe('getRecommendedOrderType', () => {
    it('should recommend market order for critical urgency', () => {
      expect(getRecommendedOrderType(0.5, 0.05)).toBe('market');
      expect(getRecommendedOrderType(1, 0.05)).toBe('market');
    });

    it('should recommend market order for high edge with little time', () => {
      expect(getRecommendedOrderType(2, 0.12)).toBe('market');
      expect(getRecommendedOrderType(3, 0.10)).toBe('market');
    });

    it('should recommend limit order for low edge with time', () => {
      expect(getRecommendedOrderType(10, 0.05)).toBe('limit');
      expect(getRecommendedOrderType(30, 0.08)).toBe('limit');
    });

    it('should recommend market order for large edges', () => {
      expect(getRecommendedOrderType(10, 0.15)).toBe('market');
    });
  });

  describe('calculateTimeDecay', () => {
    it('should return complete model with all fields', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      const model = calculateTimeDecay(futureDate);

      expect(model).toHaveProperty('daysToExpiry');
      expect(model).toHaveProperty('hoursToExpiry');
      expect(model).toHaveProperty('theta');
      expect(model).toHaveProperty('thetaPerDay');
      expect(model).toHaveProperty('urgencyLevel');
      expect(model).toHaveProperty('recommendedOrderType');
      expect(model).toHaveProperty('reasoning');
    });

    it('should calculate correct values for 14 days', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      const model = calculateTimeDecay(futureDate);

      expect(model.daysToExpiry).toBeCloseTo(14, 0);
      expect(model.urgencyLevel).toBe('low');
      expect(model.theta).toBeGreaterThan(0);
      expect(model.theta).toBeLessThan(0.5);
    });

    it('should handle undefined closeTime', () => {
      const model = calculateTimeDecay(undefined);

      expect(model.daysToExpiry).toBeCloseTo(365, 0);
      expect(model.urgencyLevel).toBe('low');
      expect(model.theta).toBe(0);
    });
  });

  describe('adjustEdgeForTheta', () => {
    it('should reduce edge for near-expiry markets', () => {
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      const adjusted = adjustEdgeForTheta(0.10, soonDate);

      expect(adjusted.adjustedEdge).toBeLessThan(adjusted.rawEdge);
      expect(adjusted.decayApplied).toBeGreaterThan(0);
    });

    it('should preserve most edge for far-expiry markets', () => {
      const farDate = new Date();
      farDate.setDate(farDate.getDate() + 60);
      const adjusted = adjustEdgeForTheta(0.10, farDate);

      expect(adjusted.adjustedEdge).toBeCloseTo(adjusted.rawEdge, 2);
      expect(adjusted.decayApplied).toBeCloseTo(0, 1);
    });

    it('should calculate days until edge lost', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      const adjusted = adjustEdgeForTheta(0.10, futureDate);

      expect(adjusted.daysUntilEdgeLost).toBeGreaterThan(0);
    });

    it('should include reasoning', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const adjusted = adjustEdgeForTheta(0.10, futureDate);

      expect(adjusted.reasoning).toBeTruthy();
      expect(adjusted.reasoning.length).toBeGreaterThan(10);
    });
  });

  describe('getLimitOrderAdjustmentFactor', () => {
    it('should return 0.7 for 30+ days', () => {
      expect(getLimitOrderAdjustmentFactor(30)).toBe(0.7);
      expect(getLimitOrderAdjustmentFactor(60)).toBe(0.7);
      expect(getLimitOrderAdjustmentFactor(100)).toBe(0.7);
    });

    it('should return 0.8 for 14-30 days', () => {
      expect(getLimitOrderAdjustmentFactor(14)).toBe(0.8);
      expect(getLimitOrderAdjustmentFactor(20)).toBe(0.8);
    });

    it('should return 0.9 for 7-14 days', () => {
      expect(getLimitOrderAdjustmentFactor(7)).toBe(0.9);
      expect(getLimitOrderAdjustmentFactor(10)).toBe(0.9);
    });

    it('should return 1.0 for <7 days (market order territory)', () => {
      expect(getLimitOrderAdjustmentFactor(3)).toBe(1.0);
      expect(getLimitOrderAdjustmentFactor(1)).toBe(1.0);
    });
  });

  describe('formatThetaDisplay', () => {
    it('should show EXPIRED for expired markets', () => {
      const model = calculateTimeDecay(new Date(Date.now() - 86400000));
      const display = formatThetaDisplay(model);

      expect(display).toContain('EXPIRED');
    });

    it('should show urgency emoji for critical', () => {
      const model = calculateTimeDecay(new Date(Date.now() + 12 * 60 * 60 * 1000));
      const display = formatThetaDisplay(model);

      expect(display).toMatch(/[🚨⚠️⏳📅]/);
    });

    it('should include theta percentage', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const model = calculateTimeDecay(futureDate);
      const display = formatThetaDisplay(model);

      expect(display).toMatch(/Theta: \d+%/);
    });

    it('should include decay per day', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const model = calculateTimeDecay(futureDate);
      const display = formatThetaDisplay(model);

      expect(display).toMatch(/Decay: ~[\d.]+%\/day/);
    });
  });
});

describe('Time-Decay Edge Cases', () => {
  it('should handle boundary near 60 days', () => {
    const theta59 = calculateTheta(59);
    const theta60 = calculateTheta(60);
    const theta61 = calculateTheta(61);

    // At 60 days, theta is very close to 0 but may have tiny residual
    expect(theta59).toBeGreaterThan(0);
    expect(theta60).toBeLessThan(0.01); // Effectively 0
    expect(theta61).toBe(0); // Beyond 60 returns exactly 0
  });

  it('should handle fractional days', () => {
    const theta = calculateTheta(7.5);
    expect(theta).toBeGreaterThan(0);
    expect(theta).toBeLessThan(1);
  });

  it('should handle very small edges', () => {
    const adjusted = adjustEdgeForTheta(0.001, new Date(Date.now() + 7 * 86400000));
    expect(adjusted.adjustedEdge).toBeGreaterThanOrEqual(0);
    expect(adjusted.adjustedEdge).toBeLessThanOrEqual(0.001);
  });

  it('should handle very large edges', () => {
    const adjusted = adjustEdgeForTheta(0.50, new Date(Date.now() + 7 * 86400000));
    expect(adjusted.adjustedEdge).toBeGreaterThan(0);
    expect(adjusted.adjustedEdge).toBeLessThanOrEqual(0.50);
  });
});
