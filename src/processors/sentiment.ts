/**
 * Sentiment Analysis Processor
 *
 * Analyzes text data from news sources and adds sentiment scores.
 * Demonstrates the Processor pattern in the v4.0 architecture.
 *
 * Processors transform/enrich data between sources and detectors.
 */

import { defineProcessor, type AnalyzedText, type KeywordMatch } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

interface NewsItem {
  title: string;
  description?: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface SentimentResult {
  items: Array<NewsItem & { sentiment: AnalyzedText }>;
  aggregateSentiment: number;
  keywordMatches: KeywordMatch[];
  lastUpdated: string;
}

// =============================================================================
// SENTIMENT LEXICON
// =============================================================================

const POSITIVE_WORDS = new Set([
  'bullish', 'surge', 'soar', 'rally', 'gain', 'rise', 'jump', 'boost',
  'strong', 'growth', 'profit', 'success', 'win', 'beat', 'exceed',
  'optimistic', 'confident', 'recover', 'improve', 'breakthrough',
]);

const NEGATIVE_WORDS = new Set([
  'bearish', 'crash', 'plunge', 'drop', 'fall', 'decline', 'loss',
  'weak', 'concern', 'fear', 'risk', 'warning', 'fail', 'miss',
  'pessimistic', 'uncertain', 'recession', 'crisis', 'trouble',
]);

const MARKET_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
  'fed', 'interest rate', 'inflation', 'gdp', 'jobs',
  'trump', 'biden', 'election', 'congress',
  'nfl', 'nba', 'super bowl', 'playoffs',
];

// =============================================================================
// PROCESSOR DEFINITION
// =============================================================================

export default defineProcessor<unknown, SentimentResult>({
  name: 'sentiment',
  description: 'Analyzes news sentiment and extracts market-relevant keywords',
  inputSources: ['news'],  // Depends on news source
  outputKey: 'sentiment',

  async process(inputs: Record<string, unknown>): Promise<SentimentResult> {
    const newsItems = (inputs['news'] as NewsItem[] | undefined) ?? [];
    const analyzedItems: Array<NewsItem & { sentiment: AnalyzedText }> = [];
    const allKeywords: KeywordMatch[] = [];
    let totalSentiment = 0;

    for (const item of newsItems) {
      const text = `${item.title} ${item.description ?? ''}`;
      const sentiment = analyzeText(text, item.source);

      analyzedItems.push({ ...item, sentiment });
      totalSentiment += sentiment.sentiment;

      // Aggregate keyword matches
      for (const kw of sentiment.keywords) {
        const existing = allKeywords.find(k => k.keyword === kw.keyword);
        if (existing) {
          existing.count += kw.count;
          existing.context.push(...kw.context);
        } else {
          allKeywords.push({ ...kw });
        }
      }
    }

    const avgSentiment = newsItems.length > 0 ? totalSentiment / newsItems.length : 0;

    logger.info(`Processed ${newsItems.length} news items, avg sentiment: ${avgSentiment.toFixed(2)}`);

    return {
      items: analyzedItems,
      aggregateSentiment: avgSentiment,
      keywordMatches: allKeywords.sort((a, b) => b.count - a.count),
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function analyzeText(text: string, source: string): AnalyzedText {
  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positiveCount++;
    if (NEGATIVE_WORDS.has(word)) negativeCount++;
  }

  // Normalize to -1 to 1
  const total = positiveCount + negativeCount;
  const sentiment = total > 0
    ? (positiveCount - negativeCount) / total
    : 0;

  // Extract keyword matches
  const keywords: KeywordMatch[] = [];
  for (const keyword of MARKET_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      keywords.push({
        keyword,
        count: matches.length,
        context: [text.slice(0, 200)],
        sentiment,
      });
    }
  }

  return {
    source,
    rawText: text,
    sentiment,
    keywords,
    entities: [],  // Could extract entities with NER
    summary: text.slice(0, 100),
  };
}

// =============================================================================
// EXPORTS FOR EDGE DETECTION
// =============================================================================

/**
 * Calculate sentiment divergence from market price.
 * Positive divergence = sentiment bullish but price low.
 */
export function calculateSentimentEdge(
  sentiment: number,
  marketPrice: number
): { edge: number; direction: 'YES' | 'NO' } {
  // Normalize sentiment to 0-1 scale
  const sentimentProb = (sentiment + 1) / 2;

  // Calculate divergence
  const divergence = sentimentProb - marketPrice;

  return {
    edge: Math.abs(divergence),
    direction: divergence > 0 ? 'YES' : 'NO',
  };
}
