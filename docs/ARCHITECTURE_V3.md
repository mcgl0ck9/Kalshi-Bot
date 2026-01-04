# Kalshi Bot v3.0 - Architecture Design Document

## Research Foundation

This architecture is based on PhD-level academic research:

- **Kelly Criterion for Prediction Markets** (arXiv:2412.14144, Dec 2024)
- **Optimal Order Placement** (Cont & Kukanov, arXiv:1210.1625)
- **Price Dynamics in Prediction Markets** (PNAS, Iowa Electronic Markets)
- **Production Arbitrage Implementations** (GitHub: terauss, CarlosIbCu)

---

## Phase 1: Time-Decay Pricing Model

### Mathematical Foundation

Binary options in prediction markets follow **inverse sigmoid decay** near expiry:

```
θ(t) = 1 / (1 + e^(-k(T-t)))

Where:
  t = current time
  T = settlement time
  k = decay rate constant (~0.15 for 7-day inflection)
```

### Files to Create

```
src/models/
├── time-decay.ts          # Core theta calculations
├── limit-order.ts         # Optimal limit price suggestions
├── fill-probability.ts    # Fill probability estimation
└── index.ts               # Module exports
```

### time-decay.ts Interface

```typescript
interface TimeDecayModel {
  daysToExpiry: number;
  theta: number;              // 0-1, decay factor
  thetaPerDay: number;        // Daily decay rate
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedOrderType: 'limit' | 'market';
}

interface ThetaAdjustedEdge {
  rawEdge: number;
  adjustedEdge: number;
  decayApplied: number;
  reasoning: string;
}

// Key functions
function calculateTimeDecay(closeTime: string | Date): TimeDecayModel;
function adjustEdgeForTheta(edge: number, model: TimeDecayModel): ThetaAdjustedEdge;
function getUrgencyLevel(daysToExpiry: number): string;
```

### limit-order.ts Interface

```typescript
interface LimitOrderSuggestion {
  marketOrder: {
    price: number;
    edge: number;
    fillProbability: 1.0;
    reasoning: string;
  };
  limitOrder: {
    price: number;
    edge: number;
    fillProbability: number;
    estimatedFillDays: number;
    reasoning: string;
  };
  ladderOrder?: {
    prices: number[];
    amounts: number[];
    avgEdge: number;
    reasoning: string;
  };
  recommendation: 'market' | 'limit' | 'ladder';
  timeBasedAdjustment: string;
}

// Key functions
function suggestLimitPrice(
  fairValue: number,
  marketPrice: number,
  daysToExpiry: number,
  liquidity: number
): LimitOrderSuggestion;

function estimateFillProbability(
  limitPrice: number,
  currentPrice: number,
  daysToExpiry: number,
  historicalVolatility: number
): number;
```

---

## Phase 2: Premium Discord UI/UX

### Alert Type Hierarchy

```typescript
type AlertType =
  | 'critical'      // >10% edge, <7 days, high confidence
  | 'standard'      // 5-10% edge, standard signals
  | 'opportunity'   // <5% edge but valid
  | 'arbitrage'     // Guaranteed spread profit
  | 'whale_alert'   // Unusual activity detected
  | 'position_update'; // Market moved significantly
```

### Premium Alert Components

```typescript
interface PremiumAlert {
  // Header
  urgency: AlertType;
  edge: number;
  confidence: number;

  // Market Info
  market: {
    title: string;
    expiry: Date;
    daysToExpiry: number;
    thetaRemaining: number;
  };

  // Pricing
  pricing: {
    currentYes: number;
    currentNo: number;
    fairValue: number;
    bidAsk?: { bid: number; ask: number; spread: number };
    liquidity?: number;
    volume24h?: number;
  };

  // Action Recommendations
  actions: {
    marketOrder: OrderSuggestion;
    limitOrder: OrderSuggestion;
    ladderOrder?: LadderSuggestion;
    recommendation: 'market' | 'limit' | 'ladder';
  };

  // Why Section
  reasoning: {
    signals: SignalExplanation[];
    thetaImpact: string;
    riskFactors: string[];
  };

  // Position Sizing
  sizing: {
    kellyFraction: number;
    suggestedAmount: number;
    maxLoss: number;
    bankrollPercent: number;
  };

  // Metadata
  meta: {
    sources: string[];
    updatedAt: Date;
    marketId: string;
  };
}
```

### Files to Create/Modify

```
src/output/
├── premium-discord.ts     # New premium formatting
├── limit-order-display.ts # Limit order UI components
├── liquidity-display.ts   # Orderbook visualization
└── alert-templates.ts     # Reusable templates
```

---

## Phase 3: Polymarket WebSocket

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   WebSocket Manager                      │
├─────────────────────────────────────────────────────────┤
│  ClobMarketClient  │  ClobUserClient  │  RtdsClient     │
│  (orderbook data)  │  (auth trading)  │  (prices/news)  │
├─────────────────────────────────────────────────────────┤
│               Unusual Activity Detector                  │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ Whale Entry │ │ Flash Move   │ │ Spread Collapse │  │
│  │ Detection   │ │ Detection    │ │ Detection       │  │
│  └─────────────┘ └──────────────┘ └─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│              Cross-Platform Arbitrage                    │
│              (Compare to Kalshi in real-time)           │
└─────────────────────────────────────────────────────────┘
```

### Files to Create

```
src/realtime/
├── polymarket-stream.ts   # WebSocket client wrapper
├── unusual-activity.ts    # Anomaly detection
├── velocity-tracker.ts    # Rate-of-change monitoring
├── whale-detector.ts      # Large position detection
└── index.ts
```

### Key Interfaces

```typescript
interface RealtimeConfig {
  markets: string[];           // Token IDs to monitor
  thresholds: {
    flashMovePercent: 0.10;    // 10% move in 5 min
    volumeVelocityMultiple: 3; // 3x normal volume
    spreadCollapsePercent: 0.5;// Spread shrinks 50%
    whalePositionUsd: 10000;   // $10K+ positions
  };
  alertCooldown: 300;          // 5 min between same alerts
}

interface UnusualActivityAlert {
  type: 'whale_entry' | 'flash_move' | 'volume_spike' | 'spread_collapse';
  market: string;
  magnitude: number;
  direction: 'bullish' | 'bearish';
  kalshiOpportunity?: {
    ticker: string;
    priceDiff: number;
    action: string;
  };
  timestamp: Date;
}
```

---

## Phase 4: Free Data Sources

### Integration Priority

| Source | Category | Implementation | Priority |
|--------|----------|----------------|----------|
| 538/RCP | Politics | HTML scraper | P0 |
| Google Trends | All | Official API | P1 |
| NOAA/Weather.gov | Weather | REST API | P1 |
| FRED | Economics | REST API | P1 |
| SEC EDGAR | Company | REST API | P2 |
| Congress.gov | Politics | REST API | P2 |

### Files to Create

```
src/fetchers/
├── polling-aggregator.ts  # 538, RCP, Silver Bulletin
├── google-trends.ts       # Breaking news detection
├── noaa-weather.ts        # Weather forecasts
├── fred-economics.ts      # Economic time series
├── sec-edgar.ts           # Corporate filings
└── congress-tracker.ts    # Legislative tracking
```

---

## Phase 5: Codebase Audit Fixes

### Team Alias Resolution

```typescript
// src/data/teams.ts - Add league-aware disambiguation
function getTeamByAliasWithContext(
  alias: string,
  context: {
    preferredLeague?: string;
    marketTitle?: string;
    category?: string;
  }
): { teamKey: string; league: string } | null;
```

### Sports Combo Fix

```typescript
// src/analysis/cross-platform.ts - Remove aggressive filter
// BEFORE (line ~374):
if (minPrice < 0.03 && maxPrice > 0.20) {
  return false; // Too aggressive!
}

// AFTER:
if (minPrice < 0.03 && maxPrice > 0.20) {
  confidence *= 0.5; // Reduce confidence, don't filter
  reasoning = 'Extreme price divergence - lower confidence';
}
```

---

## Phase 6: Spread Arbitrage Detection

### Detection Algorithm

```typescript
interface SpreadArbitrageOpportunity {
  market: Market;
  yesAsk: number;
  noAsk: number;
  totalCost: number;
  profit: number;
  profitPercent: number;
  feeEstimate: number;
  netProfit: number;
  guaranteed: true;
  action: string;
}

function detectSpreadArbitrage(markets: Market[]): SpreadArbitrageOpportunity[] {
  const opportunities: SpreadArbitrageOpportunity[] = [];

  for (const market of markets) {
    if (!market.outcomes || market.outcomes.length !== 2) continue;

    const yesOutcome = market.outcomes.find(o => o.name === 'Yes');
    const noOutcome = market.outcomes.find(o => o.name === 'No');

    if (!yesOutcome || !noOutcome) continue;

    const yesAsk = yesOutcome.askPrice || yesOutcome.price;
    const noAsk = noOutcome.askPrice || noOutcome.price;
    const totalCost = yesAsk + noAsk;

    // Kalshi fee: ceil(0.07 × contracts × price × (1-price))
    const feeEstimate = Math.ceil(0.07 * 100 * yesAsk * (1 - yesAsk)) / 100;
    const netCost = totalCost + feeEstimate;

    if (netCost < 1.00) {
      opportunities.push({
        market,
        yesAsk,
        noAsk,
        totalCost,
        profit: 1.00 - totalCost,
        profitPercent: (1.00 - totalCost) / totalCost,
        feeEstimate,
        netProfit: 1.00 - netCost,
        guaranteed: true,
        action: `Buy YES @ ${(yesAsk * 100).toFixed(0)}¢ + NO @ ${(noAsk * 100).toFixed(0)}¢`
      });
    }
  }

  return opportunities.sort((a, b) => b.netProfit - a.netProfit);
}
```

---

## Phase 7: Background Daemon Mode

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kalshi-bot',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    cron_restart: '0 6 * * *', // Restart daily at 6am
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }, {
    name: 'kalshi-realtime',
    script: 'dist/realtime/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      REALTIME_MODE: 'true'
    }
  }]
};
```

### Scripts to Add

```json
// package.json
{
  "scripts": {
    "daemon:start": "pm2 start ecosystem.config.js",
    "daemon:stop": "pm2 stop all",
    "daemon:restart": "pm2 restart all",
    "daemon:logs": "pm2 logs",
    "daemon:status": "pm2 status",
    "daemon:monit": "pm2 monit"
  }
}
```

---

## Test Coverage Requirements

### Unit Tests (Required for each phase)

```
tests/
├── unit/
│   ├── models/
│   │   ├── time-decay.test.ts       # Phase 1
│   │   ├── limit-order.test.ts      # Phase 1
│   │   └── fill-probability.test.ts # Phase 1
│   ├── output/
│   │   └── premium-discord.test.ts  # Phase 2
│   ├── realtime/
│   │   ├── unusual-activity.test.ts # Phase 3
│   │   └── whale-detector.test.ts   # Phase 3
│   ├── fetchers/
│   │   ├── polling-aggregator.test.ts # Phase 4
│   │   └── google-trends.test.ts      # Phase 4
│   └── edge/
│       └── spread-arbitrage.test.ts   # Phase 6
└── integration/
    ├── pipeline-v3.test.ts
    └── realtime-alerts.test.ts
```

### Coverage Targets

| Module | Target | Notes |
|--------|--------|-------|
| src/models/* | 90%+ | Critical financial calculations |
| src/output/* | 80%+ | UI formatting |
| src/realtime/* | 85%+ | Real-time critical |
| src/fetchers/* | 75%+ | External API mocking |
| src/edge/* | 85%+ | Edge detection logic |

---

## Implementation Order

1. **Phase 1**: Time-Decay Model (foundation for all pricing)
2. **Phase 2**: Premium Discord UI (user-facing value)
3. **Phase 6**: Spread Arbitrage (quick win, guaranteed profit)
4. **Phase 5**: Codebase Fixes (enables better matching)
5. **Phase 3**: WebSocket (real-time monitoring)
6. **Phase 4**: Data Sources (expanded coverage)
7. **Phase 7**: Daemon Mode (operational stability)

---

*Document Version: 1.0*
*Created: January 2026*
*Based on: PhD-level academic research*
