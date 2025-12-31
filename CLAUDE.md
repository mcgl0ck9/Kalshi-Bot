# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kalshi Edge Detector v2 - A TypeScript system for detecting edges in Kalshi prediction markets using three converging signals:

1. **Cross-Platform Price Divergence** - Kalshi vs Polymarket price gaps
2. **Sentiment-Price Divergence** - News sentiment vs market price
3. **Whale Activity** - Signals from top Polymarket traders

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
├── types/index.ts     # All TypeScript interfaces
├── exchanges/         # dr-manhattan wrapper for Kalshi + Polymarket
├── fetchers/          # News RSS + whale tracking
├── analysis/          # Sentiment, cross-platform matching, Kelly sizing
└── output/            # Discord webhooks + bot
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

## Extending

- Add new RSS feeds in `config.ts` → `RSS_FEEDS`
- Add tracked topics in `config.ts` → `TRACKED_TOPICS`
- Add whale accounts in `config.ts` → `KNOWN_WHALES`
- Adjust position sizing in `analysis/position-sizing.ts`
