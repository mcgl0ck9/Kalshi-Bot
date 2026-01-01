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
│   ├── polymarket-onchain.ts # On-chain whale conviction analysis
│   └── economic/      # Fed, CPI, Jobs, GDP nowcasts
├── edge/              # Edge detection modules
│   ├── macro-edge.ts  # Economic indicator edges
│   ├── new-market-scanner.ts # Fresh market detection
│   ├── calibration-tracker.ts # Prediction tracking
│   ├── fed-regime-bias.ts # FedWatch regime adjustment
│   ├── injury-overreaction.ts # Sports injury overreaction
│   ├── weather-overreaction.ts # Weather forecast bias
│   ├── recency-bias.ts # Base rate neglect detection
│   └── cross-platform-conviction.ts # Whale conviction edges
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

## Roadmap

### Near-term
- [ ] Add more sports events (Olympics, World Cup, major tournaments)
- [ ] Integrate Twitter/X sentiment for real-time signals
- [ ] Add backtesting framework for strategy validation
- [ ] Implement paper trading mode

### Medium-term
- [ ] Machine learning model for edge prediction
- [ ] Automated trade execution via Kalshi API
- [ ] Portfolio tracking and P&L reporting
- [ ] Mobile push notifications

### Long-term
- [ ] Multi-exchange arbitrage detection
- [ ] Custom market creation recommendations
- [ ] Community sentiment aggregation
- [ ] API for external integrations

---

## Data Storage

Calibration data stored in `data/`:
- `predictions.json` - All prediction records
- `calibration.json` - Latest calibration report
