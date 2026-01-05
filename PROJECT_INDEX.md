# Project Index: Kalshi Edge Detector v4.0

Generated: 2026-01-05

## Project Overview

TypeScript system for detecting edges in Kalshi prediction markets using a modular plugin-based architecture. v4.0 introduces a simplified core framework with auto-registration of sources, processors, and detectors.

## Quick Start

```bash
# Legacy v2 commands
npm run scan         # Run edge detection scan
npm run bot          # Start Discord bot with slash commands

# New v4.0 commands
npm run v4:scan      # Run v4.0 pipeline once
npm run v4           # Run v4.0 continuous mode

# Build & Test
npm run build        # Compile TypeScript
npm test             # Run vitest
```

## Architecture Overview

### v4.0 Plugin System

```
Sources (fetch data) → Processors (enrich) → Detectors (find edges) → Output
```

**Key Benefits:**
- Add new data sources by creating one file in `src/sources/`
- Add new detectors by creating one file in `src/detectors/`
- Unified types: `Market`, `Edge`, `Processor`
- Pipeline reduced from 2000+ lines to 256 lines

## Project Structure

```
src/
├── core/              # v4.0 Core Framework (5 files)
│   ├── types.ts       # Unified types (Edge, Market, Processor, etc.)
│   ├── registry.ts    # Plugin registration + auto-caching
│   ├── pipeline.ts    # Simplified 256-line orchestrator
│   ├── cache.ts       # Unified TTL cache
│   └── index.ts       # Exports
│
├── sources/           # v4.0 Data Sources (18 files)
│   ├── kalshi.ts              # Kalshi markets (primary)
│   ├── polymarket.ts          # Polymarket Gamma API
│   ├── cdc-measles.ts         # CDC measles surveillance
│   ├── espn-sports.ts         # ESPN free API
│   ├── news.ts                # RSS feeds (14 sources)
│   ├── fed-nowcasts.ts        # Atlanta Fed GDPNow + Cleveland inflation
│   ├── crypto-funding.ts      # Hyperliquid funding + Fear & Greed
│   ├── options-implied.ts     # Fed funds, VIX, Treasury curve
│   ├── polling.ts             # 538/RCP approval + generic ballot
│   ├── google-trends.ts       # Search trend spikes
│   ├── weather.ts             # Open-Meteo for NFL venues
│   ├── entertainment.ts       # Rotten Tomatoes scores
│   ├── injuries.ts            # ESPN injuries API
│   ├── kalshi-mentions.ts     # Kalshi mentions markets
│   ├── earnings-transcripts.ts # Historical earnings transcripts
│   ├── executive-media.ts     # YouTube/media executive appearances
│   ├── cdc-surveillance.ts    # CDC wastewater + flu surveillance
│   ├── whale-discovery.ts     # Polymarket whale auto-discovery
│   └── index.ts               # Auto-registration
│
├── processors/        # v4.0 Data Processors (2 files)
│   ├── sentiment.ts   # NLP sentiment analysis
│   └── index.ts       # Registration
│
├── detectors/         # v4.0 Edge Detectors (6 files)
│   ├── cross-platform.ts  # Kalshi vs Polymarket prices
│   ├── health.ts          # CDC data vs health markets
│   ├── sports.ts          # ESPN odds vs sports markets
│   ├── sentiment.ts       # News sentiment divergence
│   ├── whale.ts           # Polymarket whale positions
│   └── index.ts           # Registration
│
├── edge/              # Standalone Edge Detectors
│   ├── mentions-edge.ts   # Mentions market edge detection
│   └── ...                # Other edge detectors
│
├── v4.ts              # v4.0 entry point
├── index.ts           # Legacy v2 entry point
├── pipeline.ts        # Legacy 8-step pipeline
│
├── fetchers/   (27)   # Legacy data fetchers
├── models/     (3)    # Time-decay, limit orders
├── realtime/   (4)    # WebSocket monitoring
├── output/     (3)    # Discord output
└── data/       (1)    # Team aliases
```

## v4.0 Sources (18 Total)

| # | Source | Category | Cache TTL | Description |
|---|--------|----------|-----------|-------------|
| 1 | `kalshi` | other | 2 min | Primary market data (263 markets) |
| 2 | `polymarket` | other | 5 min | Polymarket Gamma API |
| 3 | `cdc-measles` | health | 1 hour | CDC case counts + projections |
| 4 | `espn-sports` | sports | 10 min | NFL/NBA/MLB/NHL games + odds |
| 5 | `news` | other | 5 min | 14 RSS feeds, 100+ articles |
| 6 | `fed-nowcasts` | macro | 1 hour | Atlanta Fed GDPNow + Cleveland inflation |
| 7 | `crypto-funding` | crypto | 5 min | Hyperliquid funding + Fear & Greed |
| 8 | `options-implied` | macro | 30 min | Fed funds futures, VIX, Treasury curve |
| 9 | `polling` | politics | 1 hour | 538/RCP approval + generic ballot |
| 10 | `google-trends` | other | 30 min | Search trend spike detection |
| 11 | `weather` | sports | 30 min | Open-Meteo for NFL outdoor venues |
| 12 | `entertainment` | entertainment | 1 hour | Rotten Tomatoes scores |
| 13 | `injuries` | sports | 15 min | ESPN injuries API |
| 14 | `kalshi-mentions` | other | 5 min | Kalshi mentions markets |
| 15 | `earnings-transcripts` | other | 24 hours | Historical earnings transcripts |
| 16 | `executive-media` | other | 1 hour | YouTube/CNBC/Bloomberg appearances |
| 17 | `cdc-surveillance` | health | 1 hour | Wastewater + flu surveillance |
| 18 | `whale-discovery` | other | 30 min | Polymarket whale auto-discovery |

## v4.0 Detectors (6 Total)

| Detector | Signal | Min Edge | Sources Used |
|----------|--------|----------|--------------|
| `cross-platform` | Kalshi vs Polymarket price divergence | 5% | kalshi, polymarket |
| `health` | CDC data vs health market prices | 8% | kalshi, cdc-measles |
| `sports` | ESPN odds vs sports market prices | 6% | kalshi, espn-sports |
| `sentiment` | News sentiment vs market prices | 8% | kalshi, news |
| `whale` | Polymarket whale conviction | 8% | kalshi, polymarket |
| `mentions` | Earnings transcript keyword analysis | 10% | kalshi-mentions, earnings-transcripts, executive-media |

## Mentions Edge Detection System

Specialized system for trading Kalshi "mentions" markets like:
- "Will Constellation Brands mention 'tariffs' in their Q2 2025 earnings call?"

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Kalshi Mentions Source | `sources/kalshi-mentions.ts` | Fetch active mentions markets |
| Earnings Transcripts | `sources/earnings-transcripts.ts` | 4 quarters of historical data |
| Executive Media | `sources/executive-media.ts` | YouTube/CNBC/Bloomberg RSS |
| Mentions Edge Detector | `edge/mentions-edge.ts` | Find mispriced keywords |

### Edge Detection Weights
- **60%**: Historical mention rate (% of quarters keyword mentioned)
- **15%**: Trend direction (increasing/stable/decreasing)
- **10%**: Analyst interest in Q&A sessions
- **15%**: Recent executive media appearances

### Optional API Keys
| Service | Env Variable | Purpose |
|---------|--------------|---------|
| Financial Modeling Prep | `FMP_API_KEY` | Full earnings transcripts |
| YouTube Data API | `YOUTUBE_API_KEY` | Search for interviews |

## Adding New Components

### New Data Source
```typescript
// src/sources/my-source.ts
import { defineSource } from '../core/index.js';

export default defineSource({
  name: 'my-source',
  category: 'crypto',
  cacheTTL: 300,  // 5 min cache
  async fetch() {
    // Return your data
  }
});
```

### New Detector
```typescript
// src/detectors/my-detector.ts
import { defineDetector, createEdge } from '../core/index.js';

export default defineDetector({
  name: 'my-detector',
  sources: ['kalshi', 'my-source'],
  minEdge: 0.05,
  async detect(data, markets) {
    const edges = [];
    // Your detection logic
    return edges;
  }
});
```

## Core Types

```typescript
interface Edge {
  market: Market;
  direction: 'YES' | 'NO';
  edge: number;        // 0-1 (e.g., 0.12 = 12%)
  confidence: number;  // 0-1
  urgency: 'critical' | 'standard' | 'low';
  reason: string;
  signal: EdgeSignal;
}

interface Market {
  platform: 'kalshi' | 'polymarket';
  id: string;
  title: string;
  category: Category;
  price: number;       // YES price (0-1)
  volume?: number;
  liquidity?: number;
  url: string;
}
```

## Legacy System

The v2 pipeline (`src/pipeline.ts`) remains functional for backward compatibility:
- 8-step pipeline with 2000+ lines
- Uses `src/fetchers/` and `src/edge/` modules
- Accessed via `npm run scan` or `npm start`

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@alango/dr-manhattan` | Kalshi/Polymarket API |
| `discord.js` | Discord bot |
| `rss-parser` | News RSS feeds |
| `sentiment` | Text sentiment |

## Token Savings

- Full codebase read: ~58,000 tokens
- This index: ~2,500 tokens
- **Savings: 96%**
