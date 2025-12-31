# Brainstorm Session: Missing Links & Data Source Gaps
**Date:** December 31, 2025
**Session Type:** Interactive Requirements Discovery

---

## Executive Summary

Through systematic exploration, we identified **6 major gap categories** and **15+ specific missing links** that would strengthen the Kalshi Bot's edge detection capabilities.

**User Decisions:**
- Unify team aliases → **Single source of truth** (shared teams.ts module)
- Data source priorities → **Injury feeds, Weather APIs, Additional sportsbooks, Entertainment sources**
- Entertainment expansion → **All sources** (TMDb, OMDB, awards aggregators, streaming, music charts)
- RT resilience → **TMDb/OMDB as fallback**
- Matching improvement → **Date/event extraction**
- Political data → **Polling aggregators (538, RCP, Silver Bulletin) + RSS feeds**

---

## Gap 1: Team Alias System Fragmentation

### Problem
Two separate alias dictionaries exist:
- `sports-odds.ts` lines 481-512: ~30 teams
- `cross-platform.ts` lines 23-450: 200+ teams

### Solution: Single Source of Truth

Create `/src/data/teams.ts`:

```typescript
// Comprehensive team database with all variations
export const TEAM_DATABASE = {
  nfl: {
    chiefs: {
      canonical: 'Kansas City Chiefs',
      aliases: ['chiefs', 'kansas city chiefs', 'kc chiefs', 'kansas city'],
      abbreviations: ['KC'],
      city: 'Kansas City',
      conference: 'AFC',
      division: 'West',
    },
    // ... all 32 NFL teams
  },
  nba: { /* 30 teams */ },
  mlb: { /* 30 teams */ },
  nhl: { /* 32 teams */ },
  ncaaf: { /* major programs */ },
  ncaab: { /* major programs */ },
};

// Export flat alias maps for quick lookup
export const NFL_ALIASES = buildAliasMap(TEAM_DATABASE.nfl);
export const ALL_TEAM_ALIASES = buildAllAliasMap(TEAM_DATABASE);
```

**Files to update:**
- `src/analysis/cross-platform.ts` - Import from teams.ts
- `src/fetchers/sports-odds.ts` - Import from teams.ts
- `src/config.ts` - TRACKED_TOPICS can reference teams.ts

---

## Gap 2: Missing Sports Data Sources

### Priority 1: Injury Feeds
**Purpose:** Powers `injury-overreaction.ts` with real data

| Source | API | Cost | Data |
|--------|-----|------|------|
| Rotowire | REST API | $50/mo | Real-time injury updates |
| ESPN Injury Report | Hidden API | Free | Injury designations |
| Sportsdata.io | REST API | $10/mo | Injury status |

**Implementation:** Create `src/fetchers/injuries.ts`

### Priority 2: Weather APIs
**Purpose:** Powers `weather-overreaction.ts` with game-day conditions

| Source | API | Cost |
|--------|-----|------|
| OpenWeatherMap | REST | Free tier |
| Weather.gov | REST | Free |
| Visual Crossing | REST | Free tier |

**Implementation:** Create `src/fetchers/weather.ts`

### Priority 3: Additional Sportsbooks
**Current:** The Odds API (multiple books)
**Add:** Direct feeds from:
- DraftKings (for line movement)
- FanDuel (additional consensus)
- BetMGM (sharp book reputation)

---

## Gap 3: Entertainment Data Source Expansion

### Current State
- Rotten Tomatoes (brittle scraping)
- Box Office Mojo (brittle scraping)
- RSS feeds (news only, no structured data)

### Recommended Additions

#### TMDb API (Primary)
```
API: api.themoviedb.org/3
Cost: Free (rate limited)
Data: Movie metadata, release dates, popularity scores
```

#### OMDB API (Fallback for scores)
```
API: omdbapi.com
Cost: Free tier (1000/day)
Data: IMDB scores, Metacritic, Rotten Tomatoes, Awards
```

#### Awards Aggregators
| Source | Markets Served |
|--------|----------------|
| GoldDerby | Oscar, Emmy, Grammy predictions |
| Metacritic (awards) | Critical consensus |
| Variety Artisans | Industry insider predictions |

#### Streaming Rankings
| Source | Data |
|--------|------|
| FlixPatrol | Netflix, Disney+, Prime Top 10s |
| JustWatch | Cross-platform popularity |
| Reelgood | Streaming viewership estimates |

#### Music Charts
| Source | Markets |
|--------|---------|
| Spotify Charts API | Streaming numbers, chart positions |
| Billboard API | Official chart data |
| Chartmetric | Cross-platform music analytics |

### Implementation Priority
1. `src/fetchers/tmdb.ts` - Movie metadata
2. `src/fetchers/omdb.ts` - Score fallback
3. `src/fetchers/awards-consensus.ts` - GoldDerby aggregation
4. `src/fetchers/streaming-rankings.ts` - FlixPatrol/JustWatch

---

## Gap 4: Cross-Platform Matching Improvements

### Priority: Date/Event Extraction

**Current Problem:**
- "Will Chiefs win on January 12?" doesn't match "Chiefs AFC Championship"
- Time-bound markets get missed

**Solution:** Add date/event parser to `cross-platform.ts`:

```typescript
interface ExtractedEvent {
  date?: Date;
  eventName?: string;  // "AFC Championship", "Super Bowl", "Game 7"
  round?: string;      // "Playoffs", "Finals", "Semifinal"
  season?: string;     // "2024-25", "2025"
}

function extractEventContext(title: string): ExtractedEvent {
  // Parse dates: "January 12", "Jan 12", "1/12", "1/12/25"
  // Parse events: "Super Bowl", "World Series", "NBA Finals"
  // Parse rounds: "Round 1", "Quarterfinal", "Championship"
}
```

**Matching enhancement:**
- Same teams + same date = 95% confidence
- Same teams + same event = 90% confidence
- Same teams + same round = 85% confidence

---

## Gap 5: Political Data Integration

### Polling Aggregators

| Source | API/Method | Data |
|--------|------------|------|
| **FiveThirtyEight** | RSS + scraping | Polling averages, forecasts |
| **RealClearPolitics** | RSS + scraping | Polling aggregates |
| **Silver Bulletin** | Substack RSS | Nate Silver analysis |
| **270toWin** | Scraping | Electoral map consensus |
| **Polymarket/Kalshi** | Already have | Market prices as polls |

### Implementation: `src/fetchers/polling.ts`

```typescript
export interface PollingData {
  race: string;           // "President 2028", "Senate GA"
  candidate: string;
  pollAverage: number;    // 538/RCP average
  trend: 'up' | 'down' | 'stable';
  lastUpdated: string;
  source: 'fivethirtyeight' | 'rcp' | 'silver_bulletin';
}

export async function fetchPollingAggregates(): Promise<PollingData[]> {
  // Combine 538 + RCP + Silver Bulletin
  // Weight by recency and methodology rating
}
```

### Edge Detection
```typescript
// In pipeline.ts
const polling = await fetchPollingAggregates();
const kalshiPrice = market.price;
const pollingConsensus = polling.find(p => matchesMarket(p, market));

if (Math.abs(kalshiPrice - pollingConsensus.pollAverage) > 0.05) {
  // Potential edge: market diverges from polling consensus
}
```

---

## Gap 6: Data Source Reliability

### Current Fragility Points

| Source | Risk | Mitigation |
|--------|------|------------|
| Rotten Tomatoes scraper | Site changes break it | TMDb/OMDB fallback |
| Box Office Mojo scraper | Site changes break it | The Numbers API fallback |
| RSS feeds | Feeds get deprecated | Multiple sources per topic |
| The Odds API | Rate limits, outages | Cache + multiple providers |

### Recommended Resilience Pattern

```typescript
// src/utils/resilient-fetch.ts
export async function fetchWithFallback<T>(
  primary: () => Promise<T>,
  fallbacks: Array<() => Promise<T>>,
  cacheTTL: number = 3600
): Promise<T> {
  // Try primary
  // On failure, try fallbacks in order
  // Cache successful results
  // Return cached data if all fail
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Create `src/data/teams.ts` - unified team database
- [ ] Refactor `cross-platform.ts` to use shared teams
- [ ] Refactor `sports-odds.ts` to use shared teams
- [ ] Add standard abbreviations (NYG, LAL, etc.)

### Phase 2: Entertainment Expansion (Week 2)
- [ ] Implement `src/fetchers/tmdb.ts`
- [ ] Implement `src/fetchers/omdb.ts`
- [ ] Add TMDb/OMDB fallback to entertainment.ts
- [ ] Create `src/fetchers/awards-consensus.ts`

### Phase 3: Sports Data (Week 3)
- [ ] Implement `src/fetchers/injuries.ts`
- [ ] Implement `src/fetchers/weather.ts`
- [ ] Wire injuries into injury-overreaction.ts
- [ ] Wire weather into weather-overreaction.ts

### Phase 4: Political & Matching (Week 4)
- [ ] Implement `src/fetchers/polling.ts`
- [ ] Add date/event extraction to cross-platform.ts
- [ ] Create political edge detection module
- [ ] Integration testing

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/data/teams.ts` | Single source of truth for team aliases |
| `src/fetchers/tmdb.ts` | TMDb movie metadata |
| `src/fetchers/omdb.ts` | OMDB scores (RT fallback) |
| `src/fetchers/injuries.ts` | Real-time injury feeds |
| `src/fetchers/weather.ts` | Game-day weather |
| `src/fetchers/polling.ts` | Political polling aggregates |
| `src/fetchers/awards-consensus.ts` | GoldDerby/awards predictions |
| `src/fetchers/streaming-rankings.ts` | Netflix/Disney+ rankings |
| `src/utils/resilient-fetch.ts` | Fallback pattern utility |

---

## API Keys Needed

| Service | Key Required | Cost |
|---------|--------------|------|
| TMDb | Yes | Free |
| OMDB | Yes | Free (1000/day) |
| OpenWeatherMap | Yes | Free tier |
| Rotowire | Yes | $50/mo |
| Spotify | Yes | Free |
| GoldDerby | No (scraping) | Free |

---

## Next Steps

1. Review this brainstorm document
2. Prioritize implementation phases
3. Begin with Phase 1 (team alias unification)
4. Add API keys to `.env` as needed

---

*Generated from /sc:brainstorm session on December 31, 2025*
