/**
 * News RSS Data Source
 *
 * Fetches news from multiple RSS feeds for sentiment analysis.
 * No API key required - uses public RSS feeds.
 */

import Parser from 'rss-parser';
import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface NewsArticle {
  source: string;
  title: string;
  description: string;
  url: string;
  published: string;
}

export interface NewsData {
  articles: NewsArticle[];
  lastUpdated: string;
}

// =============================================================================
// RSS FEEDS (Public, No API Key Required)
// =============================================================================

const RSS_FEEDS: Record<string, string> = {
  // Major News
  'Reuters Business': 'https://feeds.reuters.com/reuters/businessNews',
  'Reuters Markets': 'https://feeds.reuters.com/reuters/marketsNews',
  'AP Top News': 'https://rsshub.app/apnews/topics/apf-topnews',
  'BBC Business': 'https://feeds.bbci.co.uk/news/business/rss.xml',

  // Financial
  'CNBC Top': 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'MarketWatch': 'https://feeds.marketwatch.com/marketwatch/topstories',
  'Yahoo Finance': 'https://finance.yahoo.com/news/rssindex',

  // Crypto
  'CoinDesk': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'Cointelegraph': 'https://cointelegraph.com/rss',

  // Politics
  'Politico': 'https://www.politico.com/rss/politicopicks.xml',
  'The Hill': 'https://thehill.com/feed/',

  // Sports
  'ESPN Top': 'https://www.espn.com/espn/rss/news',
  'ESPN NFL': 'https://www.espn.com/espn/rss/nfl/news',
  'ESPN NBA': 'https://www.espn.com/espn/rss/nba/news',
};

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

const parser = new Parser({ timeout: 10000 });

export default defineSource<NewsData>({
  name: 'news',
  category: 'other',
  cacheTTL: 600,  // 10 minute cache

  async fetch(): Promise<NewsData> {
    const articles: NewsArticle[] = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

    const feedEntries = Object.entries(RSS_FEEDS);

    // Fetch in parallel batches
    const batchSize = 5;
    for (let i = 0; i < feedEntries.length; i += batchSize) {
      const batch = feedEntries.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(([name, url]) => fetchFeed(url, name, cutoff))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          articles.push(...result.value);
        }
      }
    }

    // Dedupe by title
    const seen = new Set<string>();
    const unique = articles.filter(a => {
      const key = a.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`Fetched ${unique.length} unique news articles from ${feedEntries.length} feeds`);

    return {
      articles: unique,
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchFeed(
  url: string,
  sourceName: string,
  cutoff: number
): Promise<NewsArticle[]> {
  try {
    const feed = await parser.parseURL(url);
    const articles: NewsArticle[] = [];

    for (const item of (feed.items ?? []).slice(0, 20)) {
      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      if (pubDate < cutoff) continue;

      articles.push({
        source: sourceName,
        title: item.title ?? '',
        description: item.contentSnippet ?? item.description ?? '',
        url: item.link ?? '',
        published: item.pubDate ?? '',
      });
    }

    return articles;
  } catch (error) {
    logger.debug(`RSS fetch error (${sourceName}): ${error}`);
    return [];
  }
}
