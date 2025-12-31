# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kalshi Edge Detector v2 - A TypeScript system for detecting edges in Kalshi prediction markets using multiple converging signals:

### Core Signals
1. **Cross-Platform Price Divergence** - Kalshi vs Polymarket price gaps
2. **Sentiment-Price Divergence** - News sentiment vs market price
3. **Whale Activity** - Signals from top Polymarket traders

### Meta Edge Signals (Advanced)
4. **Options-Implied Probabilities** - Fed Funds Futures, SPX options, Treasury curve
5. **New Market Scanner** - Early mover advantage on fresh markets
6. **Calibration Tracking** - Historical accuracy and bias adjustment

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
│   ├── news.ts        # RSS feed aggregation
│   ├── whales.ts      # Whale activity tracking
│   ├── entertainment.ts # Box office, Rotten Tomatoes
│   ├── options-implied.ts # Fed Funds, SPX, Treasury yields
│   └── economic/      # Fed, CPI, Jobs, GDP nowcasts
├── edge/              # Edge detection modules
│   ├── macro-edge.ts  # Economic indicator edges
│   ├── new-market-scanner.ts # Fresh market detection
│   └── calibration-tracker.ts # Prediction tracking
├── analysis/          # Sentiment, cross-platform matching, Kelly sizing
└── output/            # Discord output
    ├── discord.ts     # Webhooks + bot
    └── channels.ts    # Multi-channel routing
```

## Key Dependencies

- **@alango/dr-manhattan** - Unified API for prediction market exchanges (Kalshi REST + RSA auth, Polymarket REST + WebSocket)
- **sentiment** - Text sentiment analysis with custom market lexicon
- **rss-parser** - Fetches 30+ news RSS feeds
- **discord.js** - Discord bot + slash commands

## Pipeline Flow (pipeline.ts)

1. Fetch markets from Kalshi + Polymarket via dr-manhattan
2. Fetch news from RSS feeds
3. Check whale activity
4. Match markets cross-platform using title similarity + entity extraction
5. Analyze sentiment by topic
6. Find sentiment-based edges
7. Combine signals into opportunities with Kelly sizing
8. Send alerts to Discord

## Config (.env)

Required: `DISCORD_WEBHOOK_URL` or `DISCORD_BOT_TOKEN`
Optional: `KALSHI_API_KEY_ID`, `NEWS_API_KEY`, `BANKROLL`, `MIN_EDGE_THRESHOLD`

### Discord Channels (Optional)

For segmented alerts, configure separate webhooks:
- `DISCORD_WEBHOOK_CRITICAL` - High conviction signals only
- `DISCORD_WEBHOOK_MACRO` - Fed, CPI, Jobs, GDP edges
- `DISCORD_WEBHOOK_CROSS_PLATFORM` - Kalshi vs Polymarket divergences
- `DISCORD_WEBHOOK_WHALE` - Smart money movements
- `DISCORD_WEBHOOK_SENTIMENT` - News sentiment edges
- `DISCORD_WEBHOOK_NEW_MARKETS` - Fresh market opportunities
- `DISCORD_WEBHOOK_META` - Options-implied, calibration signals
- `DISCORD_WEBHOOK_DIGEST` - Daily summary
- `DISCORD_WEBHOOK_STATUS` - System health

## Extending

- Add new RSS feeds in `config.ts` → `RSS_FEEDS`
- Add tracked topics in `config.ts` → `TRACKED_TOPICS`
- Add whale accounts in `config.ts` → `KNOWN_WHALES`
- Adjust position sizing in `analysis/position-sizing.ts`

## Meta Edge Modules

### Options-Implied (`fetchers/options-implied.ts`)
- `fetchFedFundsImplied()` - CME FedWatch probabilities
- `fetchSPXImplied()` - VIX-based tail risk probabilities
- `fetchTreasuryYields()` - Yield curve recession signal

### New Market Scanner (`edge/new-market-scanner.ts`)
- `scanNewMarkets()` - Detect fresh markets with early mover advantage
- Tracks market age, liquidity trends, cross-platform references

### Calibration Tracker (`edge/calibration-tracker.ts`)
- `recordPrediction()` - Log predictions for tracking
- `resolvePrediction()` - Record outcomes
- `calculateCalibration()` - Brier score, accuracy by category
- `adjustForCalibration()` - Bias-adjusted estimates

## Data Storage

Calibration data stored in `data/`:
- `predictions.json` - All prediction records
- `calibration.json` - Latest calibration report
