# Project Index: Kalshi Edge Detector

Generated: 2026-01-02

## Project Overview

TypeScript system for detecting edges in Kalshi prediction markets using multiple converging signals (cross-platform divergence, sentiment analysis, whale activity, macroeconomic indicators).

## Quick Start

```bash
npm run scan         # Run edge detection scan
npm run bot          # Start Discord bot with slash commands
npm run build        # Compile TypeScript
npm start            # Scheduled mode (6:30am, 12pm, 5pm ET)
```

## Project Structure

```
src/                          # 73 TypeScript files
├── index.ts                  # CLI entry point
├── pipeline.ts               # Main 8-step edge detection pipeline
├── config.ts                 # Environment + tracked topics/whales
├── types/           (4)      # TypeScript interfaces
├── analysis/        (5)      # Sentiment, cross-platform matching, Kelly sizing
├── fetchers/        (26)     # Data fetchers (news, sports, crypto, health)
├── edge/            (18)     # Edge detection modules
├── exchanges/       (1)      # dr-manhattan wrapper (Kalshi + Polymarket)
├── output/          (3)      # Discord webhooks + bot
├── utils/           (5)      # Logger, auth, resilient fetch
├── ml/              (7)      # ML scoring model
└── data/            (1)      # Data access layer
```

## Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI: `--scan`, `--bot`, `--run-now` |
| `src/pipeline.ts` | Main edge detection pipeline (8 steps) |
| `src/output/discord.ts` | Discord bot + slash commands |

## Core Modules

### Pipeline (`src/pipeline.ts`)
8-step edge detection: fetch markets → news → whale activity → match cross-platform → sentiment analysis → macro signals → combine opportunities → Discord alerts

### Exchanges (`src/exchanges/index.ts`)
- `fetchKalshiMarkets()` - Paginated market fetch
- `fetchKalshiCryptoMarkets()` - KXBTC, KXBTCD, KXETH series
- `fetchKalshiEconomicsMarkets()` - KXGDP, KXCPI, KXFED series
- `fetchPolymarketMarkets()` - Cross-platform matching

### Fetchers (`src/fetchers/`)
| Module | Data Source |
|--------|-------------|
| `espn-odds.ts` | ESPN public API (NFL/NBA/NHL/MLB) |
| `crypto-funding.ts` | Hyperliquid funding rates + Fear/Greed |
| `fed-nowcasts.ts` | Atlanta Fed GDPNow + Cleveland inflation |
| `cdc-surveillance.ts` | Wastewater + flu surveillance |
| `news.ts` | 100+ RSS feeds aggregation |
| `entertainment.ts` | Rotten Tomatoes, box office |
| `whales.ts` | Polymarket whale tracking |

### Edge Detectors (`src/edge/`)
| Module | Signal Type |
|--------|-------------|
| `earnings-edge.ts` | Earnings call keyword mentions |
| `fed-regime-bias.ts` | FedWatch regime adjustment |
| `injury-overreaction.ts` | Sports injury overreaction |
| `weather-overreaction.ts` | Weather forecast bias |
| `recency-bias.ts` | Base rate neglect detection |
| `cross-platform-conviction.ts` | Whale conviction edges |
| `calibration-tracker.ts` | Historical accuracy tracking |
| `new-market-scanner.ts` | Early mover advantage |

### Analysis (`src/analysis/`)
- `cross-platform.ts` - Entity extraction + market matching (200+ sports teams, politicians, companies)
- `sentiment.ts` - Custom lexicon (sports, crypto, injury terms)
- `position-sizing.ts` - Kelly criterion sizing

### Output (`src/output/`)
- `discord.ts` - Bot + webhooks + slash commands (`/status`, `/scan`)
- `channels.ts` - Multi-channel routing (sports, crypto, economics, etc.)

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@alango/dr-manhattan` | Unified Kalshi/Polymarket API |
| `discord.js` | Discord bot + slash commands |
| `sentiment` | Text sentiment analysis |
| `rss-parser` | News RSS aggregation |
| `natural` | NLP for entity extraction |

## Configuration

| File | Purpose |
|------|---------|
| `.env` | API keys, webhooks, bankroll settings |
| `tsconfig.json` | TypeScript config (ES2022, strict) |
| `data/` | Predictions, calibration, whale performance |

## Discord Channels

| Channel | Webhook Env Var | Content |
|---------|-----------------|---------|
| Sports | `DISCORD_WEBHOOK_SPORTS` | NFL/NBA/MLB/NHL edges |
| Crypto | `DISCORD_WEBHOOK_CRYPTO` | BTC/ETH funding signals |
| Economics | `DISCORD_WEBHOOK_ECONOMICS` | GDP/CPI/Fed rate edges |
| Mentions | `DISCORD_WEBHOOK_MENTIONS` | Earnings + Fed speech |
| Health | `DISCORD_WEBHOOK_HEALTH` | CDC measles/flu |
| Entertainment | `DISCORD_WEBHOOK_ENTERTAINMENT` | RT scores, awards |

## Data Files

| File | Purpose |
|------|---------|
| `data/predictions.json` | All prediction records |
| `data/calibration.json` | Accuracy tracking |
| `data/whale_predictions.json` | Whale prediction history |
| `data/whale_performance.json` | Win rates by category |
| `data/ml/model.json` | ML scoring model |

## Tests

```bash
npm test              # Run vitest
```

Located in `src/*/__tests__/*.test.ts`

## Current Status (Jan 2026)

| Channel | Status | Notes |
|---------|--------|-------|
| Crypto | Working | 200+ signals from funding rates |
| Economics | Working | 8+ GDP edges from nowcasts |
| Mentions | Strong | 95% edge on earnings keywords |
| Health | Working | CDC wastewater + measles |
| Sports | Limited | All Kalshi markets are parlays |
| Weather | Inactive | No open Kalshi weather markets |

## Token Savings

- Full codebase read: ~58,000 tokens
- This index: ~2,500 tokens
- **Savings: 96%**
