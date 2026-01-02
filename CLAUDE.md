# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kalshi Edge Detector v2 - A TypeScript system for detecting edges in Kalshi prediction markets using multiple converging signals.

### Core Signals
1. **Cross-Platform Price Divergence** - Kalshi vs Polymarket price gaps
2. **Sentiment-Price Divergence** - News sentiment vs market price
3. **Whale Activity** - Signals from top Polymarket traders
4. **Polymarket Whale Conviction** - On-chain position analysis from top traders

### Meta Edge Signals (Advanced)
5. **Options-Implied Probabilities** - Fed Funds Futures, SPX options, Treasury curve
6. **New Market Scanner** - Early mover advantage on fresh markets
7. **Calibration Tracking** - Historical accuracy and bias adjustment

### Adversarially Validated Signals (edge/*)
Signals that pass the "who's on the other side?" test:

8. **Fed Regime Bias** (`fed-regime-bias.ts`) - Cleveland Fed research shows FedWatch has regime-dependent biases
9. **Injury Overreaction** (`injury-overreaction.ts`) - Public overreacts to star player injuries
10. **Sports Odds Consensus** (`sports-odds.ts`) - Compare Kalshi sports markets to sportsbook consensus
11. **Weather Overreaction** (`weather-overreaction.ts`) - Apply climatological base rates + forecast skill limits
12. **Recency Bias** (`recency-bias.ts`) - Detect markets that moved more than optimal Bayesian update
13. **Whale Performance** (`whale-performance.ts`) - Track whale win rates by category for confidence weighting

### P0 Data Sources (No API Keys Required)
Sustainable data feeds that work without manual key renewal:

14. **ESPN Sports Odds** (`espn-odds.ts`) - NFL/NBA/NHL/MLB/NCAAF/NCAAB odds from ESPN public API
15. **CDC Health Surveillance** (`cdc-surveillance.ts`) - Wastewater + flu data (leads cases by 7-14 days)
16. **Crypto Funding Rates** (`crypto-funding.ts`) - Hyperliquid DeFi perps funding + open interest
17. **Fed Nowcasts** (`fed-nowcasts.ts`) - Atlanta Fed GDPNow + Cleveland Fed inflation estimates

## Commands

```bash
npm run dev          # Watch mode for development
npm run scan         # Run scan immediately (--test for webhook test)
npm run bot          # Start Discord bot with slash commands
npm run build        # Compile TypeScript
npm start            # Run in scheduled mode (6:30am, 12pm, 5pm ET)
```

## Architecture

```
src/
├── index.ts           # CLI entry point, parses args and runs modes
├── pipeline.ts        # Main 8-step edge detection pipeline
├── config.ts          # Environment config + tracked topics/whales
├── types/             # TypeScript interfaces
│   ├── index.ts       # Core types (Market, Edge, etc.)
│   ├── economic.ts    # Economic indicator types
│   ├── edge.ts        # Signal aggregation types
│   └── meta-edge.ts   # Meta edge types (channels, calibration, etc.)
├── exchanges/         # dr-manhattan wrapper for Kalshi + Polymarket
├── fetchers/          # Data fetchers
│   ├── news.ts        # RSS feed aggregation (100+ sources)
│   ├── whales.ts      # Whale activity tracking
│   ├── entertainment.ts # Box office, Rotten Tomatoes
│   ├── options-implied.ts # Fed Funds, SPX, Treasury yields
│   ├── sports-odds.ts # The Odds API integration
│   ├── espn-odds.ts   # ESPN public API (no key required)
│   ├── polymarket-onchain.ts # On-chain whale conviction analysis
│   ├── cdc-surveillance.ts # CDC wastewater + flu surveillance
│   ├── crypto-funding.ts # Hyperliquid funding rates + Fear/Greed
│   ├── fed-nowcasts.ts # GDPNow + inflation nowcasts
│   └── economic/      # Fed, CPI, Jobs, GDP nowcasts
├── edge/              # Edge detection modules
│   ├── macro-edge.ts  # Economic indicator edges
│   ├── new-market-scanner.ts # Fresh market detection
│   ├── calibration-tracker.ts # Prediction tracking
│   ├── fed-regime-bias.ts # FedWatch regime adjustment
│   ├── injury-overreaction.ts # Sports injury overreaction
│   ├── weather-overreaction.ts # Weather forecast bias
│   ├── recency-bias.ts # Base rate neglect detection
│   ├── cross-platform-conviction.ts # Whale conviction edges
│   └── whale-performance.ts # Whale historical win rate tracking
├── analysis/          # Sentiment, cross-platform matching, Kelly sizing
│   ├── cross-platform.ts # Market matching with entity extraction
│   ├── sentiment.ts   # News sentiment with sports lexicon
│   └── position-sizing.ts # Kelly criterion sizing
└── output/            # Discord output
    ├── discord.ts     # Webhooks + bot with enhanced formatting
    └── channels.ts    # Multi-channel routing
```

## Key Dependencies

- **@alango/dr-manhattan** - Unified API for prediction market exchanges (Kalshi REST + RSA auth, Polymarket REST + WebSocket)
- **sentiment** - Text sentiment analysis with custom market lexicon
- **rss-parser** - Fetches 100+ news RSS feeds
- **discord.js** - Discord bot + slash commands

## Pipeline Flow (pipeline.ts)

1. Fetch markets from Kalshi + Polymarket via dr-manhattan
2. Fetch news from RSS feeds (100+ sources)
3. Check whale activity
4. Match markets cross-platform using title similarity + entity extraction
5. Analyze sentiment by topic (39 tracked topics)
6. Find sentiment-based edges
6.5. **Validated macro signals**:
   - Fed Regime Bias adjustment
   - Injury overreaction detection
   - Sports odds vs Kalshi comparison (if ODDS_API_KEY set)
   - Weather forecast overreaction
   - Recency bias / base rate neglect
   - Polymarket whale conviction analysis
7. Combine signals into opportunities with Kelly sizing
8. Send alerts to Discord with enhanced formatting

---

## Cross-Platform Matching System

### Entity Aliases (`analysis/cross-platform.ts`)

The matching system uses comprehensive entity aliases for accurate market comparison:

#### Sports Teams (200+ teams)
- **NFL**: All 32 teams with full names, cities, and nicknames
- **NBA**: All 30 teams with abbreviations and aliases
- **MLB**: All 30 teams with city and nickname variations
- **NHL**: All 32 teams (Bruins, Sabres, Red Wings, Panthers, Canadiens, etc.)
- **NCAAF**: ~70 major programs (SEC, Big Ten, ACC, Big 12, notable independents)
- **NCAAB**: ~50 basketball powerhouses (Duke, Kentucky, Kansas, Gonzaga, etc.)

#### Politicians & Government
- Trump, Biden, Harris, Pence, DeSantis, Newsom, Obama, etc.
- Party aliases (GOP, Democrats, Republicans)

#### Business Leaders
- Elon Musk, Jeff Bezos, Tim Cook, Satya Nadella, Mark Zuckerberg, etc.

#### World Leaders
- Putin, Xi Jinping, Zelensky, Netanyahu, Macron, Modi, etc.

#### Organizations & Companies
- Federal Reserve, SEC, DOJ, NATO, UN, WHO
- OpenAI, Anthropic, Google, Microsoft, Apple, Meta, Tesla, etc.

#### Entertainment
- Taylor Swift, Beyonce, Drake, Travis Kelce, major franchises

### Matching Algorithm

1. **Entity Extraction**: Find common entities between titles using substring matching
2. **Sports Matchup Detection**: 2+ teams from same league = 85% confidence boost
3. **Multi-Entity Boost**: 3+ common entities = 70%+ confidence
4. **Jaccard Similarity**: Word overlap with caps to prevent false positives
5. **Year/Number Matching**: Boost when specific dates/numbers align

### False Positive Prevention
- Removed problematic 2-letter aliases (ne, no, tb)
- Removed 3-letter city codes that match common words
- Capped Jaccard-only matches at 30%

---

## Sentiment Analysis System

### Custom Lexicon (`analysis/sentiment.ts`)

#### Market Terms
- **Bullish**: surges, soars, rallies, breakout, moon, skyrockets, victory
- **Bearish**: crashes, plunges, tanks, dumps, selloff, rekt, collapses

#### Sports-Specific (60+ words)
- **Positive**: dominant, clinch, sweep, undefeated, unstoppable, comeback, clutch, heroic
- **Negative**: upset, stunned, collapse, choke, eliminated, demolished, slump, struggling

#### Injury Detection
- injured, sidelined, questionable, doubtful, ruled_out, torn, concussion, surgery
- Phrase replacements: "ruled out" → devastating, "torn acl" → season-ending

#### Sports Phrases (25+)
- "winning streak" → dominant winning unstoppable
- "losing streak" → struggling slumping defeated
- "blown lead" → collapse choke devastating
- "upset loss" → upset stunned defeated

### Sentiment Thresholds
- Bullish: comparative >= 0.05
- Bearish: comparative <= -0.05
- Neutral: -0.05 < comparative < 0.05

---

## Discord Alert Formatting

### Edge Alert Format (`output/discord.ts`)

```
🔴 **CRITICAL EDGE DETECTED**

**Market Title Here**

```
🟢 ACTION: BUY YES @ 65¢
```

📍 **Current Price:** 65¢
📊 **Fair Value:** 75¢
📈 **Edge:** +10.0%
🎯 **Confidence:** 75%

**Why this edge exists:**
• Cross-platform divergence: Kalshi 65¢ vs Poly 75¢ (Kalshi is cheaper)
• Sportsbook consensus: 74% (sharper money says this is mispriced)
• Game: Chiefs @ Eagles

**Position Sizing:**
• Suggested size: **$500**
• Kelly fraction: 8.5%

Platform: **KALSHI**
[>>> TRADE NOW <<<](url)
```

### Summary Report Format

- Timestamp with ET timezone
- Scan summary (markets, articles, edges found)
- Actionable opportunities with 🟢/🔴 indicators
- Cross-platform divergences showing which platform to buy
- Whale activity with sentiment indicators

---

## Polymarket Whale Conviction

### On-Chain Analysis (`fetchers/polymarket-onchain.ts`)

Tracks top Polymarket traders' positions via Goldsky subgraphs:
- Fetches liquid markets from Gamma API
- Queries position data for known whale wallets
- Calculates conviction strength based on position concentration
- Finds cross-platform edges where whale conviction differs from Kalshi price

### Edge Detection (`edge/cross-platform-conviction.ts`)

When whale implied price diverges from Kalshi by >5%:
- Creates edge opportunity with direction guidance
- Includes conviction strength and whale count
- Routes to whale conviction Discord channel

---

## Config (.env)

Required: `DISCORD_WEBHOOK_URL` or `DISCORD_BOT_TOKEN`
Optional: `KALSHI_API_KEY_ID`, `NEWS_API_KEY`, `ODDS_API_KEY`, `BANKROLL`, `MIN_EDGE_THRESHOLD`

### Discord Channels (Optional)

For segmented alerts aligned with Kalshi categories:
- `DISCORD_WEBHOOK_SPORTS` - NFL, NBA, MLB, NHL, NCAAF, NCAAB
- `DISCORD_WEBHOOK_WEATHER` - Temperature, precipitation, climate
- `DISCORD_WEBHOOK_ECONOMICS` - Fed rates, CPI, Jobs, GDP
- `DISCORD_WEBHOOK_MENTIONS` - Fed speech keywords, earnings mentions
- `DISCORD_WEBHOOK_ENTERTAINMENT` - Movies, RT scores, box office, awards
- `DISCORD_WEBHOOK_HEALTH` - Measles, disease tracking
- `DISCORD_WEBHOOK_POLITICS` - Elections, government, policy
- `DISCORD_WEBHOOK_CRYPTO` - Bitcoin, Ethereum, crypto markets
- `DISCORD_WEBHOOK_DIGEST` - Daily summary
- `DISCORD_WEBHOOK_STATUS` - System health

---

## Tracked Topics (config.ts)

39 topics across categories:

### Politics
- trump, biden, election, impeachment

### Crypto
- bitcoin, ethereum, crypto_regulation

### Entertainment
- oscars, grammys, emmys, golden_globes, box_office, rotten_tomatoes, streaming, billboard, tv_ratings

### Sports (Comprehensive)
- **nfl**: All 32 teams + general keywords
- **nba**: All 30 teams + general keywords
- **mlb**: All 30 teams + general keywords
- **nhl**: All 32 teams + general keywords
- **college_football**: ~80 keywords (major programs + mascots)
- **college_basketball**: ~50 keywords (powerhouses)
- **soccer, golf, tennis, mma**
- **sports_injury**: Injury-related keywords for overreaction detection

### Geopolitics
- ukraine, israel, china, tariffs

### Macro
- fed_rate, fed_speech, fomc_minutes, inflation, recession, jobs, gdp

### Other
- ai, hurricane

---

## Extending

- Add new RSS feeds in `config.ts` → `RSS_FEEDS`
- Add tracked topics in `config.ts` → `TRACKED_TOPICS`
- Add whale accounts in `config.ts` → `KNOWN_WHALES`
- Add entity aliases in `analysis/cross-platform.ts` → `ENTITY_ALIASES`
- Add sentiment words in `analysis/sentiment.ts` → `CUSTOM_LEXICON`
- Adjust position sizing in `analysis/position-sizing.ts`

---

## P0 Data Sources (Sustainable, No API Keys)

### ESPN Sports Odds (`fetchers/espn-odds.ts`)

Public ESPN API for real-time sports odds without API key requirements:

```typescript
// Supported sports
const ESPN_SPORTS = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab'];

// Fetches moneylines, spreads, and over/unders
const odds = await fetchSportsOddsESPN('nfl');
// Returns: { homeTeam, awayTeam, spread, homeML, awayML, overUnder, ... }
```

**Edge Detection:**
- Sharp vs Square money detection (line movement analysis)
- Consensus comparison with Kalshi prices
- Injury news correlation with line moves

### CDC Health Surveillance (`fetchers/cdc-surveillance.ts`)

CDC NWSS (National Wastewater Surveillance System) data:

```typescript
// Wastewater leads reported cases by 7-14 days
const wastewater = await fetchWastewaterData();
// Returns: { region, pathogen, level, percentChange, trend }

// FluView weekly surveillance
const flu = await fetchFluData();
// Returns: { region, week, iliRate, positivityRate, activityLevel }
```

**Edge Detection:**
- Wastewater trend → case count prediction
- Compare CDC projections vs market expectations
- Historical pattern matching for seasonal diseases

### Crypto Funding Rates (`fetchers/crypto-funding.ts`)

Hyperliquid DeFi perpetuals (no geo-blocking, works in US):

```typescript
// Funding rates + open interest
const funding = await fetchFundingRates();
// Returns: { symbol, weightedFundingRate, totalOpenInterest, extremeLevel, contrarian }

// Fear & Greed Index (contrarian indicator)
const fg = await fetchFearGreedIndex();
// Returns: { value, classification, previousValue }
```

**Edge Detection:**
- Extreme funding (>0.1% or <-0.1%) = contrarian signal
- Fear & Greed extremes (<20 or >80) = reversal likelihood
- Open interest divergence from price

### Fed Nowcasts (`fetchers/fed-nowcasts.ts`)

Real-time economic projections from Federal Reserve banks:

```typescript
// Atlanta Fed GDPNow
const gdp = await fetchGDPNow();
// Returns: { estimate, quarter, year, previousEstimate, change }

// Cleveland Fed Inflation Nowcast
const inflation = await fetchInflationNowcast();
// Returns: { estimate, previousEstimate, trend }
```

**Edge Detection:**
- GDPNow vs market GDP expectations
- Inflation nowcast vs Fed target/market pricing
- Revision direction momentum

### Whale Performance Tracking (`edge/whale-performance.ts`)

Historical win rate tracking for Polymarket whales by category:

```typescript
// Record whale predictions
recordWhalePrediction(wallet, market, category, side, entryPrice);

// Get category-specific confidence boost
const boost = getWhaleEdgeBoost(wallet, 'crypto');
// Returns: { boost: 1.2, reasoning: "70% win rate in crypto (15 predictions)" }

// Leaderboard by category
const leaders = getWhaleLeaderboard('politics', minPredictions=5);
```

**Edge Detection:**
- Weight whale signals by their domain expertise
- Fade whales with poor category-specific records
- Identify specialists (e.g., politics-only traders)

---

## Current Channel Audit (Jan 2026)

| Channel | Status | Signals | Notes |
|---------|--------|---------|-------|
| Sports | ✅ Working | ESPN odds (64 games), injury signals | No longer needs ODDS_API_KEY |
| Weather | ⚠️ Limited | 0 open markets | Kalshi weather series appear inactive |
| Economics | ✅ Working | GDPNow, inflation nowcasts | KXGDP/KXCPI series may be seasonal |
| Mentions | ✅ Strong | Fed + earnings keywords | 95% edge on some earnings mentions |
| Entertainment | ⚠️ Limited | RT movies unreleased | Need box office prediction data |
| Health | ✅ Working | CDC wastewater, measles edges | Wastewater leads cases 7-14 days |
| Politics | ⚠️ Limited | Polling data sparse | Need 538/RCP integration |
| Crypto | ✅ Working | Funding rates, Fear/Greed, cross-platform | Hyperliquid + divergence detection |
| Whale Conviction | ✅ Strong | 47+ signals per scan | Now with performance tracking |
| New Markets | ✅ Working | 400+ new markets detected | Early mover edge calculation |

---

## Roadmap

### Completed
- [x] ESPN sports odds (replaces The Odds API)
- [x] CDC wastewater surveillance
- [x] Crypto funding rates via Hyperliquid
- [x] Fed nowcasts (GDPNow, inflation)
- [x] Whale historical performance tracking
- [x] Cross-platform matching improvements
- [x] Multi-channel Discord routing

### Current Sprint (P1)
- [ ] Integrate ESPN odds into sports edge pipeline
- [ ] Add CDC wastewater to health channel alerts
- [ ] Implement funding rate contrarian signals
- [ ] Wire up whale performance boosts to conviction scoring
- [ ] Add Fed transcript historical baselines

### Near-term (P2)
- [ ] 538/RCP polling aggregation for politics
- [ ] Box office prediction models for entertainment
- [ ] NWS forecast comparison for weather
- [ ] Sharp money steam move detection

### Medium-term
- [ ] Machine learning model for edge prediction
- [ ] Automated trade execution via Kalshi API
- [ ] Portfolio tracking and P&L reporting
- [ ] Backtesting framework for strategy validation

### Long-term
- [ ] Multi-exchange arbitrage detection
- [ ] Custom market creation recommendations
- [ ] Community sentiment aggregation
- [ ] Mobile push notifications

---

## Data Storage

Calibration data stored in `data/`:
- `predictions.json` - All prediction records
- `calibration.json` - Latest calibration report
- `whale_predictions.json` - Whale prediction history
- `whale_performance.json` - Whale win rates by category
