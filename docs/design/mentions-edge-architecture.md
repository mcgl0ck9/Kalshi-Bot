# Mentions Edge Detection Architecture

**Status**: ✅ IMPLEMENTED (2026-01-05)

## Overview

Trade Kalshi "Mentions" markets by analyzing earnings call transcripts and executive media appearances to predict keyword usage.

**Example Market**: `KXEARNINGSMENTIONSTZ-26JUN30` - "What keywords will Constellation Brands say in their upcoming earnings call?"

## v4 Integration

Fits into existing v4 pipeline:
```
Sources → Processor → Detectors → Edges
```

### Implemented Components

| Component | Type | File | Status |
|-----------|------|------|--------|
| `kalshi-mentions` | Source | `src/sources/kalshi-mentions.ts` | ✅ Complete |
| `earnings-transcripts` | Source | `src/sources/earnings-transcripts.ts` | ✅ Complete |
| `executive-media` | Source | `src/sources/executive-media.ts` | ✅ Complete |
| `mentions-edge` | Detector | `src/edge/mentions-edge.ts` | ✅ Complete |

---

## Source: `kalshi-mentions.ts`

**Purpose**: Fetch all active Kalshi mentions markets and their keyword options.

```typescript
interface MentionsMarket {
  ticker: string;           // e.g., "KXEARNINGSMENTIONSTZ-26JUN30"
  company: string;          // e.g., "Constellation Brands"
  companyTicker: string;    // e.g., "STZ"
  eventType: 'earnings' | 'speech' | 'interview';
  eventDate: string;        // When the event occurs
  closeTime: string;        // Market close time
  keywords: KeywordOption[];
}

interface KeywordOption {
  keyword: string;          // e.g., "tariffs"
  yesPrice: number;         // Current YES price
  noPrice: number;          // Current NO price
  volume: number;
}

interface MentionsMarketsData {
  markets: MentionsMarket[];
  fetchedAt: string;
}
```

**Implementation**: Use dr-manhattan/Kalshi API to filter markets with "mention" in ticker.

---

## Source: `earnings-transcripts.ts`

**Purpose**: Fetch historical earnings transcripts for keyword frequency analysis.

```typescript
interface EarningsTranscript {
  company: string;
  ticker: string;
  quarter: string;          // e.g., "Q3 2024"
  date: string;
  sections: {
    preparedRemarks: string;
    qaSession: string;
  };
  wordFrequency: Map<string, number>;
  analystQuestions: string[];
}

interface TranscriptsData {
  transcripts: EarningsTranscript[];
  fetchedAt: string;
}
```

**Free Data Sources**:
1. **Financial Modeling Prep** - Free tier: 250 calls/day, includes transcripts
2. **Alpha Vantage** - Free tier: 25 calls/day
3. **Seeking Alpha RSS** - Earnings call summaries (scrape)
4. **YouTube** - Many companies post earnings calls publicly

**Implementation Strategy**:
- Primary: Financial Modeling Prep API (sign up for free key)
- Fallback: YouTube transcript extraction for public calls
- Cache transcripts locally (they don't change)

---

## Source: `executive-media.ts`

**Purpose**: Fetch YouTube transcripts from executive interviews on CNBC/Bloomberg.

```typescript
interface ExecutiveInterview {
  videoId: string;
  title: string;
  channel: string;          // CNBC, Bloomberg, company channel
  publishedAt: string;
  executive: string;        // CEO, CFO name
  company: string;
  ticker: string;
  transcript: string;
  wordFrequency: Map<string, number>;
}

interface ExecutiveMediaData {
  interviews: ExecutiveInterview[];
  fetchedAt: string;
}
```

**Discovery Strategy**:
1. Monitor channels: CNBC, Bloomberg Markets, company IR channels
2. Search: `{CEO name} {company} interview {year}`
3. YouTube Data API (free tier: 10,000 units/day)
4. youtube-transcript-api for transcript extraction

---

## Detector: `mentions-edge.ts`

**Purpose**: Compare historical keyword frequency to Kalshi market prices.

### Algorithm

```typescript
async function detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
  const mentionsData = data['kalshi-mentions'] as MentionsMarketsData;
  const transcripts = data['earnings-transcripts'] as TranscriptsData;
  const media = data['executive-media'] as ExecutiveMediaData;

  const edges: Edge[] = [];

  for (const market of mentionsData.markets) {
    // Get company's historical transcripts
    const companyTranscripts = transcripts.transcripts
      .filter(t => t.ticker === market.companyTicker);

    // Get recent executive interviews
    const companyMedia = media.interviews
      .filter(i => i.ticker === market.companyTicker);

    for (const keyword of market.keywords) {
      // Calculate historical mention rate
      const historicalRate = calculateMentionRate(
        keyword.keyword,
        companyTranscripts,
        companyMedia
      );

      // Compare to market price
      const edge = historicalRate - keyword.yesPrice;

      if (Math.abs(edge) >= 0.05) {  // 5% minimum edge
        edges.push(createEdge(...));
      }
    }
  }

  return edges;
}
```

### Keyword Frequency Analysis

```typescript
function calculateMentionRate(
  keyword: string,
  transcripts: EarningsTranscript[],
  media: ExecutiveInterview[]
): number {
  // Count mentions in last 4 quarters
  let mentionCount = 0;
  let totalCalls = transcripts.length;

  for (const transcript of transcripts) {
    const text = `${transcript.sections.preparedRemarks} ${transcript.sections.qaSession}`;
    if (containsKeyword(text, keyword)) {
      mentionCount++;
    }
  }

  // Weight recent media appearances
  for (const interview of media) {
    if (containsKeyword(interview.transcript, keyword)) {
      mentionCount += 0.5;  // Partial weight for interviews
      totalCalls += 0.5;
    }
  }

  // Historical rate = P(keyword mentioned)
  return totalCalls > 0 ? mentionCount / totalCalls : 0.5;
}

function containsKeyword(text: string, keyword: string): boolean {
  // Exact match or close variants
  const variants = generateVariants(keyword);
  const textLower = text.toLowerCase();
  return variants.some(v => textLower.includes(v.toLowerCase()));
}

function generateVariants(keyword: string): string[] {
  // "tariffs" → ["tariff", "tariffs", "tariffed"]
  // "AI" → ["AI", "artificial intelligence", "A.I."]
  // Handle plurals, tenses, common expansions
  return [keyword, ...getCommonVariants(keyword)];
}
```

### Edge Signals

```typescript
interface MentionsEdgeSignal extends EdgeSignal {
  type: 'mentions';
  keyword: string;
  historicalRate: number;        // How often mentioned historically
  marketPrice: number;           // Current YES price
  transcriptsAnalyzed: number;   // How many transcripts reviewed
  recentTrend: 'increasing' | 'stable' | 'decreasing';
  analystInterest: number;       // How often analysts ask about it
  confidence: number;
}
```

---

## Analyst Question Analysis

**Insight**: If analysts frequently ask about a topic in Q&A, executives are more likely to address it.

```typescript
function analyzeAnalystQuestions(
  transcripts: EarningsTranscript[],
  keyword: string
): { frequency: number; recentTrend: string } {
  // Count how often analysts mention the keyword in questions
  let questionMentions = 0;
  let totalQuestions = 0;

  for (const transcript of transcripts) {
    const questions = extractAnalystQuestions(transcript.sections.qaSession);
    totalQuestions += questions.length;

    for (const q of questions) {
      if (containsKeyword(q, keyword)) {
        questionMentions++;
      }
    }
  }

  return {
    frequency: totalQuestions > 0 ? questionMentions / totalQuestions : 0,
    recentTrend: calculateTrend(transcripts, keyword)
  };
}
```

---

## Confidence Scoring

```typescript
function calculateConfidence(signal: MentionsEdgeSignal): number {
  let confidence = 0.5;

  // More transcripts = higher confidence
  if (signal.transcriptsAnalyzed >= 4) confidence += 0.15;
  else if (signal.transcriptsAnalyzed >= 2) confidence += 0.08;

  // Recent trend matters
  if (signal.recentTrend === 'increasing') confidence += 0.10;

  // Analyst interest is strong signal
  if (signal.analystInterest > 0.3) confidence += 0.10;

  // Large historical rate deviation from 50%
  const deviation = Math.abs(signal.historicalRate - 0.5);
  confidence += deviation * 0.3;

  return Math.min(0.9, confidence);
}
```

---

## Free API Recommendations

### For Earnings Transcripts

| API | Free Tier | Notes |
|-----|-----------|-------|
| **Financial Modeling Prep** | 250/day | Best free option, includes Q&A |
| Alpha Vantage | 25/day | Limited transcript data |
| Polygon.io | 5/min | Requires premium for transcripts |

**Sign up**: https://financialmodelingprep.com/developer/docs/

### For YouTube Transcripts

| API | Free Tier | Notes |
|-----|-----------|-------|
| YouTube Data API | 10,000 units/day | Search + video metadata |
| youtube-transcript-api | Unlimited | Python library, no API key |

---

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | `kalshi-mentions.ts` source | ✅ Complete |
| **Phase 2** | `earnings-transcripts.ts` source | ✅ Complete |
| **Phase 3** | `executive-media.ts` source | ✅ Complete |
| **Phase 4** | `mentions-edge.ts` detector | ✅ Complete |

### Implementation Details

**Phase 1 - Kalshi Mentions Source**
- Fetches mentions markets via Kalshi API
- Parses keyword options from market titles
- Groups by company/series ticker
- 5-minute cache TTL

**Phase 2 - Earnings Transcripts Source**
- Primary: Financial Modeling Prep API (requires `FMP_API_KEY`)
- Fallback: Yahoo Finance (limited data)
- 4 quarters of historical transcripts
- Parses prepared remarks vs Q&A sections
- 24-hour cache TTL (transcripts don't change)

**Phase 3 - Executive Media Source**
- YouTube RSS feeds for CNBC, Bloomberg, Yahoo Finance, etc.
- Optional YouTube Data API for search (requires `YOUTUBE_API_KEY`)
- Filters for relevance based on executives and companies
- 1-hour cache TTL

**Phase 4 - Mentions Edge Detector**
- Calculates historical mention rate (60% weight)
- Analyzes trend direction (15% weight)
- Measures analyst interest in Q&A (10% weight)
- Tracks recent media mentions (15% weight)
- Outputs EdgeOpportunity with 'earnings' source type

---

## File Structure

```
src/
├── sources/
│   ├── kalshi-mentions.ts      # Kalshi mentions markets
│   ├── earnings-transcripts.ts # Earnings call transcripts
│   └── executive-media.ts      # YouTube/CNBC transcripts
├── detectors/
│   └── mentions-edge.ts        # Keyword frequency edge
└── data/
    └── transcript-cache/       # Cached transcripts (git-ignored)
```

---

## Example Edge Alert

```
🎯 MENTIONS EDGE • +12% • HIGH CONVICTION

📊 **Constellation Brands (STZ) - Q2 Earnings**

Keyword: "tariffs"
Market Price: 35¢ YES
Historical Rate: 47% (mentioned 3 of last 4 calls)
Edge: +12%

📈 **Why This Edge Exists**
• Mentioned "tariffs" in 3 of last 4 earnings calls
• CFO discussed tariff impact on CNBC 2 weeks ago
• Analysts asked about tariffs in 60% of recent Q&As
• Beer import costs remain elevated topic

💡 **Recommendation**: BUY YES @ 35¢

[>>> TRADE ON KALSHI <<<]
```
