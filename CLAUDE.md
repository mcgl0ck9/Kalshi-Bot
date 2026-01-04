# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Permissions & Autonomy

**Claude has full permission to execute commands autonomously in this repository.**

### Allowed Without Prompting
- All npm/node commands (install, build, test, run scripts)
- All git operations (add, commit, push, pull, branch, merge)
- File operations (read, write, edit, create, delete)
- Shell commands for development (curl, wget, mkdir, rm, etc.)
- TypeScript compilation and execution
- Running the bot in any mode (scan, bot, daemon)
- Installing dependencies
- Creating new files and directories

### Guidelines
- Proceed with implementation without asking for confirmation
- Make commits frequently with clear messages
- Push changes when logical milestones are reached
- Run tests after significant changes
- Fix errors autonomously when possible

---

# KALSHI EDGE DETECTOR v3.0 - COMPREHENSIVE ROADMAP

## Executive Summary

**Vision**: Build a world-class, PhD-level prediction market edge detection system that treats markets like true options with time decay, provides stunning Stripe/Robinhood-quality Discord alerts, and captures unusual cross-platform activity in real-time.

**Key Upgrades**:
1. Options-like pricing with theta decay as markets approach expiry
2. Real-time WebSocket monitoring for Polymarket unusual activity
3. World-class Discord UI/UX overhaul with liquidity information
4. Twitter/X sentiment integration
5. Background daemon mode for 24/7 operation
6. Unified team alias system (resolved 44 cross-league conflicts)
7. Powell Predictor-style streak amplifiers and recency weighting

---

## Project Overview

Kalshi Edge Detector v3 - A TypeScript system for detecting edges in Kalshi prediction markets using multiple converging signals, PhD-level ML techniques, and options-style probability modeling.

### Core Signals (Validated)
1. **Cross-Platform Price Divergence** - Kalshi vs Polymarket price gaps
2. **Sentiment-Price Divergence** - News sentiment vs market price
3. **Whale Activity** - On-chain Polymarket position analysis
4. **Time-Decay Adjusted Fair Value** - Options theta modeling (NEW)
5. **Streak-Amplified Probabilities** - Powell Predictor methodology (NEW)

### Advanced Signals
6. **Options-Implied Probabilities** - Fed Funds Futures, SPX options, Treasury curve
7. **New Market Scanner** - Early mover advantage on fresh markets
8. **Calibration Tracking** - Historical accuracy and bias adjustment
9. **Twitter/X Sentiment** - Real-time social sentiment (NEW)
10. **Orderbook Imbalance** - Polymarket WebSocket flow analysis (NEW)

### Adversarially Validated Signals (edge/*)
11. **Fed Regime Bias** - FedWatch regime-dependent biases
12. **Injury Overreaction** - Public overreacts to star player injuries
13. **Sports Odds Consensus** - Kalshi vs sportsbook consensus
14. **Weather Overreaction** - Climatological base rates + forecast skill
15. **Recency Bias** - Optimal Bayesian update detection
16. **Whale Performance** - Category-specific whale win rates

---

## V3.0 ROADMAP - IMPLEMENTATION PHASES

### PHASE 1: OPTIONS-LIKE PRICING MODEL (P0 - Critical)

**Goal**: Treat prediction markets like binary options with proper time decay.

**Academic Foundation**:
- Theta decay accelerates near expiry (non-linear, not constant)
- At-the-money options have highest theta (most time value at risk)
- Binary options: fair value = P(event) adjusted for time remaining

**Implementation** (`src/models/time-decay.ts`):

```typescript
interface TimeDecayModel {
  // Powell Predictor style half-life decay
  halfLifeDays: number;           // 270d for prepared remarks, 180d for live Q&A

  // Options-style theta acceleration
  thetaAcceleration: {
    daysToExpiry: number;
    decayMultiplier: number;      // 1.0 at 30d, 1.5 at 7d, 2.5 at 1d
  }[];

  // Streak amplifiers (from Powell Predictor)
  streakAmplifier: {
    alpha: 0.25;                  // Decay rate
    floorMult: 1.0;               // Minimum multiplier
    capMult: 1.6;                 // Maximum multiplier
    probCap: 0.98;                // Prevent overconfidence
  };
}

// Rotten Tomatoes-style expiry adjustment
function adjustForExpiry(baseProb: number, daysToExpiry: number): number {
  // Non-linear decay: faster as expiry approaches
  const decayFactor = Math.pow(0.5, (30 - daysToExpiry) / 30);
  return baseProb * (1 - decayFactor * 0.15); // 15% max adjustment
}
```

**Key Patterns from Powell Predictor**:
- Recency weighting: `weight = 0.5^(age_days / half_life_days)` with 0.05 floor
- Streak multiplier: `FLOOR + (CAP - FLOOR) * (1 - exp(-ALPHA * streak))`
- Soft adjustments for sensitive events: 1.15x for shutdown-related phrases
- Macro regime conditioning: 3-quantile bins for CPI, EFFR, yield curve

**Files to Create**:
- `src/models/time-decay.ts` - Core theta decay calculations
- `src/models/streak-amplifier.ts` - Powell-style streak boosts
- `src/models/regime-conditioning.ts` - Macro bin filtering

---

### PHASE 2: WORLD-CLASS DISCORD UI/UX (P0 - Critical)

**Goal**: Stripe/Robinhood-quality alerts that make users gasp.

**Design Principles** (from research):
1. **Color as Communication** - Green = profitable, Red = risky (Robinhood)
2. **Card-Based Modularity** - Each signal is a self-contained card
3. **Clear Hierarchy** - Most important info first (price, action, edge)
4. **Functional Animation** - Status emojis guide attention flow
5. **Trust Through Clarity** - Show confidence calculations, not just scores

**New Alert Format** (`output/premium-discord.ts`):

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔴 CRITICAL EDGE • 12.5% • HIGH CONVICTION   ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📈 **Chiefs to win Super Bowl**

┌─────────────────────────────────────────────┐
│  🟢 BUY YES @ 42¢  →  Win 58¢ per contract  │
└─────────────────────────────────────────────┘

**Market Data**
```
Price:      42¢ YES / 58¢ NO
Fair Value: 54¢ (theta-adjusted)
Edge:       +12.5%
Expires:    Feb 9, 2026 (36 days)
```

**Liquidity Profile**
```
Bid/Ask:    41¢ / 43¢ (2¢ spread)
Depth:      $12,400 within 3¢
24h Volume: $89,000
Slippage:   ~0.5% for $500 order
```

**Why This Edge Exists**
• 🐋 Whale conviction: 8 traders @ 68% YES (vs 42% market)
• 📊 Sportsbook consensus: 58% implied (vs 42% market)
• 📰 Sentiment: +0.12 bullish (injury reports favor KC)
• ⏱️ Time decay: 2.1% theta remaining

**Position Sizing**
```
Kelly:      8.2% of bankroll
Suggested:  $500 (fractional Kelly 25%)
Max Loss:   $500
```

[>>> TRADE ON KALSHI <<<](https://kalshi.com/markets/...)

_Confidence: 78% • Sources: Polymarket, ESPN, RSS • Updated: 2m ago_
```

**Missing Information to Add**:
- ✅ Liquidity (bid/ask spread, depth, slippage estimate)
- ✅ Time to expiry with theta decay impact
- ✅ Data freshness timestamp
- ✅ Clear max loss display
- ✅ Confidence calculation breakdown

**Files to Create/Modify**:
- `src/output/premium-discord.ts` - New premium formatting
- `src/output/liquidity-display.ts` - Liquidity profile generation
- `src/types/premium-alert.ts` - Enhanced alert types

---

### PHASE 3: REAL-TIME POLYMARKET WEBSOCKET (P1 - High Priority)

**Goal**: Catch unusual activity like the Maduro Venezuela spike in real-time.

**Research Sources**:
- [polymarket-websocket-client](https://github.com/discountry/polymarket-websocket-client)
- [polymarket-orderbook-watcher](https://github.com/discountry/polymarket-orderbook-watcher)

**Architecture**:

```typescript
// src/realtime/polymarket-stream.ts
import { ClobMarketClient } from './polymarket-websocket';

interface UnusualActivityAlert {
  market: string;
  type: 'whale_entry' | 'flash_move' | 'volume_spike' | 'spread_collapse';
  magnitude: number;        // How unusual (stddev from baseline)
  priceMove: number;        // Price change in last N minutes
  volumeVelocity: number;   // Volume per minute vs average
  timestamp: Date;
}

const client = new ClobMarketClient({
  autoReconnect: true,
  heartbeatInterval: 30000,
});

// Subscribe to high-value markets
client.onBook(event => detectOrderbookImbalance(event));
client.onPriceChange(event => detectFlashMove(event));
client.onLastTradePrice(event => detectWhaleEntry(event));
```

**Unusual Activity Detection**:

1. **Whale Entry Detection**:
   - Track position size changes > $10,000 in 5 minutes
   - Alert when normally quiet whale suddenly active
   - Cross-reference with Kalshi price for arbitrage

2. **Flash Move Detection**:
   - Price moves > 10% in < 5 minutes
   - Volume velocity > 3x normal
   - Immediately check Kalshi for mispricing

3. **Orderbook Imbalance**:
   - Bid depth vs ask depth ratio > 3:1
   - Iceberg order detection (unusual wick-to-body ratios)
   - Spread collapse = incoming whale

**Files to Create**:
- `src/realtime/polymarket-stream.ts` - WebSocket client
- `src/realtime/unusual-activity.ts` - Anomaly detection
- `src/realtime/velocity-tracker.ts` - Rate-of-change monitoring

---

### PHASE 4: TWITTER/X SENTIMENT INTEGRATION (P1 - High Priority)

**Goal**: Real-time social sentiment as leading indicator.

**Research Foundation**:
- FinBERT/RoBERTa for financial text understanding
- Compound sentiment score thresholds: buy > 0.05, sell < -0.05
- Social media sentiment is noisy but valuable signal

**Implementation** (`src/fetchers/twitter-sentiment.ts`):

```typescript
interface TwitterSentimentConfig {
  // API Access (required)
  apiKey: string;
  apiSecret: string;
  bearerToken: string;

  // Sentiment thresholds
  bullishThreshold: 0.05;
  bearishThreshold: -0.05;

  // Tracked accounts (crypto twitter, finance influencers)
  trackedAccounts: string[];

  // Keywords by category
  keywords: {
    crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto'];
    politics: ['trump', 'biden', 'election', 'congress'];
    sports: ['nfl', 'nba', 'super bowl', 'playoffs'];
  };
}

// VADER sentiment with financial lexicon
function analyzeTweet(text: string): {
  compound: number;
  bullish: boolean;
  bearish: boolean;
  entities: string[];
}
```

**Data Sources**:
- Twitter/X API (Basic plan required)
- Crypto Twitter monitoring
- News account tracking (breaking news advantage)

**Files to Create**:
- `src/fetchers/twitter-sentiment.ts` - Twitter API integration
- `src/analysis/social-sentiment.ts` - Sentiment aggregation
- `src/edge/twitter-divergence.ts` - Sentiment vs price edge

---

### PHASE 5: CODEBASE AUDIT & DATA CONSISTENCY (P1)

**Findings from Audit**:

#### Team Aliases - 44 Cross-League Conflicts Identified

**Problem**: Abbreviations like PHI, DET, MIN appear in 4 leagues each.

**Current State** (`src/data/teams.ts` - 1,921 lines):
- 213 teams across 6 leagues (NFL, NBA, MLB, NHL, NCAAF, NCAAB)
- Well-centralized in single file ✅
- But `buildAllAliasMap()` uses "first league wins" strategy ⚠️

**Fix** (`src/data/teams.ts`):

```typescript
// Add league context to disambiguation
export function getTeamByAliasWithLeague(
  alias: string,
  preferredLeague?: string
): { teamKey: string; league: string } | null {
  const matches = getAllTeamsByAlias(alias);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Prefer specified league if available
  if (preferredLeague) {
    const preferred = matches.find(m => m.league === preferredLeague);
    if (preferred) return preferred;
  }

  // Fall back to sport context from market title
  return matches[0];
}
```

**NCAAF Abbreviation Conflicts to Fix**:
- Utah Utes: Change 'UT' → 'UTAH' (conflicts with Texas)
- Maryland: Prefer 'UMD' over 'UM' (conflicts with Michigan)
- Michigan: Prefer 'MICH' over 'UM'

#### Discord Deep Linking - Currently Basic

**Current**: `[Trade on Kalshi](url)` with no parameters

**Enhancement**:
```typescript
// Add quick-action parameters
const tradeUrl = `${market.url}?action=buy&side=yes&amount=${suggestedSize}`;
```

#### Sports Combos - Currently Hidden

**Problem**: Parlay markets filtered out as "false positives"

```typescript
// REMOVE this aggressive filter in cross-platform.ts:374
if (minPrice < 0.03 && maxPrice > 0.20) {
  return false; // This removes legitimate extreme edges!
}

// REPLACE with confidence-weighted approach
if (minPrice < 0.03 && maxPrice > 0.20) {
  confidence *= 0.5; // Reduce confidence, don't filter
}
```

---

### PHASE 6: BACKGROUND DAEMON MODE (P2)

**Goal**: Run bot 24/7 even when terminal is closed.

**Implementation Options**:

1. **PM2 Process Manager** (Recommended):
```bash
# Install
npm install -g pm2

# Start daemon
pm2 start dist/index.js --name kalshi-bot

# Auto-restart on crash
pm2 startup
pm2 save
```

2. **systemd Service** (Linux):
```ini
# /etc/systemd/system/kalshi-bot.service
[Unit]
Description=Kalshi Edge Detector Bot
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/kalshi-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. **Docker Container**:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

**Files to Create**:
- `ecosystem.config.js` - PM2 configuration
- `Dockerfile` - Container definition
- `scripts/start-daemon.sh` - Startup script

---

### PHASE 7: ENHANCED SLASH COMMANDS (P2)

**Goal**: Make bot accessible to anyone, not just developers.

**New Commands**:

```typescript
// /scan - Already exists, enhance with filters
/scan [category] [--urgency critical|standard|all]

// /portfolio - Track positions
/portfolio show
/portfolio add <market> <side> <amount>
/portfolio pnl

// /alerts - Manage notifications
/alerts subscribe <channel>
/alerts mute <category> <duration>
/alerts threshold <edge_percent>

// /research - Deep dive on market
/research <market_ticker>
// Returns: full analysis with all signals, historical accuracy, whale positions

// /backtest - Historical validation
/backtest <strategy> <start_date> <end_date>

// /whale - Whale activity
/whale leaderboard [category]
/whale track <wallet>
/whale positions <market>
```

---

## COMMANDS

```bash
# Development
npm run dev          # Watch mode for development
npm run build        # Compile TypeScript
npm run test         # Run test suite

# Execution
npm run scan         # Run scan immediately (--test for webhook test)
npm run bot          # Start Discord bot with slash commands
npm start            # Run in scheduled mode (6:30am, 12pm, 5pm ET)

# Daemon (NEW)
npm run daemon:start # Start with PM2
npm run daemon:stop  # Stop daemon
npm run daemon:logs  # View logs
npm run daemon:status # Check status

# Backtesting (NEW)
npm run backtest     # Run backtesting framework
npm run backtest:report # Generate performance report
```

---

## ARCHITECTURE

```
src/
├── index.ts                    # CLI entry point
├── pipeline.ts                 # Main edge detection pipeline
├── config.ts                   # Environment config
│
├── models/                     # NEW: Pricing models
│   ├── time-decay.ts          # Options-style theta decay
│   ├── streak-amplifier.ts    # Powell Predictor methodology
│   └── regime-conditioning.ts # Macro bin filtering
│
├── realtime/                   # NEW: Real-time monitoring
│   ├── polymarket-stream.ts   # WebSocket client
│   ├── unusual-activity.ts    # Anomaly detection
│   └── velocity-tracker.ts    # Rate-of-change monitoring
│
├── types/
│   ├── index.ts               # Core types
│   ├── premium-alert.ts       # NEW: Enhanced alert types
│   └── ...
│
├── exchanges/                  # dr-manhattan wrapper
│
├── fetchers/
│   ├── news.ts                # RSS aggregation
│   ├── twitter-sentiment.ts   # NEW: Twitter/X integration
│   ├── polymarket-onchain.ts  # On-chain whale analysis
│   ├── espn-odds.ts           # ESPN public API
│   ├── cdc-surveillance.ts    # CDC health data
│   ├── crypto-funding.ts      # Hyperliquid funding
│   └── fed-nowcasts.ts        # GDPNow, inflation
│
├── edge/
│   ├── time-decay-edge.ts     # NEW: Theta-adjusted edges
│   ├── twitter-divergence.ts  # NEW: Social sentiment edge
│   ├── cross-platform-conviction.ts
│   └── ...
│
├── analysis/
│   ├── cross-platform.ts      # Market matching
│   ├── sentiment.ts           # News sentiment
│   └── position-sizing.ts     # Kelly criterion
│
├── data/
│   └── teams.ts               # Unified team database (213 teams)
│
└── output/
    ├── premium-discord.ts     # NEW: World-class formatting
    ├── liquidity-display.ts   # NEW: Liquidity profiles
    ├── discord.ts             # Webhooks + bot
    └── channels.ts            # Multi-channel routing
```

---

## KEY DEPENDENCIES

**Core**:
- `@alango/dr-manhattan` - Unified prediction market API
- `discord.js` - Bot + slash commands
- `sentiment` - Text sentiment analysis
- `rss-parser` - News aggregation

**New for v3.0**:
- `ws` - WebSocket client for Polymarket
- `twitter-api-v2` - Twitter/X API
- `pm2` - Process management
- `@tensorflow/tfjs-node` - ML edge prediction (optional)

---

## ENVIRONMENT CONFIG (.env)

```bash
# Required
DISCORD_WEBHOOK_URL=
DISCORD_BOT_TOKEN=

# Kalshi (for authenticated features)
KALSHI_API_KEY_ID=
KALSHI_API_PRIVATE_KEY=

# Twitter/X (NEW - for sentiment)
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_BEARER_TOKEN=

# Optional API Keys
NEWS_API_KEY=
ODDS_API_KEY=
TMDB_API_KEY=

# Position Sizing
BANKROLL=10000
MIN_EDGE_THRESHOLD=0.02

# Discord Channels (category-specific)
DISCORD_WEBHOOK_SPORTS=
DISCORD_WEBHOOK_CRYPTO=
DISCORD_WEBHOOK_ECONOMICS=
DISCORD_WEBHOOK_POLITICS=
DISCORD_WEBHOOK_ENTERTAINMENT=
DISCORD_WEBHOOK_HEALTH=
DISCORD_WEBHOOK_WHALE=
DISCORD_WEBHOOK_URGENT=      # NEW: Critical alerts only
```

---

## ACADEMIC RESEARCH INTEGRATION

### Machine Learning Edge Detection

**Sources**:
- [MDPI 2024](https://www.mdpi.com/2673-9909/5/3/76): LSTM, TCN, N-BEATS for market prediction
- [arXiv 2408.12408](https://arxiv.org/html/2408.12408v1): Deep learning trend prediction evaluation
- [ScienceDirect 2025](https://www.sciencedirect.com/science/article/pii/S2590005625000177): Algorithmic trading optimization

**Techniques to Implement**:
- Temporal Fusion Transformers (TFT) for multi-horizon prediction
- N-BEATS for interpretable forecasting
- LSTM with attention for sequence modeling

### Prediction Market Arbitrage

**Sources**:
- [GitHub: Polymarket-Kalshi-Arbitrage-bot](https://github.com/terauss/Polymarket-Kalshi-Arbitrage-bot)
- [Substack: Building a Prediction Market Arbitrage Bot](https://navnoorbawa.substack.com/p/building-a-prediction-market-arbitrage)

**Key Insight**: $40 million extracted via arbitrage April 2024 - April 2025

### Market Microstructure

**Sources**:
- [arXiv 2004.08290](https://arxiv.org/pdf/2004.08290): Order flow imbalance impact
- [Cornell](https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf): Crypto market microstructure

**Techniques**:
- Order Book Imbalance (OBI) for short-term prediction
- VPIN (Volume-synchronized PIN) for toxicity
- Micro-price estimation for fair value

### UI/UX Design

**Sources**:
- [Robinhood Design](https://design.google/library/robinhood-investing-material): Material Design principles
- [Stripe Dashboard](https://www.phoenixstrategy.group/blog/how-to-design-real-time-financial-dashboards): Real-time financial dashboards

**Principles**:
- Clarity, Trust, Speed, Adaptability
- Color as communication (green/red for profit/loss)
- Card-based modular layout
- Data visualization over raw numbers

---

## IMPLEMENTATION PRIORITY

| Phase | Feature | Priority | Complexity | Impact |
|-------|---------|----------|------------|--------|
| 1 | Time-decay pricing model | P0 | Medium | High |
| 2 | Premium Discord UI/UX | P0 | Medium | Very High |
| 3 | Polymarket WebSocket | P1 | High | Very High |
| 4 | Twitter sentiment | P1 | Medium | High |
| 5 | Codebase audit fixes | P1 | Low | Medium |
| 6 | Daemon mode | P2 | Low | Medium |
| 7 | Enhanced slash commands | P2 | Medium | Medium |

---

## SUCCESS METRICS

**Edge Detection**:
- Capture 90%+ of >5% cross-platform divergences
- Detect unusual Polymarket activity within 60 seconds
- Maintain 65%+ win rate on critical alerts

**User Experience**:
- Alert clarity score: 9/10 (user survey)
- Time to decision: <30 seconds per alert
- Deep link click-through rate: >40%

**Operations**:
- 99.9% uptime with daemon mode
- <5 minute latency for Twitter sentiment
- Process 1000+ markets per scan cycle

---

## DATA STORAGE

```
data/
├── predictions.json          # All prediction records
├── calibration.json          # Calibration report
├── whale_predictions.json    # Whale history
├── whale_performance.json    # Win rates by category
├── discovered-whales.json    # Auto-discovered wallets
├── streak-history.json       # NEW: Streak tracking
├── twitter-sentiment.json    # NEW: Social sentiment cache
└── backtest-results/         # NEW: Historical validation
    ├── strategy-a.json
    └── strategy-b.json
```

---

## CURRENT CHANNEL STATUS (Jan 2026)

| Channel | Status | Priority Fixes |
|---------|--------|----------------|
| Sports | ✅ Working | Add liquidity display, fix combo clarity |
| Crypto | ✅ Working | Add WebSocket real-time monitoring |
| Economics | ✅ Working | Integrate Powell Predictor model |
| Politics | ⚠️ Limited | Add 538/RCP polling, Twitter sentiment |
| Entertainment | ⚠️ Limited | Add time-decay for RT score markets |
| Health | ✅ Working | Add CDC wastewater alerts |
| Whale | ✅ Strong | Add velocity detection, unusual activity |
| Weather | ❌ Inactive | Kalshi series inactive |

---

## NEXT STEPS

1. **Immediate** (This Week):
   - [ ] Create `src/models/time-decay.ts` with Powell Predictor patterns
   - [ ] Create `src/output/premium-discord.ts` with new alert format
   - [ ] Fix team alias conflicts in `src/data/teams.ts`

2. **Short-term** (2 Weeks):
   - [ ] Implement Polymarket WebSocket client
   - [ ] Add liquidity display to all alerts
   - [ ] Set up PM2 daemon mode

3. **Medium-term** (1 Month):
   - [ ] Twitter sentiment integration
   - [ ] Enhanced slash commands
   - [ ] Backtesting framework

---

*Last Updated: January 2026*
*Version: 3.0.0-roadmap*
