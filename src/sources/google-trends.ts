/**
 * Google Trends Source
 *
 * Monitors search interest spikes as leading indicators for prediction markets.
 * When search interest suddenly spikes for a topic, it often precedes:
 * - Breaking news that moves markets
 * - Public attention shifts that change probabilities
 * - Viral events that create trading opportunities
 *
 * Uses Google Trends RSS feed (no API key required).
 * Research shows search trends can lead market moves by 1-24 hours.
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TrendAlert {
  keyword: string;
  type: 'spike' | 'massive' | 'breakout';
  magnitude: number;
  currentInterest: number;
  reasoning: string;
  category: string;
  timestamp: string;
}

export interface TrendCategory {
  name: string;
  keywords: string[];
}

export interface GoogleTrendsData {
  alerts: TrendAlert[];
  trendingNow: string[];
  categorySummary: Record<string, number>;
  fetchedAt: string;
}

// =============================================================================
// MONITORED KEYWORDS BY CATEGORY
// =============================================================================

export const TREND_CATEGORIES: TrendCategory[] = [
  {
    name: 'Politics',
    keywords: [
      'Trump news', 'Biden news', 'Congress vote', 'government shutdown',
      'impeachment', 'election results', 'Supreme Court decision',
    ],
  },
  {
    name: 'Economics',
    keywords: [
      'Fed rate decision', 'inflation news', 'recession', 'jobs report',
      'stock market crash', 'bank failure', 'GDP report',
    ],
  },
  {
    name: 'Crypto',
    keywords: [
      'Bitcoin crash', 'Bitcoin ETF', 'crypto news', 'Ethereum upgrade', 'crypto regulation',
    ],
  },
  {
    name: 'Sports',
    keywords: [
      'NFL injury', 'trade news NBA', 'Super Bowl odds', 'college football playoff',
    ],
  },
  {
    name: 'Entertainment',
    keywords: [
      'box office', 'movie reviews', 'Oscar predictions', 'Grammy nominations',
    ],
  },
  {
    name: 'Weather',
    keywords: ['hurricane', 'blizzard', 'heat wave', 'tornado', 'wildfire'],
  },
  {
    name: 'Health',
    keywords: ['COVID cases', 'flu outbreak', 'measles outbreak', 'CDC warning'],
  },
  {
    name: 'Tech',
    keywords: [
      'AI breakthrough', 'ChatGPT', 'tech layoffs', 'antitrust', 'Apple announcement',
    ],
  },
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<GoogleTrendsData>({
  name: 'google-trends',
  category: 'other',
  cacheTTL: 1800,  // 30 min cache

  async fetch(): Promise<GoogleTrendsData> {
    const alerts: TrendAlert[] = [];
    const categorySummary: Record<string, number> = {};
    let trendingNow: string[] = [];

    // Fetch Google Trends RSS
    const rssContent = await fetchTrendsRSS();
    if (rssContent) {
      trendingNow = extractTrendingTopics(rssContent);
    }

    // Check each category for spikes
    for (const category of TREND_CATEGORIES) {
      const categoryAlerts = await checkCategoryTrends(category, rssContent);
      alerts.push(...categoryAlerts);
      categorySummary[category.name] = categoryAlerts.length;
    }

    if (alerts.length > 0) {
      logger.info(`Google Trends: ${alerts.length} alerts across ${Object.keys(categorySummary).filter(k => categorySummary[k] > 0).length} categories`);
    }

    return {
      alerts,
      trendingNow,
      categorySummary,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// DATA FETCHERS
// =============================================================================

async function fetchTrendsRSS(): Promise<string | null> {
  try {
    const response = await fetch('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KalshiBot/4.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      logger.debug(`Trends RSS fetch failed: ${response.status}`);
      return null;
    }

    return await response.text();
  } catch (error) {
    logger.error(`Trends RSS fetch error: ${error}`);
    return null;
  }
}

function extractTrendingTopics(rssContent: string): string[] {
  const topics: string[] = [];
  const titleMatches = rssContent.matchAll(/<title>([^<]+)<\/title>/g);

  for (const match of titleMatches) {
    const title = match[1].trim();
    if (title && !title.includes('Daily Search Trends') && title.length > 2) {
      topics.push(title);
    }
  }

  return topics.slice(0, 20);
}

async function checkCategoryTrends(
  category: TrendCategory,
  rssContent: string | null
): Promise<TrendAlert[]> {
  const alerts: TrendAlert[] = [];

  if (!rssContent) return alerts;

  const rssLower = rssContent.toLowerCase();

  for (const keyword of category.keywords) {
    const keywordLower = keyword.toLowerCase();
    const isInTrending = rssLower.includes(keywordLower);

    // Count occurrences for interest estimation
    const occurrences = (rssLower.match(new RegExp(keywordLower.replace(/\s+/g, '\\s+'), 'g')) || []).length;

    if (!isInTrending && occurrences === 0) continue;

    // Estimate interest level
    const currentInterest = isInTrending ? Math.min(100, 50 + occurrences * 15) : 20;
    const averageInterest = 25;
    const magnitude = currentInterest / averageInterest;

    // Classify alert type
    let type: 'spike' | 'massive' | 'breakout';
    if (magnitude >= 5) {
      type = 'massive';
    } else if (magnitude >= 2) {
      type = 'spike';
    } else if (isInTrending) {
      type = 'breakout';
    } else {
      continue;
    }

    alerts.push({
      keyword,
      type,
      magnitude,
      currentInterest,
      category: category.name,
      reasoning: `Search interest for "${keyword}" is ${((magnitude - 1) * 100).toFixed(0)}% above normal`,
      timestamp: new Date().toISOString(),
    });
  }

  return alerts;
}

// =============================================================================
// EDGE ANALYSIS HELPERS
// =============================================================================

export interface TrendsEdgeSignal {
  keyword: string;
  type: 'spike' | 'massive' | 'breakout';
  magnitude: number;
  matchedMarkets: string[];
  reasoning: string;
}

export function matchTrendsToMarkets(
  alerts: TrendAlert[],
  activeMarkets: Array<{ ticker: string; title: string; category: string }>
): TrendsEdgeSignal[] {
  return alerts.map(alert => {
    const matchedMarkets = activeMarkets
      .filter(market => {
        const title = market.title.toLowerCase();
        const keyword = alert.keyword.toLowerCase();
        return title.includes(keyword) ||
          keyword.split(' ').some(word => word.length > 3 && title.includes(word));
      })
      .map(m => m.ticker);

    return {
      keyword: alert.keyword,
      type: alert.type,
      magnitude: alert.magnitude,
      matchedMarkets,
      reasoning: matchedMarkets.length > 0
        ? `${alert.reasoning}. May affect: ${matchedMarkets.join(', ')}`
        : alert.reasoning,
    };
  });
}

export function formatTrendAlerts(alerts: TrendAlert[]): string {
  if (alerts.length === 0) {
    return 'No unusual search trends detected.';
  }

  const lines: string[] = ['**Search Trend Alerts**', ''];

  for (const alert of alerts) {
    const emoji = alert.type === 'massive' ? '\u{1F6A8}' : alert.type === 'spike' ? '\u{1F4C8}' : '\u{1F4CA}';
    lines.push(`${emoji} **${alert.keyword}** (${alert.category})`);
    lines.push(`   ${alert.reasoning}`);
    lines.push(`   Magnitude: ${alert.magnitude.toFixed(1)}x normal`);
    lines.push('');
  }

  return lines.join('\n');
}
