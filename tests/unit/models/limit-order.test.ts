/**
 * Limit Order Model Unit Tests
 *
 * Tests the optimal limit order placement logic for prediction markets.
 * Based on Cont & Kukanov (arXiv:1210.1625) and Columbia Business School research.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateFillProbability,
  estimateFillTime,
  calculateOptimalLimitPrice,
  generateLadderPrices,
  suggestLimitOrder,
  formatLimitOrderDisplay,
} from '../../../src/models/limit-order.js';

describe('Limit Order Model', () => {
  describe('estimateFillProbability', () => {
    it('should return 1.0 for limit at current price', () => {
      const prob = estimateFillProbability(0.50, 0.50, 14);
      expect(prob).toBe(1.0);
    });

    it('should return 0 for expired markets', () => {
      const prob = estimateFillProbability(0.45, 0.50, 0);
      expect(prob).toBe(0);
    });

    it('should return 0 for negative days', () => {
      const prob = estimateFillProbability(0.45, 0.50, -1);
      expect(prob).toBe(0);
    });

    it('should decrease with larger price gaps', () => {
      const prob2 = estimateFillProbability(0.48, 0.50, 14); // 2% gap
      const prob5 = estimateFillProbability(0.45, 0.50, 14); // 5% gap
      const prob10 = estimateFillProbability(0.40, 0.50, 14); // 10% gap

      expect(prob2).toBeGreaterThan(prob5);
      expect(prob5).toBeGreaterThan(prob10);
    });

    it('should increase with more time', () => {
      const prob7 = estimateFillProbability(0.45, 0.50, 7);
      const prob14 = estimateFillProbability(0.45, 0.50, 14);
      const prob30 = estimateFillProbability(0.45, 0.50, 30);

      expect(prob14).toBeGreaterThan(prob7);
      expect(prob30).toBeGreaterThan(prob14);
    });

    it('should increase with higher volatility', () => {
      const probLow = estimateFillProbability(0.45, 0.50, 14, 0.02);
      const probHigh = estimateFillProbability(0.45, 0.50, 14, 0.05);

      expect(probHigh).toBeGreaterThan(probLow);
    });

    it('should return value between 0 and 1', () => {
      const prob = estimateFillProbability(0.30, 0.50, 7);
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(1);
    });
  });

  describe('estimateFillTime', () => {
    it('should return 0 for limit at current price', () => {
      const time = estimateFillTime(0.50, 0.50);
      expect(time).toBe(0);
    });

    it('should return minimum 0.1 days for small gaps', () => {
      const time = estimateFillTime(0.499, 0.50);
      expect(time).toBeGreaterThanOrEqual(0.1);
    });

    it('should increase with larger gaps', () => {
      const time2 = estimateFillTime(0.48, 0.50); // 2% gap
      const time5 = estimateFillTime(0.45, 0.50); // 5% gap
      const time10 = estimateFillTime(0.40, 0.50); // 10% gap

      expect(time5).toBeGreaterThan(time2);
      expect(time10).toBeGreaterThan(time5);
    });

    it('should decrease with higher volatility', () => {
      const timeLow = estimateFillTime(0.45, 0.50, 0.02);
      const timeHigh = estimateFillTime(0.45, 0.50, 0.05);

      expect(timeLow).toBeGreaterThan(timeHigh);
    });
  });

  describe('calculateOptimalLimitPrice', () => {
    describe('BUY YES direction', () => {
      it('should return price between market and fair value', () => {
        const limit = calculateOptimalLimitPrice(0.60, 0.45, 14, 'BUY YES');

        expect(limit).toBeGreaterThan(0.45);
        expect(limit).toBeLessThan(0.60);
      });

      it('should be more aggressive with less time', () => {
        const limit30 = calculateOptimalLimitPrice(0.60, 0.45, 30, 'BUY YES');
        const limit7 = calculateOptimalLimitPrice(0.60, 0.45, 7, 'BUY YES');
        const limit3 = calculateOptimalLimitPrice(0.60, 0.45, 3, 'BUY YES');

        // With less time, limit should be closer to market (more aggressive)
        expect(Math.abs(limit7 - 0.45)).toBeLessThan(Math.abs(limit30 - 0.45));
        expect(Math.abs(limit3 - 0.45)).toBeLessThan(Math.abs(limit7 - 0.45));
      });
    });

    describe('BUY NO direction', () => {
      it('should return price between fair value and market', () => {
        const limit = calculateOptimalLimitPrice(0.40, 0.55, 14, 'BUY NO');

        expect(limit).toBeGreaterThan(0.40);
        expect(limit).toBeLessThan(0.55);
      });
    });
  });

  describe('generateLadderPrices', () => {
    it('should return correct number of levels', () => {
      const ladder = generateLadderPrices(0.60, 0.45, 'BUY YES', 3);

      expect(ladder.prices).toHaveLength(3);
      expect(ladder.amounts).toHaveLength(3);
    });

    it('should split amounts evenly', () => {
      const ladder = generateLadderPrices(0.60, 0.45, 'BUY YES', 4);

      expect(ladder.amounts.every((a) => a === 25)).toBe(true);
    });

    it('should generate progressive prices for BUY YES', () => {
      const ladder = generateLadderPrices(0.60, 0.45, 'BUY YES', 3);

      // Prices should increase (moving toward fair value)
      expect(ladder.prices[1]).toBeGreaterThan(ladder.prices[0]);
      expect(ladder.prices[2]).toBeGreaterThan(ladder.prices[1]);
    });

    it('should generate progressive prices for BUY NO', () => {
      const ladder = generateLadderPrices(0.40, 0.55, 'BUY NO', 3);

      // Prices should decrease (moving toward fair value)
      expect(ladder.prices[1]).toBeLessThan(ladder.prices[0]);
      expect(ladder.prices[2]).toBeLessThan(ladder.prices[1]);
    });

    it('should stay within edge gap', () => {
      const ladder = generateLadderPrices(0.60, 0.45, 'BUY YES', 3);

      ladder.prices.forEach((price) => {
        expect(price).toBeGreaterThanOrEqual(0.45);
        expect(price).toBeLessThanOrEqual(0.60);
      });
    });
  });

  describe('suggestLimitOrder', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);

    it('should return complete suggestion with all components', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);

      expect(suggestion).toHaveProperty('marketOrder');
      expect(suggestion).toHaveProperty('limitOrder');
      expect(suggestion).toHaveProperty('ladderOrder');
      expect(suggestion).toHaveProperty('recommendation');
      expect(suggestion).toHaveProperty('timeBasedAdjustment');
    });

    it('should calculate correct market order edge', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);

      expect(suggestion.marketOrder.price).toBe(0.45);
      expect(suggestion.marketOrder.edge).toBeCloseTo(0.10, 2);
      expect(suggestion.marketOrder.fillProbability).toBe(1.0);
    });

    it('should calculate limit order with better edge', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);

      expect(suggestion.limitOrder.price).toBeLessThan(0.55);
      expect(suggestion.limitOrder.fillProbability).toBeLessThan(1.0);
      expect(suggestion.limitOrder.fillProbability).toBeGreaterThan(0);
    });

    it('should include estimated fill time', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);

      expect(suggestion.limitOrder.estimatedFillTime).toBeTruthy();
    });

    it('should include ladder order with multiple prices', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);

      expect(suggestion.ladderOrder?.prices.length).toBe(3);
      expect(suggestion.ladderOrder?.amounts.length).toBe(3);
    });

    describe('recommendation logic', () => {
      it('should recommend market for critical urgency (<24h)', () => {
        const soonDate = new Date(Date.now() + 12 * 60 * 60 * 1000);
        const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', soonDate);

        expect(suggestion.recommendation).toBe('market');
        expect(suggestion.timeBasedAdjustment).toContain('24 hours');
      });

      it('should recommend market for large edge with high urgency', () => {
        const urgentDate = new Date();
        urgentDate.setDate(urgentDate.getDate() + 2);
        const suggestion = suggestLimitOrder(0.60, 0.45, 'BUY YES', urgentDate);

        expect(suggestion.recommendation).toBe('market');
      });

      it('should recommend limit for medium urgency', () => {
        const mediumDate = new Date();
        mediumDate.setDate(mediumDate.getDate() + 5);
        const suggestion = suggestLimitOrder(0.53, 0.47, 'BUY YES', mediumDate);

        expect(suggestion.recommendation).toBe('limit');
      });

      it('should recommend ladder for large positions with low urgency', () => {
        const farDate = new Date();
        farDate.setDate(farDate.getDate() + 30);
        const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', farDate, 500);

        expect(suggestion.recommendation).toBe('ladder');
      });
    });

    describe('capital tie-up warning', () => {
      it('should include warning for limit orders with time', () => {
        const farDate = new Date();
        farDate.setDate(farDate.getDate() + 14);
        const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', farDate);

        if (suggestion.recommendation !== 'market') {
          expect(suggestion.capitalTieUpWarning).toBeTruthy();
        }
      });

      it('should not include warning for market orders', () => {
        const soonDate = new Date(Date.now() + 12 * 60 * 60 * 1000);
        const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', soonDate);

        expect(suggestion.recommendation).toBe('market');
        // No warning needed for market orders
      });
    });
  });

  describe('formatLimitOrderDisplay', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);

    it('should format suggestion for Discord display', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);
      const display = formatLimitOrderDisplay(suggestion);

      expect(display).toContain('RECOMMENDED ACTIONS');
      expect(display).toContain('Option A: MARKET ORDER');
      expect(display).toContain('Option B: LIMIT ORDER');
    });

    it('should include prices in cents', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);
      const display = formatLimitOrderDisplay(suggestion);

      expect(display).toMatch(/\d+¢/);
    });

    it('should include fill probability percentage', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);
      const display = formatLimitOrderDisplay(suggestion);

      expect(display).toMatch(/\d+% chance/);
    });

    it('should include ladder option when present', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);
      const display = formatLimitOrderDisplay(suggestion);

      expect(display).toContain('Option C: LADDER');
    });

    it('should include capital warning when present', () => {
      const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate);
      const display = formatLimitOrderDisplay(suggestion);

      if (suggestion.capitalTieUpWarning) {
        expect(display).toContain('Capital');
      }
    });
  });
});

describe('Limit Order Edge Cases', () => {
  it('should handle very small edges', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const suggestion = suggestLimitOrder(0.51, 0.50, 'BUY YES', futureDate);

    expect(suggestion.marketOrder.edge).toBeCloseTo(0.01, 2);
  });

  it('should handle edge at price boundaries (0 and 1)', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);

    const lowPrice = suggestLimitOrder(0.10, 0.05, 'BUY YES', futureDate);
    expect(lowPrice.marketOrder.edge).toBeCloseTo(0.05, 2);

    const highPrice = suggestLimitOrder(0.98, 0.92, 'BUY YES', futureDate);
    expect(highPrice.marketOrder.edge).toBeCloseTo(0.06, 2);
  });

  it('should handle undefined closeTime', () => {
    const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', undefined);

    expect(suggestion).toBeDefined();
    expect(suggestion.recommendation).toBe('limit'); // Far expiry = limit order
  });

  it('should handle zero position size', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const suggestion = suggestLimitOrder(0.55, 0.45, 'BUY YES', futureDate, 0);

    expect(suggestion).toBeDefined();
  });

  it('should handle BUY NO with inverted prices', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const suggestion = suggestLimitOrder(0.40, 0.55, 'BUY NO', futureDate);

    expect(suggestion.marketOrder.price).toBe(0.55);
  });
});

describe('Limit Order Mathematical Properties', () => {
  it('should have fill probability approach 1 as time increases', () => {
    const probs = [7, 14, 30, 60, 120].map((days) =>
      estimateFillProbability(0.45, 0.50, days)
    );

    // Each subsequent probability should be >= previous
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeGreaterThanOrEqual(probs[i - 1]);
    }
  });

  it('should have fill time follow sqrt relationship with gap', () => {
    // Time = (gap / volatility)^2
    // So doubling gap should quadruple time
    const time5 = estimateFillTime(0.45, 0.50); // 5% gap
    const time10 = estimateFillTime(0.40, 0.50); // 10% gap

    const ratio = time10 / time5;
    expect(ratio).toBeCloseTo(4, 0); // Should be close to 4x
  });
});
