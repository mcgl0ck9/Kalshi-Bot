/**
 * Spread Arbitrage Unit Tests
 *
 * Tests guaranteed profit detection when YES + NO < $1.00
 */

import { describe, it, expect } from 'vitest';
import {
  calculateKalshiFee,
  calculateSpreadArbitrageFees,
  checkSpreadArbitrage,
  detectSpreadArbitrage,
  spreadArbitrageToEdge,
  formatSpreadArbitrageAlert,
  formatSpreadArbitrageSummary,
  type SpreadArbitrageOpportunity,
} from '../../../src/edge/spread-arbitrage.js';
import type { Market } from '../../../src/types/index.js';

describe('calculateKalshiFee', () => {
  it('should calculate fee correctly at 50% price', () => {
    // Fee = 0.07 * 100 * 0.5 * 0.5 = 1.75
    // ceil(1.75 * 100) / 100 = 176/100 = $1.76
    const fee = calculateKalshiFee(100, 0.5);
    expect(fee).toBe(1.76);
  });

  it('should calculate fee correctly at extreme prices', () => {
    // At 10%: 0.07 * 100 * 0.1 * 0.9 = 0.63
    // ceil(0.63 * 100) / 100 = 64/100 = $0.64
    const feeLow = calculateKalshiFee(100, 0.1);
    expect(feeLow).toBe(0.64);

    // At 90%: 0.07 * 100 * 0.9 * 0.1 = 0.63
    // ceil(0.63 * 100) / 100 = $0.63
    const feeHigh = calculateKalshiFee(100, 0.9);
    expect(feeHigh).toBe(0.63);
  });

  it('should return 0 for 0 contracts', () => {
    const fee = calculateKalshiFee(0, 0.5);
    expect(fee).toBe(0);
  });

  it('should scale with contract count', () => {
    const fee100 = calculateKalshiFee(100, 0.5);
    const fee200 = calculateKalshiFee(200, 0.5);
    expect(fee200).toBeGreaterThan(fee100);
  });
});

describe('calculateSpreadArbitrageFees', () => {
  it('should calculate combined fees for both sides', () => {
    // Buy YES at 45¢, NO at 52¢
    const fees = calculateSpreadArbitrageFees(100, 0.45, 0.52);

    // YES fee: 0.07 * 100 * 0.45 * 0.55 = 1.7325
    // NO fee: 0.07 * 100 * 0.52 * 0.48 = 1.7472
    // Total should be ~$3.48
    expect(fees).toBeGreaterThan(3.0);
    expect(fees).toBeLessThan(4.0);
  });

  it('should handle extreme asymmetric prices', () => {
    // Very low YES (5¢), high NO (90¢)
    const fees = calculateSpreadArbitrageFees(100, 0.05, 0.90);
    // YES fee: 0.07 * 100 * 0.05 * 0.95 = 0.3325
    // NO fee: 0.07 * 100 * 0.90 * 0.10 = 0.63
    // Total ~$0.97
    expect(fees).toBeGreaterThan(0.5);
    expect(fees).toBeLessThan(1.5);
  });
});

describe('checkSpreadArbitrage', () => {
  const createMockMarket = (yesPrice: number, noPrice?: number): Market => ({
    id: 'test-market',
    ticker: 'TEST',
    title: 'Test Market',
    price: yesPrice,
    outcomes: noPrice ? [
      { outcome: 'Yes', price: yesPrice },
      { outcome: 'No', price: noPrice },
    ] : undefined,
    url: 'https://kalshi.com/markets/test',
  } as Market);

  it('should detect arbitrage when YES + NO < $1.00 with sufficient spread', () => {
    // Need larger spread to overcome fees (~3.5% of position)
    // Total cost 90¢ = 10¢ gross profit per contract
    // Fees ~$3.50 for 100 contracts = 3.5¢ per contract
    // Net ~6.5¢ per contract - should be profitable
    const market = createMockMarket(0.40, 0.50);
    const result = checkSpreadArbitrage(market);

    expect(result).not.toBeNull();
    expect(result?.totalCost).toBe(0.90);
    expect(result?.grossProfit).toBeCloseTo(0.10, 2);
    expect(result?.guaranteed).toBe(true);
  });

  it('should return null when YES + NO >= $1.00', () => {
    const market = createMockMarket(0.50, 0.50);
    const result = checkSpreadArbitrage(market);

    expect(result).toBeNull();
  });

  it('should return null when profit after fees is too small', () => {
    // 98¢ + 2¢ = 100¢ → no profit
    const market = createMockMarket(0.49, 0.49);
    const result = checkSpreadArbitrage(market);

    expect(result).toBeNull();
  });

  it('should include fee estimate in opportunity', () => {
    const market = createMockMarket(0.40, 0.50);
    const result = checkSpreadArbitrage(market);

    expect(result).not.toBeNull();
    expect(result?.feeEstimate).toBeGreaterThan(0);
    expect(result?.netProfit).toBeLessThan(result?.grossProfit ?? 0);
  });

  it('should calculate profit percentages correctly', () => {
    const market = createMockMarket(0.40, 0.50);
    const result = checkSpreadArbitrage(market);

    expect(result).not.toBeNull();
    if (result) {
      // Gross profit = 10¢ on 90¢ cost = 11.11%
      expect(result.grossProfitPercent).toBeCloseTo(11.11, 0);
      // Net profit percent should be lower due to fees
      expect(result.netProfitPercent).toBeLessThan(result.grossProfitPercent);
    }
  });

  it('should use provided prices when outcomes not available', () => {
    const market = createMockMarket(0.40);
    const result = checkSpreadArbitrage(market, 0.40, 0.55);

    expect(result).not.toBeNull();
    expect(result?.yesPrice).toBe(0.40);
    expect(result?.noPrice).toBe(0.55);
  });

  it('should generate correct action string', () => {
    const market = createMockMarket(0.42, 0.53);
    const result = checkSpreadArbitrage(market);

    expect(result?.action).toContain('42');
    expect(result?.action).toContain('53');
  });

  it('should generate reasoning', () => {
    const market = createMockMarket(0.42, 0.53);
    const result = checkSpreadArbitrage(market);

    expect(result?.reasoning).toContain('95');
    expect(result?.reasoning).toContain('$1.00');
  });
});

describe('detectSpreadArbitrage', () => {
  const createMockMarket = (id: string, yesPrice: number, noPrice: number): Market => ({
    id,
    ticker: id.toUpperCase(),
    title: `Test Market ${id}`,
    price: yesPrice,
    outcomes: [
      { outcome: 'Yes', price: yesPrice },
      { outcome: 'No', price: noPrice },
    ],
  } as Market);

  it('should find all arbitrage opportunities', () => {
    const markets = [
      createMockMarket('arb1', 0.40, 0.50),    // 90¢ = 10¢ profit
      createMockMarket('no-arb', 0.50, 0.50),  // 100¢ = no profit
      createMockMarket('arb2', 0.35, 0.55),    // 90¢ = 10¢ profit
    ];

    const results = detectSpreadArbitrage(markets);

    expect(results.length).toBe(2);
    expect(results.some(r => r.market.id === 'arb1')).toBe(true);
    expect(results.some(r => r.market.id === 'arb2')).toBe(true);
  });

  it('should sort by net profit (highest first)', () => {
    // Use larger spreads to overcome ~3.5% fees
    const markets = [
      createMockMarket('small', 0.35, 0.55),   // 90¢ = 10¢ profit
      createMockMarket('large', 0.25, 0.55),   // 80¢ = 20¢ profit
      createMockMarket('medium', 0.30, 0.55),  // 85¢ = 15¢ profit
    ];

    const results = detectSpreadArbitrage(markets);

    expect(results.length).toBe(3);
    expect(results[0].grossProfit).toBeGreaterThan(results[1].grossProfit);
    expect(results[1].grossProfit).toBeGreaterThan(results[2].grossProfit);
  });

  it('should return empty array when no opportunities', () => {
    const markets = [
      createMockMarket('m1', 0.50, 0.50),
      createMockMarket('m2', 0.60, 0.40),
      createMockMarket('m3', 0.55, 0.55),
    ];

    const results = detectSpreadArbitrage(markets);
    expect(results.length).toBe(0);
  });
});

describe('spreadArbitrageToEdge', () => {
  const mockArb: SpreadArbitrageOpportunity = {
    market: {
      id: 'test',
      ticker: 'TEST',
      title: 'Test Market',
      price: 0.40,
    } as Market,
    yesPrice: 0.40,
    noPrice: 0.55,
    totalCost: 0.95,
    grossProfit: 0.05,
    grossProfitPercent: 5.26,
    feeEstimate: 0.01,
    netProfit: 0.04,
    netProfitPercent: 4.21,
    guaranteed: true,
    action: 'Buy YES @ 40¢ + NO @ 55¢',
    reasoning: 'Test reasoning',
  };

  it('should convert to EdgeOpportunity format', () => {
    const edge = spreadArbitrageToEdge(mockArb);

    expect(edge.market).toBe(mockArb.market);
    expect(edge.source).toBe('combined');
    expect(edge.edge).toBe(mockArb.netProfit);
    expect(edge.confidence).toBe(1.0); // 100% confidence
    expect(edge.urgency).toBe('critical');
    expect(edge.direction).toBe('BUY YES');
  });

  it('should include correct sizing info', () => {
    const edge = spreadArbitrageToEdge(mockArb);

    expect(edge.sizing).toBeDefined();
    expect(edge.sizing?.positionSize).toBe(100);
    expect(edge.sizing?.kellyFraction).toBe(1.0);
    expect(edge.sizing?.adjustedKelly).toBe(1.0);
    expect(edge.sizing?.edge).toBe(mockArb.netProfit);
    expect(edge.sizing?.confidence).toBe(1.0);
  });
});

describe('formatSpreadArbitrageAlert', () => {
  const mockArb: SpreadArbitrageOpportunity = {
    market: {
      id: 'test',
      ticker: 'TEST',
      title: 'Will Bitcoin hit $100K?',
      subtitle: 'By end of 2026',
      price: 0.45,
      url: 'https://kalshi.com/markets/test',
    } as Market,
    yesPrice: 0.45,
    noPrice: 0.52,
    totalCost: 0.97,
    grossProfit: 0.03,
    grossProfitPercent: 3.09,
    feeEstimate: 0.015,
    netProfit: 0.015,
    netProfitPercent: 1.55,
    guaranteed: true,
    action: 'Buy YES @ 45¢ + NO @ 52¢',
    reasoning: 'Combined cost 97¢ < $1.00 payout.',
  };

  it('should include header with profit amount', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('SPREAD ARBITRAGE');
    expect(alert).toContain('GUARANTEED');
    expect(alert).toContain('PROFIT');
  });

  it('should include market title', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('Bitcoin');
    expect(alert).toContain('$100K');
  });

  it('should show current prices', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('45');
    expect(alert).toContain('52');
    expect(alert).toContain('97');
  });

  it('should show profit breakdown', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('Gross');
    expect(alert).toContain('Fees');
    expect(alert).toContain('Net');
  });

  it('should include capital example', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('$100');
    expect(alert).toContain('contracts');
  });

  it('should include trade link', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('TRADE ON KALSHI');
    expect(alert).toContain('kalshi.com');
  });

  it('should include urgency warning', () => {
    const alert = formatSpreadArbitrageAlert(mockArb);

    expect(alert).toContain('Act fast');
  });
});

describe('formatSpreadArbitrageSummary', () => {
  it('should show message when no opportunities', () => {
    const summary = formatSpreadArbitrageSummary([]);

    expect(summary).toContain('No spread arbitrage');
  });

  it('should list all opportunities', () => {
    const opps: SpreadArbitrageOpportunity[] = [
      {
        market: { id: '1', title: 'Market One' } as Market,
        yesPrice: 0.40,
        noPrice: 0.50,
        totalCost: 0.90,
        grossProfit: 0.10,
        grossProfitPercent: 11.11,
        feeEstimate: 0.02,
        netProfit: 0.08,
        netProfitPercent: 8.89,
        guaranteed: true,
        action: 'Buy',
        reasoning: 'Test',
      },
      {
        market: { id: '2', title: 'Market Two' } as Market,
        yesPrice: 0.45,
        noPrice: 0.50,
        totalCost: 0.95,
        grossProfit: 0.05,
        grossProfitPercent: 5.26,
        feeEstimate: 0.01,
        netProfit: 0.04,
        netProfitPercent: 4.21,
        guaranteed: true,
        action: 'Buy',
        reasoning: 'Test',
      },
    ];

    const summary = formatSpreadArbitrageSummary(opps);

    expect(summary).toContain('2 SPREAD ARBITRAGE');
    expect(summary).toContain('Market One');
    expect(summary).toContain('Market Two');
  });

  it('should truncate long market titles', () => {
    const opps: SpreadArbitrageOpportunity[] = [
      {
        market: {
          id: '1',
          title: 'This is a very long market title that should be truncated for display purposes',
        } as Market,
        yesPrice: 0.40,
        noPrice: 0.50,
        totalCost: 0.90,
        grossProfit: 0.10,
        grossProfitPercent: 11.11,
        feeEstimate: 0.02,
        netProfit: 0.08,
        netProfitPercent: 8.89,
        guaranteed: true,
        action: 'Buy',
        reasoning: 'Test',
      },
    ];

    const summary = formatSpreadArbitrageSummary(opps);

    expect(summary).toContain('...');
    expect(summary.length).toBeLessThan(500);
  });

  it('should use correct singular/plural', () => {
    const single: SpreadArbitrageOpportunity[] = [
      {
        market: { id: '1', title: 'Market' } as Market,
        yesPrice: 0.40,
        noPrice: 0.50,
        totalCost: 0.90,
        grossProfit: 0.10,
        grossProfitPercent: 11.11,
        feeEstimate: 0.02,
        netProfit: 0.08,
        netProfitPercent: 8.89,
        guaranteed: true,
        action: 'Buy',
        reasoning: 'Test',
      },
    ];

    const summary = formatSpreadArbitrageSummary(single);
    expect(summary).toContain('OPPORTUNITY');
    expect(summary).not.toContain('OPPORTUNITIES');
  });
});
