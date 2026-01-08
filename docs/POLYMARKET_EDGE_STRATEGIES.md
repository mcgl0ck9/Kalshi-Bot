# Polymarket Edge Strategies Integration Plan

## Research Summary

Based on comprehensive analysis of Polymarket trading strategies, whale behavior, and academic research on prediction market arbitrage, this document outlines actionable enhancements for the Kalshi Edge Detector.

---

## 1. INSIDER SCORE DETECTION (Priority: HIGH)

### Source: [PolyWhaler Methodology](https://www.polywhaler.com/)

PolyWhaler assigns an **insider score (0-100)** to evaluate the likelihood that a trade represents informed knowledge.

### Detection Signals

| Signal | Weight | Description |
|--------|--------|-------------|
| Low probability bets | High | Large bets on outcomes priced <15% or >85% |
| Unusual trade size | High | Trade significantly larger than market norm |
| Suspicious timing | Medium | Trades clustered before news events |
| High-risk context | Medium | First-mover in newly opened markets |
| Historical accuracy | High | Wallet's past prediction success rate |

### Implementation for Our Bot

```typescript
// src/realtime/insider-score.ts
interface InsiderScoreFactors {
  lowProbBet: boolean;       // Betting on <15% or >85% outcome
  unusualSize: number;       // Multiple of average trade size
  timingScore: number;       // Proximity to news/events
  walletAccuracy: number;    // Historical win rate
  firstMover: boolean;       // Early in new market
}

function calculateInsiderScore(factors: InsiderScoreFactors): number {
  let score = 0;
  if (factors.lowProbBet) score += 25;
  score += Math.min(25, factors.unusualSize * 5);
  score += factors.timingScore * 20;
  score += factors.walletAccuracy * 20;
  if (factors.firstMover) score += 10;
  return Math.min(100, score);
}
```

### Current State
Our `UnusualActivityDetector` already tracks whale trades but doesn't compute an insider score. Enhancement needed.

---

## 2. FRENCH WHALE STRATEGY ADAPTATION (Priority: HIGH)

### Source: [$85M French Whale Case Study](https://www.polytrackhq.app/blog/polymarket-french-whale-case-study)

The most profitable prediction market trader used systematic, data-driven methodology.

### Key Techniques

#### 2a. Proprietary Bias Modeling
The trader built models addressing **systematic polling biases** (e.g., "shy Trump voter phenomenon").

**For our bot**: We should weight signals differently based on known biases:
- Sports: Home team bias in public betting
- Politics: Polling methodology adjustments
- Economics: Market "Fed put" over-optimism

#### 2b. Correlated Market Diversification
Positions were built across **related but non-identical markets**:
- Presidential winner + swing states + popular vote + electoral thresholds

**For our bot**: When we detect an edge in one market, scan for correlated markets:

```typescript
// src/edge/correlated-markets.ts
const MARKET_CORRELATIONS = {
  'presidential_winner': [
    'swing_state_*',
    'electoral_vote_*',
    'popular_vote'
  ],
  'superbowl_winner': [
    'conference_champion_*',
    'playoff_*'
  ],
  'fed_rate_decision': [
    'recession_*',
    'inflation_*',
    'treasury_*'
  ]
};
```

#### 2c. Conviction-Scaled Position Sizing
- **Early positions (biggest edge) → largest allocation**
- **As price moves toward fair value → decrease position size**
- **Take profits gradually, don't chase rising odds**

**Current state**: Our Kelly criterion is static. Enhancement: Dynamic Kelly that scales down as edge narrows.

#### 2d. Limit Order Accumulation
The whale used **limit orders at specific price points** rather than market orders.

**Current state**: We already implemented limit order recommendations in `src/models/limit-order.ts`. Good foundation.

---

## 3. ADVANCED ARBITRAGE DETECTION (Priority: MEDIUM)

### Source: [arXiv:2508.03474 - Arbitrage in Prediction Markets](https://arxiv.org/abs/2508.03474)

Academic research shows **$40M+ extracted via arbitrage** in 2024.

### Types of Arbitrage

#### 3a. Binary Complement Arbitrage (IMPLEMENTED)
Already implemented in `src/detectors/arbitrage.ts`:
- Detection: YES + NO < $1.00
- Net profit calculation after Kalshi fees

#### 3b. Bundle Arbitrage (NEW)
In multi-outcome markets, buy ALL outcomes when total < $1.00.

```typescript
// Example: "Who will win the Super Bowl?"
// If all team prices sum to $0.97, buy all → guaranteed 3% profit
function detectBundleArbitrage(outcomes: Outcome[]): number {
  const totalCost = outcomes.reduce((sum, o) => sum + o.price, 0);
  if (totalCost < 1.0) {
    return 1.0 - totalCost; // Profit per share
  }
  return 0;
}
```

#### 3c. Combinatorial Arbitrage (NEW)
Cross-market arbitrage on **dependent assets**.

Example: If Trump wins presidency, probability of certain cabinet picks changes.

```typescript
// Detect when conditional probabilities are mispriced
// P(A and B) should equal P(A) * P(B|A)
function detectCombinatorialArb(
  marketA: Market,
  marketB: Market,
  conditionalB: number // P(B|A)
): number | null {
  const impliedJoint = marketA.price * conditionalB;
  const marketJoint = marketB.price;
  return Math.abs(impliedJoint - marketJoint);
}
```

#### 3d. Correlated Asset Lag (NEW)
When a primary event resolves, related markets take time to reprice.

Example:
1. Trump wins election → Primary market resolves
2. "Trump cabinet picks" markets haven't updated → Edge exists for ~minutes

**For our bot**: Monitor resolution events and immediately scan correlated markets.

---

## 4. SETTLEMENT RULES ARBITRAGE (Priority: MEDIUM)

### Source: [DataWallet Strategies](https://www.datawallet.com/crypto/top-polymarket-trading-strategies)

Markets often misprice because traders read headlines, not resolution criteria.

### Implementation

```typescript
// Parse resolution rules into decision tree
interface ResolutionTree {
  condition: string;
  probability: number;
  children?: ResolutionTree[];
}

// Example: "Will Biden step down before 2024 election?"
// Resolution: "Must announce resignation, not just decline to run"
// Traders betting on "decline to run" would lose

function analyzeSettlementRules(market: Market): {
  misunderstandingRisk: number;
  clarificationNeeded: string[];
} {
  // Parse market description
  // Identify ambiguous terms
  // Flag potential mispricing
}
```

---

## 5. TERM-STRUCTURE SPREADS (Priority: LOW)

Compare identical markets with different expiration dates.

Example:
- "Bitcoin above $100K by March 2026" @ 45¢
- "Bitcoin above $100K by June 2026" @ 52¢
- Spread implies 7% probability of hitting between March-June

If historical volatility suggests different probability, there's an edge.

---

## 6. "NO" BIAS EXPLOITATION (Priority: HIGH - For Mentions Markets)

### Concept
Phrase-prediction markets (earnings mentions) are systematically overpriced for YES because:
- Traders bet on narrative excitement
- Actual speaker transcript history shows lower mention rates

### Implementation

We already have transcript analysis in `src/fetchers/transcript-parser.ts`. Enhancement:

```typescript
// Compare market YES price to historical mention rate
function detectNoBiasEdge(
  market: MentionsMarket,
  historicalMentionRate: number
): Edge | null {
  const impliedRate = market.yesPrice;

  // If market implies 60% chance but history shows 30%
  if (impliedRate > historicalMentionRate * 1.5) {
    return createEdge(
      market,
      'NO',
      impliedRate - historicalMentionRate,
      0.75,
      `Historical transcript analysis shows ${keyword} mentioned ` +
      `${historicalMentionRate}% of time, market prices at ${impliedRate}%`
    );
  }
}
```

---

## 7. WHALE PERFORMANCE TRACKING (Priority: HIGH)

### Source: [PolyWhaler](https://www.polywhaler.com/)

Track whale wallets by **historical PnL and win rate** to weight signals.

### Implementation

We have whale tracking in `src/fetchers/whales.ts`. Enhancement needed:

```typescript
interface WhaleProfile {
  address: string;
  totalPnL: number;
  winRate: number;
  avgPositionSize: number;
  categories: {
    [category: string]: {
      winRate: number;
      sampleSize: number;
    };
  };
  lastActive: Date;
}

// Weight whale signals by historical performance
function getWhaleSignalWeight(whale: WhaleProfile, category: string): number {
  const categoryStats = whale.categories[category];
  if (!categoryStats || categoryStats.sampleSize < 10) {
    return 1.0; // Default weight
  }

  // Higher weight for whales with >60% win rate
  return 0.5 + categoryStats.winRate;
}
```

---

## 8. VOLUME VELOCITY DETECTION (Priority: HIGH)

### Already Implemented
Our `VelocityTracker` in `src/realtime/velocity-tracker.ts` tracks rate-of-change.

### Enhancement
Combine velocity with **cross-platform price comparison** for immediate edge detection:

```typescript
// When Polymarket shows velocity spike, immediately check Kalshi price
async function onVelocityAlert(alert: VelocityAlert): Promise<Edge | null> {
  const kalshiMarket = await findKalshiEquivalent(alert.market);
  if (!kalshiMarket) return null;

  const priceDiff = Math.abs(alert.currentPrice - kalshiMarket.price);
  if (priceDiff > 0.05) {
    return createUrgentEdge(kalshiMarket, alert);
  }
}
```

---

## IMPLEMENTATION PRIORITY

| Phase | Enhancement | Effort | Impact |
|-------|-------------|--------|--------|
| 1 | Insider Score calculation | Medium | High |
| 1 | "No" Bias for Mentions | Low | High |
| 1 | Whale performance weighting | Medium | High |
| 2 | Correlated market scanning | Medium | High |
| 2 | Bundle arbitrage detection | Low | Medium |
| 2 | Velocity→Kalshi bridge | Medium | High |
| 3 | Combinatorial arbitrage | High | Medium |
| 3 | Settlement rules parser | High | Medium |
| 3 | Term-structure spreads | Medium | Low |

---

## FILES TO CREATE/MODIFY

### New Files
- `src/edge/insider-score.ts` - Insider probability scoring
- `src/edge/correlated-markets.ts` - Related market scanner
- `src/edge/bundle-arbitrage.ts` - Multi-outcome arbitrage
- `src/edge/no-bias.ts` - Systematic NO bias detection

### Modifications
- `src/detectors/whale.ts` - Add performance weighting
- `src/detectors/mentions.ts` - Add transcript-based NO bias
- `src/realtime/unusual-activity.ts` - Add insider score
- `src/models/limit-order.ts` - Add conviction scaling

---

## ACADEMIC REFERENCES

1. **arXiv:2508.03474** - "Unravelling the Probabilistic Forest: Arbitrage in Prediction Markets"
   - $40M+ extracted via arbitrage 2024
   - Combinatorial arbitrage methodology

2. **arXiv:2004.08290** - Order flow imbalance research
   - Already integrated in unusual-activity.ts

3. **French Whale Case Study** - $85M profit methodology
   - Systematic bias modeling
   - Conviction-scaled sizing
   - Correlated market diversification

---

*Last Updated: January 2026*
