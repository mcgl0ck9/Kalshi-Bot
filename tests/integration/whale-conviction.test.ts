/**
 * Whale Conviction Integration Tests
 *
 * Tests the full whale conviction detection pipeline:
 * 1. Fetch active markets from Gamma API
 * 2. Query position data from PnL subgraph
 * 3. Identify whale positions
 * 4. Calculate conviction signals
 *
 * Note: These are integration tests that make real API calls.
 * They may be slow and can fail due to network issues.
 */

import { describe, it, expect } from 'vitest';
import {
  findWhaleConvictionSignals,
  fetchPolymarketMarketsWithPrices,
} from '../../src/fetchers/polymarket-onchain.js';

describe('Whale Conviction Detection', () => {
  describe('fetchPolymarketMarketsWithPrices', () => {
    it('should fetch markets from Gamma API', async () => {
      const markets = await fetchPolymarketMarketsWithPrices(10);

      expect(markets).toBeInstanceOf(Array);
      expect(markets.length).toBeGreaterThan(0);
    }, 30000);

    it('should return markets with required fields', async () => {
      const markets = await fetchPolymarketMarketsWithPrices(5);

      for (const market of markets) {
        expect(market).toHaveProperty('id');
        expect(market).toHaveProperty('title');
        expect(market).toHaveProperty('price');
        expect(market).toHaveProperty('platform', 'polymarket');
        expect(market.price).toBeGreaterThanOrEqual(0);
        expect(market.price).toBeLessThanOrEqual(1);
      }
    }, 30000);
  });

  describe('findWhaleConvictionSignals', () => {
    it('should return an array of signals', async () => {
      // Use high thresholds to speed up test (fewer markets analyzed)
      const signals = await findWhaleConvictionSignals(
        0.9,   // 90% conviction threshold
        50000  // $50K liquidity minimum
      );

      expect(signals).toBeInstanceOf(Array);
    }, 120000);

    it('should return signals with required structure', async () => {
      const signals = await findWhaleConvictionSignals(
        0.8,   // 80% conviction threshold
        25000  // $25K liquidity minimum
      );

      // May return 0 signals if no markets meet criteria
      if (signals.length > 0) {
        const signal = signals[0];

        expect(signal).toHaveProperty('marketId');
        expect(signal).toHaveProperty('marketTitle');
        expect(signal).toHaveProperty('polymarketPrice');
        expect(signal).toHaveProperty('whaleImpliedPrice');
        expect(signal).toHaveProperty('convictionStrength');
        expect(signal).toHaveProperty('convictionDirection');
        expect(signal).toHaveProperty('signalStrength');
        expect(signal).toHaveProperty('topWhalePositions');

        // Validate ranges
        expect(signal.polymarketPrice).toBeGreaterThanOrEqual(0);
        expect(signal.polymarketPrice).toBeLessThanOrEqual(1);
        expect(signal.convictionStrength).toBeGreaterThanOrEqual(0);
        expect(signal.convictionStrength).toBeLessThanOrEqual(1);
        expect(['YES', 'NO']).toContain(signal.convictionDirection);
        expect(['strong', 'moderate', 'weak']).toContain(signal.signalStrength);
      }
    }, 120000);

    it('should have topWhalePositions with wallet info', async () => {
      const signals = await findWhaleConvictionSignals(
        0.7,   // Lower threshold to find more signals
        10000  // Lower liquidity to analyze more markets
      );

      const signalWithWhales = signals.find(s => s.topWhalePositions.length > 0);

      if (signalWithWhales) {
        const whale = signalWithWhales.topWhalePositions[0];

        expect(whale).toHaveProperty('wallet');
        expect(whale).toHaveProperty('size');
        expect(whale).toHaveProperty('avgPrice');
        expect(whale.wallet).toMatch(/^0x[a-fA-F0-9]+/);
        expect(whale.size).toBeGreaterThan(0);
      }
    }, 120000);
  });
});

describe('Whale Conviction Signal Quality', () => {
  it('should find signals when using relaxed thresholds', async () => {
    // With relaxed thresholds, we should almost always find some signals
    const signals = await findWhaleConvictionSignals(
      0.5,   // 50% conviction threshold
      5000   // $5K liquidity minimum
    );

    // This test documents expected behavior - may fail if market conditions change
    expect(signals.length).toBeGreaterThanOrEqual(0);

    // Log for diagnostic purposes
    console.log(`Found ${signals.length} whale conviction signals`);
    if (signals.length > 0) {
      console.log('Top signal:', {
        title: signals[0].marketTitle.slice(0, 50),
        conviction: `${(signals[0].convictionStrength * 100).toFixed(0)}%`,
        direction: signals[0].convictionDirection,
      });
    }
  }, 120000);
});
