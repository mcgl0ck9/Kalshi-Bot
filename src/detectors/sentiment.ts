/**
 * Sentiment Edge Detector
 *
 * Detects edges when news sentiment diverges significantly from market prices.
 * Uses keyword matching to link news articles to specific markets.
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import type { NewsData } from '../sources/news.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.08;
const MIN_ARTICLES = 3;  // Need at least 3 articles to form sentiment
const SENTIMENT_THRESHOLD = 0.15;  // Minimum sentiment magnitude

// Keywords to match markets
const MARKET_KEYWORDS: Record<string, string[]> = {
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency'],
  fed: ['federal reserve', 'fed', 'interest rate', 'powell', 'fomc'],
  inflation: ['inflation', 'cpi', 'consumer price', 'prices'],
  recession: ['recession', 'gdp', 'economic growth', 'downturn'],
  trump: ['trump', 'donald trump'],
  biden: ['biden', 'joe biden'],
  election: ['election', 'vote', 'ballot', 'polling'],
};

// Sentiment lexicon
const POSITIVE = new Set([
  'surge', 'soar', 'rally', 'gain', 'rise', 'jump', 'boost', 'strong',
  'bullish', 'optimistic', 'growth', 'profit', 'success', 'win', 'beat',
  'exceed', 'confident', 'recover', 'improve', 'breakthrough', 'boom',
]);

const NEGATIVE = new Set([
  'crash', 'plunge', 'drop', 'fall', 'decline', 'loss', 'weak', 'bearish',
  'concern', 'fear', 'risk', 'warning', 'fail', 'miss', 'pessimistic',
  'uncertain', 'recession', 'crisis', 'trouble', 'slump', 'collapse',
]);

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'sentiment',
  description: 'Detects sentiment-price divergences using news analysis',
  sources: ['kalshi', 'news'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const newsData = data['news'] as NewsData | undefined;
    if (!newsData?.articles?.length) {
      logger.debug('Sentiment detector: No news data available');
      return edges;
    }

    logger.info(`Sentiment detector: Analyzing ${newsData.articles.length} articles against ${markets.length} markets`);

    // Build sentiment by topic
    const topicSentiment = buildTopicSentiment(newsData.articles);

    // Check each market for sentiment divergence
    for (const market of markets) {
      const edge = analyzeMarketSentiment(market, topicSentiment);
      if (edge) {
        edges.push(edge);
      }
    }

    return edges;
  },
});

// =============================================================================
// SENTIMENT ANALYSIS
// =============================================================================

interface TopicSentiment {
  topic: string;
  sentiment: number;  // -1 to 1
  articleCount: number;
  headlines: string[];
}

function buildTopicSentiment(articles: NewsData['articles']): Map<string, TopicSentiment> {
  const topicMap = new Map<string, TopicSentiment>();

  for (const [topic, keywords] of Object.entries(MARKET_KEYWORDS)) {
    const matchingArticles = articles.filter(a => {
      const text = `${a.title} ${a.description}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });

    if (matchingArticles.length >= MIN_ARTICLES) {
      const sentiments = matchingArticles.map(a => analyzeSentiment(a.title + ' ' + a.description));
      const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;

      topicMap.set(topic, {
        topic,
        sentiment: avgSentiment,
        articleCount: matchingArticles.length,
        headlines: matchingArticles.slice(0, 3).map(a => a.title),
      });
    }
  }

  return topicMap;
}

function analyzeSentiment(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let positive = 0;
  let negative = 0;

  for (const word of words) {
    if (POSITIVE.has(word)) positive++;
    if (NEGATIVE.has(word)) negative++;
  }

  const total = positive + negative;
  if (total === 0) return 0;

  return (positive - negative) / total;
}

function analyzeMarketSentiment(
  market: Market,
  topicSentiment: Map<string, TopicSentiment>
): Edge | null {
  const titleLower = market.title.toLowerCase();

  // Find matching topic
  let matchedTopic: TopicSentiment | null = null;

  for (const [topic, keywords] of Object.entries(MARKET_KEYWORDS)) {
    if (keywords.some(kw => titleLower.includes(kw))) {
      const sentiment = topicSentiment.get(topic);
      if (sentiment && Math.abs(sentiment.sentiment) >= SENTIMENT_THRESHOLD) {
        matchedTopic = sentiment;
        break;
      }
    }
  }

  if (!matchedTopic) return null;

  // Calculate implied price from sentiment
  // Sentiment of 1 = 75% YES, Sentiment of -1 = 25% YES
  const sentimentImpliedPrice = 0.5 + (matchedTopic.sentiment * 0.25);

  // Calculate edge
  const edge = Math.abs(sentimentImpliedPrice - market.price);
  if (edge < MIN_EDGE) return null;

  // Determine direction
  const direction = sentimentImpliedPrice > market.price ? 'YES' : 'NO';

  // Calculate confidence based on article count
  const confidence = Math.min(0.80, 0.50 + (matchedTopic.articleCount * 0.05));

  const reason = buildReason(matchedTopic, sentimentImpliedPrice, market.price, direction);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'sentiment',
      topic: matchedTopic.topic,
      sentiment: matchedTopic.sentiment,
      articleCount: matchedTopic.articleCount,
      headlines: matchedTopic.headlines,
      sentimentImpliedPrice,
    }
  );
}

function buildReason(
  topic: TopicSentiment,
  implied: number,
  market: number,
  direction: 'YES' | 'NO'
): string {
  const sentimentDesc = topic.sentiment > 0.3 ? 'strongly bullish' :
                        topic.sentiment > 0 ? 'bullish' :
                        topic.sentiment < -0.3 ? 'strongly bearish' : 'bearish';

  const impliedPct = (implied * 100).toFixed(0);
  const marketPct = (market * 100).toFixed(0);

  return `News sentiment is ${sentimentDesc} on ${topic.topic} (${topic.articleCount} articles). ` +
    `Implies ${impliedPct}% vs market ${marketPct}%. Recent: "${topic.headlines[0]?.slice(0, 50)}..."`;
}
