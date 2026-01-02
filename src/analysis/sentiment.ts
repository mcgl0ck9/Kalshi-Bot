/**
 * Sentiment Analysis Module
 *
 * Analyzes news and social media sentiment for tracked topics.
 * Uses the 'sentiment' npm package with domain-specific enhancements.
 */

import Sentiment from 'sentiment';
import type { NewsArticle, TopicSentiment, SentimentEdge, Market, MarketCategory } from '../types/index.js';
import { logger } from '../utils/index.js';
import { TRACKED_TOPICS, MIN_EDGE_THRESHOLD } from '../config.js';

const analyzer = new Sentiment();

// =============================================================================
// CUSTOM LEXICON - Domain-specific sentiment words
// =============================================================================

const CUSTOM_LEXICON: Record<string, number> = {
  // Bullish/positive market terms
  surges: 3,
  surge: 2,
  soars: 3,
  rallies: 2,
  rally: 2,
  bullish: 3,
  breakout: 2,
  moon: 2,
  mooning: 3,
  skyrockets: 3,
  jumps: 2,
  gains: 2,
  winning: 2,
  wins: 1,
  leads: 1,
  leading: 1,
  outperforms: 2,
  beats: 1,
  exceeds: 1,
  highs: 2,
  inflows: 2,
  adoption: 1,
  approval: 2,
  approved: 2,
  passes: 1,
  passed: 1,
  victory: 2,

  // Bearish/negative market terms
  crashes: -3,
  crash: -3,
  plunges: -3,
  plummets: -3,
  tanks: -2,
  dumps: -2,
  dump: -2,
  bearish: -3,
  selloff: -2,
  rekt: -3,
  collapses: -3,
  tumbles: -2,
  slides: -2,
  drops: -2,
  falls: -1,
  declines: -1,
  loses: -1,
  losing: -2,
  outflows: -2,
  rejected: -2,
  rejects: -2,
  fails: -2,
  failed: -2,
  defeat: -2,
  defeated: -2,
  indicted: -2,
  indictment: -2,
  impeached: -2,
  recession: -3,
  layoffs: -2,
  bankruptcy: -3,
  defaults: -2,

  // Economic policy
  dovish: 2,
  easing: 1,
  stimulus: 2,
  hawkish: -1,
  tightening: -1,

  // ==========================================================================
  // SPORTS SENTIMENT - Positive/Bullish for team/player
  // ==========================================================================
  dominant: 3,
  dominates: 3,
  dominating: 3,
  blowout: 2,
  rout: 2,
  routed: 2,
  crushing: 2,
  cruising: 2,
  clinch: 2,
  clinches: 2,
  clinched: 2,
  sweep: 2,
  sweeps: 2,
  undefeated: 3,
  unstoppable: 3,
  outscored: 1,
  outplayed: 1,
  shutout: 2,
  comeback: 2,
  rallied: 2,
  surged: 2,
  favorite: 1,
  favorites: 1,
  favored: 1,
  contender: 1,
  contenders: 1,
  mvp: 2,
  allstar: 1,
  champion: 2,
  champions: 2,
  championship: 1,
  clutch: 2,
  heroic: 2,
  heroics: 2,
  historic: 2,
  recordbreaking: 3,
  healthy: 1,
  cleared: 1,
  activated: 1,
  returning: 1,
  returns: 1,

  // SPORTS SENTIMENT - Negative/Bearish for team/player
  upset: -2,
  upsets: -2,
  stunned: -2,
  shocked: -2,
  collapse: -3,
  collapsed: -3,
  choke: -3,
  choked: -3,
  choking: -3,
  blew: -2,
  squandered: -2,
  underdog: -1,
  underdogs: -1,
  longshot: -1,
  eliminated: -2,
  elimination: -2,
  swept: -2,
  demolished: -3,
  destroyed: -3,
  embarrassed: -2,
  embarrassing: -2,
  slump: -2,
  slumping: -2,
  struggling: -2,
  struggles: -2,

  // SPORTS INJURIES - Strong negative signal
  injured: -3,
  injury: -3,
  injuries: -3,
  sidelined: -3,
  questionable: -2,
  doubtful: -3,
  probable: -1,
  ruled_out: -4,
  out_for_season: -4,
  torn: -4,
  sprained: -2,
  strained: -2,
  concussion: -3,
  fractured: -3,
  surgery: -3,
  rehab: -2,
  il: -2,          // MLB injured list
  ir: -3,          // NFL injured reserve
  dnp: -2,         // Did not practice
  limited: -1,

  // SPORTS TRADES/ROSTER
  traded: 0,       // Neutral - depends on context
  acquired: 1,
  signed: 1,
  signing: 1,
  extension: 1,
  released: -1,
  waived: -1,
  benched: -2,
  demoted: -2,
  suspended: -3,
  suspension: -3,

  // Neutral
  volatility: 0,
  uncertainty: -1,
};

// Register custom words
analyzer.registerLanguage('en', {
  labels: CUSTOM_LEXICON,
});

// =============================================================================
// SENTIMENT ANALYSIS
// =============================================================================

/**
 * Analyze sentiment of a single text
 */
export function analyzeTextSentiment(text: string): {
  score: number;
  comparative: number;
  positive: string[];
  negative: string[];
} {
  if (!text) {
    return { score: 0, comparative: 0, positive: [], negative: [] };
  }

  // Pre-process for domain-specific phrases
  let processedText = text.toLowerCase();

  const phraseReplacements: Record<string, string> = {
    // Economic phrases
    'rate cut': 'excellent bullish rally',
    'rate cuts': 'excellent bullish rally',
    'rate hike': 'terrible bearish decline',
    'rate hikes': 'terrible bearish decline',
    'all-time high': 'amazing fantastic surge',
    'all time high': 'amazing fantastic surge',
    'record high': 'amazing surge',
    'new high': 'great bullish',
    'new highs': 'great bullish',

    // Sports injury phrases (strong negative)
    'ruled out': 'devastating injured sidelined',
    'out for season': 'devastating destroyed sidelined season-ending',
    'out for the season': 'devastating destroyed sidelined season-ending',
    'out indefinitely': 'devastating injured uncertain sidelined',
    'day-to-day': 'minor questionable',
    'game-time decision': 'uncertain questionable',
    'torn acl': 'devastating season-ending destroyed',
    'torn achilles': 'devastating season-ending destroyed',
    'placed on il': 'injured sidelined negative',
    'placed on ir': 'injured sidelined devastating',

    // Sports positive phrases
    'clinched playoff': 'dominant winning clinched victory',
    'playoff bound': 'winning strong contender',
    'super bowl bound': 'dominant champion winning',
    'finals bound': 'dominant champion winning',
    'win streak': 'dominant winning hot',
    'winning streak': 'dominant winning unstoppable',
    'on fire': 'dominant unstoppable winning',
    'red hot': 'dominant winning unstoppable',
    'world series champion': 'champion dominant winning',
    'stanley cup champion': 'champion dominant winning',
    'super bowl champion': 'champion dominant winning',
    'nba champion': 'champion dominant winning',

    // Sports negative phrases
    'losing streak': 'struggling slumping losing defeated',
    'eliminated from': 'eliminated defeated loss',
    'missed playoffs': 'disappointed loss eliminated',
    'blown lead': 'collapse choke devastating',
    'upset loss': 'upset stunned losing defeated',
    'shocking loss': 'shocked upset devastating loss',
    'heavy underdog': 'underdog longshot unlikely',
  };

  for (const [phrase, replacement] of Object.entries(phraseReplacements)) {
    processedText = processedText.replace(new RegExp(phrase, 'gi'), replacement);
  }

  const result = analyzer.analyze(processedText);

  return {
    score: result.score,
    comparative: result.comparative,
    positive: result.positive,
    negative: result.negative,
  };
}

/**
 * Get sentiment label from comparative score
 * Lowered threshold from ±0.1 to ±0.05 for better sports signal detection
 */
function getSentimentLabel(comparative: number): 'bullish' | 'bearish' | 'neutral' {
  if (comparative >= 0.05) return 'bullish';
  if (comparative <= -0.05) return 'bearish';
  return 'neutral';
}

/**
 * Analyze sentiment of a news article
 */
export function analyzeArticleSentiment(article: NewsArticle): NewsArticle {
  const title = article.title ?? '';
  const description = article.description ?? '';
  const content = (article.content ?? '').slice(0, 500);

  // Combine text, weighting title more heavily
  const combinedText = `${title} ${title} ${description} ${content}`;

  const result = analyzeTextSentiment(combinedText);

  return {
    ...article,
    sentiment: result.comparative,
    sentimentLabel: getSentimentLabel(result.comparative),
  };
}

// =============================================================================
// TOPIC MATCHING
// =============================================================================

/**
 * Match an article to tracked topics based on keywords
 */
export function matchArticleToTopics(
  article: NewsArticle,
  topics: Record<string, { keywords: string[]; category: MarketCategory }> = TRACKED_TOPICS
): string[] {
  const title = (article.title ?? '').toLowerCase();
  const description = (article.description ?? '').toLowerCase();
  const text = `${title} ${description}`;

  const matches: string[] = [];

  for (const [topicName, topicInfo] of Object.entries(topics)) {
    for (const keyword of topicInfo.keywords) {
      const kwLower = keyword.toLowerCase();

      // For multi-word keywords, check substring
      if (kwLower.includes(' ')) {
        if (text.includes(kwLower)) {
          matches.push(topicName);
          break;
        }
      } else {
        // For single words, check word boundary
        const regex = new RegExp(`\\b${kwLower}\\b`);
        if (regex.test(text)) {
          matches.push(topicName);
          break;
        }
      }
    }
  }

  return matches;
}

// =============================================================================
// TOPIC SENTIMENT AGGREGATION
// =============================================================================

/**
 * Analyze sentiment for each tracked topic
 */
export function analyzeSentimentForTopics(
  articles: NewsArticle[],
  topics: Record<string, { keywords: string[]; category: MarketCategory }> = TRACKED_TOPICS
): Map<string, TopicSentiment> {
  // Initialize tracking for each topic
  const topicData = new Map<string, {
    articles: NewsArticle[];
    scores: number[];
    category: MarketCategory;
  }>();

  for (const [topicName, topicInfo] of Object.entries(topics)) {
    topicData.set(topicName, {
      articles: [],
      scores: [],
      category: topicInfo.category,
    });
  }

  // Analyze each article and assign to topics
  for (const article of articles) {
    const analyzed = analyzeArticleSentiment(article);
    const matchedTopics = matchArticleToTopics(article, topics);

    for (const topic of matchedTopics) {
      const data = topicData.get(topic);
      if (data && analyzed.sentiment !== undefined) {
        data.articles.push(analyzed);
        data.scores.push(analyzed.sentiment);
      }
    }
  }

  // Calculate summary stats
  const results = new Map<string, TopicSentiment>();

  for (const [topicName, data] of topicData) {
    if (data.scores.length === 0) continue;

    const avgSentiment = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;

    results.set(topicName, {
      topic: topicName,
      category: data.category,
      articleCount: data.articles.length,
      avgSentiment,
      sentimentLabel: getSentimentLabel(avgSentiment),
      minSentiment: Math.min(...data.scores),
      maxSentiment: Math.max(...data.scores),
      topArticles: data.articles
        .sort((a, b) => Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0))
        .slice(0, 3),
    });
  }

  logger.info(`Analyzed sentiment for ${results.size} topics`);
  return results;
}

// =============================================================================
// SENTIMENT EDGE DETECTION
// =============================================================================

/**
 * Check if a market title looks like a parlay/combo (multiple outcomes)
 */
function isParlayMarket(title: string): boolean {
  if (!title) return true;

  // Parlay patterns: "yes Team1,no Team2" or multiple outcomes
  const yesNoCount = (title.match(/\b(yes|no)\s/gi) || []).length;
  if (yesNoCount > 1) return true;

  // Multiple comma-separated items (3+ parts)
  const commaItems = title.split(',').length;
  if (commaItems > 2) return true;

  // Contains player stats patterns like "Player: 10+"
  const playerStatMatches = (title.match(/\w+:\s*\d+\+/g) || []).length;
  if (playerStatMatches > 1) return true;

  return false;
}

/**
 * Find opportunities where sentiment diverges from market price
 */
export function findSentimentEdges(
  topicSentiment: Map<string, TopicSentiment>,
  markets: Market[],
  minEdge: number = MIN_EDGE_THRESHOLD
): SentimentEdge[] {
  const opportunities: SentimentEdge[] = [];

  for (const market of markets) {
    const marketTitle = (market.title ?? '').toLowerCase();
    const marketPrice = market.price ?? 0;

    if (!marketPrice || marketPrice <= 0) continue;

    // Skip parlay/combo markets - they're too complex for sentiment analysis
    if (isParlayMarket(market.title ?? '')) continue;

    // Try to match market to a topic
    let matchedTopic: string | null = null;

    for (const [topicName] of topicSentiment) {
      const topicConfig = TRACKED_TOPICS[topicName];
      if (!topicConfig) continue;

      if (topicConfig.keywords.some(kw => marketTitle.includes(kw.toLowerCase()))) {
        matchedTopic = topicName;
        break;
      }
    }

    if (!matchedTopic) continue;

    const topicData = topicSentiment.get(matchedTopic);
    if (!topicData || topicData.articleCount < 2) continue;

    // Convert sentiment to implied probability
    // Sentiment ranges from roughly -1 to 1, map to 0.2 to 0.8
    const impliedProb = Math.max(0.1, Math.min(0.9, 0.5 + topicData.avgSentiment * 0.3));

    // Calculate edge
    const edge = impliedProb - marketPrice;

    if (Math.abs(edge) >= minEdge) {
      const direction: 'BUY YES' | 'BUY NO' = edge > 0 ? 'BUY YES' : 'BUY NO';

      // Confidence based on article count and sentiment strength
      const confidence = Math.min(
        0.95,
        0.5 + topicData.articleCount * 0.02 + Math.abs(topicData.avgSentiment) * 0.2
      );

      // Determine urgency
      let urgency: 'critical' | 'standard' | 'fyi';
      if (Math.abs(edge) >= 0.2 && confidence >= 0.75) {
        urgency = 'critical';
      } else if (Math.abs(edge) >= 0.12 || confidence >= 0.7) {
        urgency = 'standard';
      } else {
        urgency = 'fyi';
      }

      opportunities.push({
        market,
        topic: matchedTopic,
        category: topicData.category,
        marketPrice,
        impliedPrice: impliedProb,
        edge,
        direction,
        sentiment: topicData.avgSentiment,
        sentimentLabel: topicData.sentimentLabel,
        articleCount: topicData.articleCount,
        confidence,
        urgency,
        topArticles: topicData.topArticles,
      });
    }
  }

  // Sort by edge magnitude
  opportunities.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  logger.info(`Found ${opportunities.length} sentiment-based opportunities`);
  return opportunities;
}
