# v4.0 Migration WIP Log

**Last Updated:** 2026-01-05

## Migration Status Overview

| Category | Legacy | v4.0 | Status |
|----------|--------|------|--------|
| Core Framework | 1 file (2061 lines) | 5 files (~600 lines) | v4.0 complete |
| Data Sources | 21 fetchers | 18 sources | 18 migrated, 3 archive candidates |
| Edge Detectors | 20 detectors | 6 detectors | 6 migrated, 14 pending |
| Processors | N/A | 1 processor | v4.0 complete |

---

## Phase 1: Core Framework

| Component | Status | Notes |
|-----------|--------|-------|
| `src/core/types.ts` | ✅ Complete | Unified types (Edge, Market, etc.) |
| `src/core/registry.ts` | ✅ Complete | Plugin registration + caching |
| `src/core/pipeline.ts` | ✅ Complete | 256-line orchestrator |
| `src/core/cache.ts` | ✅ Complete | TTL-based caching |
| `src/v4.ts` | ✅ Complete | CLI entry point |

---

## Phase 2: Data Source Migration

### Migrated to v4.0

| Legacy Fetcher | v4.0 Source | Status |
|----------------|-------------|--------|
| `fetchers/kalshi` (via dr-manhattan) | `sources/kalshi.ts` | ✅ Complete |
| `fetchers/polymarket-onchain.ts` | `sources/polymarket.ts` | ✅ Complete |
| `fetchers/cdc-measles.ts` | `sources/cdc-measles.ts` | ✅ Complete |
| `fetchers/espn-odds.ts` | `sources/espn-sports.ts` | ✅ Complete |
| `fetchers/news.ts` | `sources/news.ts` | ✅ Complete |
| `fetchers/fed-nowcasts.ts` | `sources/fed-nowcasts.ts` | ✅ Complete |
| `fetchers/crypto-funding.ts` | `sources/crypto-funding.ts` | ✅ Complete |
| `fetchers/options-implied.ts` | `sources/options-implied.ts` | ✅ Complete |
| `fetchers/polling.ts` | `sources/polling.ts` | ✅ Complete |
| `fetchers/google-trends.ts` | `sources/google-trends.ts` | ✅ Complete |
| `fetchers/weather.ts` | `sources/weather.ts` | ✅ Complete (P2) |
| `fetchers/entertainment.ts` | `sources/entertainment.ts` | ✅ Complete (P2) |
| `fetchers/injuries.ts` | `sources/injuries.ts` | ✅ Complete (P2) |
| `fetchers/cdc-surveillance.ts` | `sources/cdc-surveillance.ts` | ✅ Complete (P3) |
| `fetchers/whale-discovery.ts` | `sources/whale-discovery.ts` | ✅ Complete (P3) |

### Mentions Edge Detection Sources (NEW)

| v4.0 Source | Purpose | Status |
|-------------|---------|--------|
| `sources/kalshi-mentions.ts` | Fetch active Kalshi mentions markets | ✅ Complete |
| `sources/earnings-transcripts.ts` | Historical earnings call transcripts | ✅ Complete |
| `sources/executive-media.ts` | YouTube/media executive appearances | ✅ Complete |

### Archive Candidates

| Legacy Fetcher | Reason |
|----------------|--------|
| `fetchers/tmdb.ts` | Merge into entertainment source |
| `fetchers/omdb.ts` | Merge into entertainment source |
| `fetchers/whales.ts` | Superseded by polymarket + whale-discovery |

---

## Phase 3: Edge Detector Migration

### Migrated to v4.0

| Legacy Detector | v4.0 Detector | Status |
|-----------------|---------------|--------|
| `edge/cross-platform-conviction.ts` | `detectors/cross-platform.ts` | ✅ Complete |
| `edge/measles-edge.ts` | `detectors/health.ts` | ✅ Complete |
| `edge/enhanced-sports-edge.ts` | `detectors/sports.ts` | ✅ Complete |
| (new) | `detectors/sentiment.ts` | ✅ Complete |
| `edge/whale-performance.ts` | `detectors/whale.ts` | ✅ Complete |
| (new) | `edge/mentions-edge.ts` | ✅ Complete |

### Pending Migration

| Legacy Detector | Priority | v4.0 Detector Name | Notes |
|-----------------|----------|-------------------|-------|
| `edge/fed-regime-bias.ts` | P1 | `detectors/fed.ts` | Fed speech + regime detection |
| `edge/fed-speech-edge.ts` | P1 | Merge into fed.ts | |
| `edge/macro-edge.ts` | P1 | `detectors/macro.ts` | Economic indicators |
| `edge/time-decay-edge.ts` | P1 | `detectors/time-decay.ts` | Theta-adjusted edges |
| `edge/spread-arbitrage.ts` | P1 | `detectors/arbitrage.ts` | Guaranteed profit |
| `edge/entertainment-edge.ts` | P2 | `detectors/entertainment.ts` | RT scores, box office |
| `edge/polling-edge.ts` | P2 | `detectors/polling.ts` | Election polls |
| `edge/injury-overreaction.ts` | P2 | Merge into sports.ts | |
| `edge/line-move-detector.ts` | P2 | Merge into sports.ts | |
| `edge/weather-overreaction.ts` | P3 | `detectors/weather.ts` | Markets inactive |
| `edge/city-weather-edge.ts` | P3 | Merge into weather.ts | |
| `edge/recency-bias.ts` | P3 | Archive | Complex, low ROI |
| `edge/new-market-scanner.ts` | P3 | `detectors/new-markets.ts` | Early mover |
| `edge/calibration-tracker.ts` | P3 | Keep in legacy | Accuracy tracking |

---

## Mentions Edge Detection System

### Architecture

The Mentions Edge Detection system trades Kalshi "mentions" markets like:
- "Will Constellation Brands mention 'tariffs' in their Q2 2025 earnings call?"

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Kalshi Mentions Source | `sources/kalshi-mentions.ts` | Fetches active mentions markets and keyword options |
| Earnings Transcripts | `sources/earnings-transcripts.ts` | 4 quarters of historical transcripts for base rate |
| Executive Media | `sources/executive-media.ts` | YouTube/CNBC/Bloomberg executive appearances |
| Mentions Edge Detector | `edge/mentions-edge.ts` | Combines data to find mispriced keywords |

### Edge Detection Logic

1. **Historical Base Rate (60%)**: % of quarters company mentioned keyword
2. **Trend Analysis (15%)**: Increasing/stable/decreasing over quarters
3. **Analyst Interest (10%)**: How often analysts ask about topic in Q&A
4. **Recent Media (15%)**: Executive media appearances mentioning keyword

### Required API Keys (Optional)

| Service | Env Variable | Purpose |
|---------|--------------|---------|
| Financial Modeling Prep | `FMP_API_KEY` | Full earnings transcripts |
| YouTube Data API | `YOUTUBE_API_KEY` | Search for executive interviews |

Note: Both sources work without API keys using RSS feeds and public data (limited functionality).

---

## Phase 4: Cleanup Tasks

### After Migration Complete

- [ ] Move `src/fetchers/` to `src/_legacy/fetchers/`
- [ ] Move `src/edge/` to `src/_legacy/edge/`
- [ ] Move `src/pipeline.ts` to `src/_legacy/pipeline.ts`
- [ ] Update `package.json` to remove legacy scripts (or keep as aliases)
- [ ] Update `PROJECT_INDEX.md` with final architecture
- [ ] Delete duplicate type definitions

### Testing Requirements

- [ ] v4.0 pipeline finds edges (currently 0 - may need threshold tuning)
- [ ] Compare v4.0 output vs legacy output for same market set
- [ ] Verify all 18 sources fetch data successfully
- [ ] Verify all 6 detectors run without errors
- [ ] Test mentions edge detection with real Kalshi markets

---

## Quick Reference

### Run v4.0

```bash
npm run build && npm run v4:scan   # Single scan
npm run build && npm run v4        # Continuous mode
```

### Run Legacy

```bash
npm run scan                        # Legacy single scan
npm run bot                         # Legacy Discord bot
```

### Add New v4.0 Source

```typescript
// src/sources/my-source.ts
import { defineSource } from '../core/index.js';

export default defineSource({
  name: 'my-source',
  category: 'crypto',
  cacheTTL: 300,
  async fetch() {
    // Return your data
  }
});
```

Then add to `src/sources/index.ts`.

### Add New v4.0 Detector

```typescript
// src/detectors/my-detector.ts
import { defineDetector, createEdge } from '../core/index.js';

export default defineDetector({
  name: 'my-detector',
  sources: ['kalshi', 'my-source'],
  minEdge: 0.05,
  async detect(data, markets) {
    // Return Edge[]
  }
});
```

Then add to `src/detectors/index.ts`.

---

## v4.0 Sources Summary (18 Total)

| # | Source | Category | Cache TTL | Notes |
|---|--------|----------|-----------|-------|
| 1 | kalshi | other | 120s | Primary market data |
| 2 | polymarket | other | 300s | Cross-platform comparison |
| 3 | cdc-measles | health | 3600s | Measles case tracking |
| 4 | espn-sports | sports | 600s | Sports data aggregator |
| 5 | news | other | 300s | RSS news sentiment |
| 6 | fed-nowcasts | macro | 3600s | Atlanta Fed GDPNow + Cleveland inflation |
| 7 | crypto-funding | crypto | 300s | Hyperliquid funding + Fear & Greed |
| 8 | options-implied | macro | 1800s | Fed funds, VIX, Treasury curve |
| 9 | polling | politics | 3600s | 538/RCP approval + generic ballot |
| 10 | google-trends | other | 1800s | Search trend spikes |
| 11 | weather | sports | 1800s | Open-Meteo for NFL venues |
| 12 | entertainment | entertainment | 3600s | Rotten Tomatoes scores |
| 13 | injuries | sports | 900s | ESPN injuries API |
| 14 | kalshi-mentions | other | 300s | Kalshi mentions markets |
| 15 | earnings-transcripts | other | 86400s | Historical transcripts |
| 16 | executive-media | other | 3600s | YouTube/media appearances |
| 17 | cdc-surveillance | health | 3600s | Wastewater + flu surveillance |
| 18 | whale-discovery | other | 1800s | Polymarket whale auto-discovery |

---

## Notes

- **Pipeline ran successfully** on 2026-01-05 with 18 sources, 1 processor, 6 detectors
- **Mentions Edge Detection** system fully implemented for Kalshi mentions markets
- **P2/P3 migration complete** - all major fetchers now have v4 sources
- **Legacy system still works** - use `npm run scan` for comparison
- **ralph-wiggum plugin installed** - can use for iterative development
