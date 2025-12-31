# Kalshi Edge Detector v2

Multi-signal edge detection system for Kalshi prediction markets.

## Strategy

Hunt for edges using multiple converging signals:

### Core Signals
1. **Cross-Platform Price Divergence** - When Polymarket shows 98% YES and Kalshi shows 89% YES, that's a potential edge
2. **Sentiment-Price Divergence** - When aggregated news/social sentiment implies a different probability than the market price
3. **Whale Activity** - Large positions from top Polymarket traders can signal informed money

### Meta Edge Signals
4. **Options-Implied Probabilities** - Fed Funds Futures price rate decisions, SPX options price recession risk
5. **New Market Scanner** - Fresh markets are often mispriced before liquidity arrives
6. **Calibration Tracking** - Track prediction accuracy over time, adjust for historical biases

**The ideal trade:** Multiple signals align (e.g., Polymarket at 95% + bullish sentiment + whale accumulation + options-implied 90%, while Kalshi sits at 82%)

## Features

- Real-time market data via [@alango/dr-manhattan](https://github.com/gtg7784/dr-manhattan-ts)
- Kalshi REST API with RSA authentication
- Polymarket REST + WebSocket for real-time orderbooks
- Sentiment analysis from 30+ RSS news sources
- Cross-platform price comparison
- Kelly Criterion position sizing
- Discord alerts (webhooks + slash commands)
- Tiered alerts: 🔴 Critical, 🟡 Standard, 🟢 FYI

### Meta Edge Features
- **Options-Implied Module** - Fed Funds Futures, SPX options, Treasury yield curve
- **New Market Scanner** - Detect fresh markets with early mover advantage
- **Calibration Tracker** - Brier scores, accuracy by category, bias adjustment
- **Multi-Channel Discord** - Route signals to dedicated channels by type

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
npm start                # Run in scheduled mode
```

### Discord Slash Commands

| Command | Description |
|---------|-------------|
| `/scan` | Run immediate market scan |
| `/divergences` | Show cross-platform price differences |
| `/whales` | Check whale activity |
| `/status` | Bot status and settings |

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Description |
|----------|-------------|
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts |
| `DISCORD_BOT_TOKEN` | Discord bot token for slash commands |
| `KALSHI_API_KEY_ID` | Kalshi API key (optional) |
| `NEWS_API_KEY` | NewsAPI key for more news sources |
| `BANKROLL` | Your total bankroll for position sizing |
| `MIN_EDGE_THRESHOLD` | Minimum edge to flag (default: 8%) |

## Architecture

```
src/
├── index.ts           # CLI entry point
├── pipeline.ts        # Main edge detection pipeline
├── config.ts          # Configuration
├── types/             # TypeScript types (core, economic, edge, meta-edge)
├── utils/             # Logger, helpers
├── exchanges/         # Kalshi + Polymarket via dr-manhattan
├── fetchers/          # Data fetchers
│   ├── news.ts        # RSS feed aggregation
│   ├── whales.ts      # Whale activity tracking
│   ├── options-implied.ts  # Fed Funds, SPX, Treasury
│   └── economic/      # Fed, CPI, Jobs, GDP nowcasts
├── edge/              # Edge detection
│   ├── macro-edge.ts  # Economic indicator edges
│   ├── new-market-scanner.ts  # Fresh market detection
│   └── calibration-tracker.ts # Prediction tracking
├── analysis/          # Sentiment, cross-platform, sizing
└── output/            # Discord webhooks + channels + bot
```

## How It Works

1. **Fetch Markets** - Get open markets from Kalshi and Polymarket
2. **Fetch News** - Aggregate news from 30+ RSS feeds
3. **Cross-Platform Match** - Match markets between platforms using title similarity + entity extraction
4. **Sentiment Analysis** - Score news articles and aggregate by topic
5. **Find Edges** - Identify divergences between platforms and between sentiment vs price
6. **Position Sizing** - Calculate recommended sizes using fractional Kelly
7. **Alert** - Send top opportunities to Discord

## License

MIT
