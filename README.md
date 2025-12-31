# Kalshi Edge Detector v2

Multi-signal edge detection system for Kalshi prediction markets.

## Strategy

Hunt for edges using multiple converging signals:

### Core Signals
1. **Cross-Platform Price Divergence** - When Polymarket shows 98% YES and Kalshi shows 89% YES, that's a potential edge
2. **Sentiment-Price Divergence** - When aggregated news/social sentiment implies a different probability than the market price
3. **Whale Activity** - Large positions from top Polymarket traders can signal informed money
4. **On-Chain Whale Conviction** - Track what top traders are actually betting via Polymarket's on-chain data

### Adversarially Validated Signals
Signals that pass the "who's on the other side?" test:

5. **Fed Regime Bias** - FedWatch historically misprices in certain rate environments
6. **Injury Overreaction** - Public overreacts to star player injuries beyond actual impact
7. **Sports Odds Consensus** - Sportsbooks have sharper lines from higher handle
8. **Weather Overreaction** - Apply climatological base rates + forecast skill limits
9. **Recency Bias** - Fade markets that moved more than optimal Bayesian update

### Meta Edge Signals
10. **Options-Implied Probabilities** - Fed Funds Futures price rate decisions, SPX options price recession risk
11. **New Market Scanner** - Fresh markets are often mispriced before liquidity arrives
12. **Calibration Tracking** - Track prediction accuracy over time, adjust for historical biases

**The ideal trade:** Multiple signals align (e.g., Polymarket at 95% + bullish sentiment + whale accumulation + sportsbook consensus 90%, while Kalshi sits at 82%)

## Features

- Real-time market data via [@alango/dr-manhattan](https://github.com/gtg7784/dr-manhattan-ts)
- Kalshi REST API with RSA authentication
- Polymarket REST + on-chain whale position tracking
- Sentiment analysis from 100+ RSS news sources with sports-specific lexicon
- Cross-platform price comparison with 200+ entity aliases
- Sportsbook consensus comparison via The Odds API
- Kelly Criterion position sizing
- Discord alerts with clear action guidance (webhooks + slash commands)
- Tiered alerts: 🔴 Critical, 🟡 Standard, 🟢 FYI

### Coverage

#### Sports Teams (200+)
- **NFL**: All 32 teams
- **NBA**: All 30 teams
- **MLB**: All 30 teams
- **NHL**: All 32 teams
- **NCAAF**: ~70 major programs (SEC, Big Ten, ACC, Big 12)
- **NCAAB**: ~50 basketball powerhouses

#### Other Entities
- Politicians (Trump, Biden, Harris, DeSantis, etc.)
- Business leaders (Musk, Bezos, Cook, Zuckerberg, etc.)
- World leaders (Putin, Xi, Zelensky, Netanyahu, etc.)
- Companies (OpenAI, Google, Microsoft, Tesla, etc.)
- Entertainment figures (Taylor Swift, major franchises)

## Quick Start

```bash
# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your Discord webhook

# Test webhook
npm run scan -- --test

# Run scan
npm run scan

# Start Discord bot
npm run bot
```

## Commands

### CLI

```bash
npm run dev              # Watch mode for development
npm run scan             # Run scan immediately
npm run scan -- --test   # Test Discord webhook
npm run bot              # Start Discord bot
npm run build            # Build for production
npm start                # Run in scheduled mode (6:30am, 12pm, 5pm ET)
```

### Discord Slash Commands

| Command | Description |
|---------|-------------|
| `/scan` | Run immediate market scan |
| `/divergences` | Show cross-platform price differences |
| `/whales` | Check whale activity |
| `/status` | Bot status and settings |
| `/boxoffice` | Current weekend box office numbers |
| `/rt [movie]` | Rotten Tomatoes score lookup |

## Discord Alert Format

Alerts now include clear position guidance:

```
🔴 **CRITICAL EDGE DETECTED**

**Chiefs to win Super Bowl**

🟢 ACTION: BUY YES @ 65¢

📍 **Current Price:** 65¢
📊 **Fair Value:** 75¢
📈 **Edge:** +10.0%
🎯 **Confidence:** 75%

**Why this edge exists:**
• Sportsbook consensus: 74% (sharper money says this is mispriced)
• Game: Chiefs @ Eagles

**Position Sizing:**
• Suggested size: **$500**
• Kelly fraction: 8.5%

Platform: **KALSHI**
[>>> TRADE NOW <<<](url)
```

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Description |
|----------|-------------|
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts |
| `DISCORD_BOT_TOKEN` | Discord bot token for slash commands |
| `KALSHI_API_KEY_ID` | Kalshi API key (optional) |
| `NEWS_API_KEY` | NewsAPI key for more news sources |
| `ODDS_API_KEY` | The Odds API key for sportsbook consensus |
| `BANKROLL` | Your total bankroll for position sizing |
| `MIN_EDGE_THRESHOLD` | Minimum edge to flag (default: 4%) |

### Multi-Channel Discord

Route different signal types to dedicated channels:

| Webhook Variable | Signal Type |
|-----------------|-------------|
| `DISCORD_WEBHOOK_CRITICAL` | High conviction (>15% edge) |
| `DISCORD_WEBHOOK_MACRO` | Fed, CPI, Jobs, GDP |
| `DISCORD_WEBHOOK_CROSS_PLATFORM` | Kalshi vs Polymarket |
| `DISCORD_WEBHOOK_WHALE` | Smart money movements |
| `DISCORD_WEBHOOK_SENTIMENT` | News sentiment |
| `DISCORD_WEBHOOK_NEW_MARKETS` | Fresh markets |

## Architecture

```
src/
├── index.ts           # CLI entry point
├── pipeline.ts        # Main edge detection pipeline
├── config.ts          # Configuration + 39 tracked topics
├── types/             # TypeScript types
├── exchanges/         # Kalshi + Polymarket via dr-manhattan
├── fetchers/          # Data fetchers
│   ├── news.ts        # 100+ RSS feeds
│   ├── sports-odds.ts # The Odds API
│   ├── polymarket-onchain.ts # Whale positions
│   └── economic/      # Fed, CPI, Jobs, GDP
├── edge/              # Edge detection
│   ├── fed-regime-bias.ts
│   ├── injury-overreaction.ts
│   ├── weather-overreaction.ts
│   ├── recency-bias.ts
│   └── cross-platform-conviction.ts
├── analysis/          # Core analysis
│   ├── cross-platform.ts # 200+ entity aliases
│   ├── sentiment.ts   # Sports-specific lexicon
│   └── position-sizing.ts # Kelly criterion
└── output/            # Discord with enhanced formatting
```

## How It Works

1. **Fetch Markets** - Get open markets from Kalshi and Polymarket
2. **Fetch News** - Aggregate news from 100+ RSS feeds
3. **Cross-Platform Match** - Match markets using 200+ entity aliases + sports matchup detection
4. **Sentiment Analysis** - Score news with sports-specific lexicon (60+ words)
5. **Whale Conviction** - Analyze on-chain positions from top Polymarket traders
6. **Validated Signals** - Run adversarially validated edge detectors
7. **Position Sizing** - Calculate recommended sizes using fractional Kelly
8. **Alert** - Send opportunities to Discord with clear BUY YES/NO guidance

## Sentiment Lexicon

### Sports-Specific Words (60+)
- **Positive**: dominant, clinch, sweep, undefeated, unstoppable, comeback, clutch
- **Negative**: upset, stunned, collapse, choke, eliminated, demolished, slump
- **Injuries**: injured, sidelined, questionable, doubtful, torn, concussion

### Phrase Detection
- "ruled out" → strong negative
- "winning streak" → strong positive
- "blown lead" → collapse signal
- "torn acl" → season-ending negative

## Cross-Platform Matching

### How It Works
1. Extract entities from both titles using 200+ aliases
2. Detect sports matchups (2+ teams from same league = 85% confidence)
3. Boost multi-entity matches (3+ common entities = 70%+ confidence)
4. Apply Jaccard similarity with caps to prevent false positives

### False Positive Prevention
- Removed problematic short aliases (ne, no, tb, etc.)
- Capped Jaccard-only matches at 30%
- Requires entity or year/number overlap for high confidence

## Roadmap

### Near-term
- [ ] More sports events (Olympics, World Cup)
- [ ] Twitter/X sentiment integration
- [ ] Backtesting framework
- [ ] Paper trading mode

### Medium-term
- [ ] ML-based edge prediction
- [ ] Automated trade execution
- [ ] Portfolio tracking & P&L
- [ ] Mobile notifications

### Long-term
- [ ] Multi-exchange arbitrage
- [ ] Custom market recommendations
- [ ] Community sentiment
- [ ] External API

## License

MIT
