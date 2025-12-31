/**
 * News Fetcher Module
 *
 * Fetches news from multiple sources:
 * - RSS feeds (Reuters, AP, Bloomberg, etc.)
 * - NewsAPI (if API key provided)
 */

import Parser from 'rss-parser';
import type { NewsArticle } from '../types/index.js';
import { logger, delay, dedupeByKey } from '../utils/index.js';
import { RSS_FEEDS, NEWS_API_KEY } from '../config.js';

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: ['content:encoded', 'description'],
  },
});

// =============================================================================
// RSS FETCHING
// =============================================================================

/**
 * Fetch and parse a single RSS feed
 */
async function fetchRssFeed(
  url: string,
  sourceName: string,
  maxAgeHours: number = 24
): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];
  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  try {
    const feed = await parser.parseURL(url);

    for (const item of (feed.items ?? []).slice(0, 50)) {
      // Parse publication date
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;

      // Skip old articles
      if (pubDate && pubDate < cutoffTime) continue;

      articles.push({
        source: sourceName,
        title: item.title ?? '',
        description: item.contentSnippet ?? item.description ?? '',
        content: item['content:encoded'] ?? item.content ?? '',
        url: item.link ?? '',
        published: pubDate?.toISOString() ?? '',
      });
    }
  } catch (error) {
    logger.debug(`Error fetching ${sourceName}: ${error}`);
  }

  return articles;
}

/**
 * Fetch news from all RSS feeds
 */
export async function fetchAllRssFeeds(maxAgeHours: number = 24): Promise<NewsArticle[]> {
  const allArticles: NewsArticle[] = [];
  const feedEntries = Object.entries(RSS_FEEDS);

  // Fetch in batches to avoid overwhelming
  const batchSize = 10;

  for (let i = 0; i < feedEntries.length; i += batchSize) {
    const batch = feedEntries.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(([name, url]) => fetchRssFeed(url, name, maxAgeHours))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
    }

    // Small delay between batches
    if (i + batchSize < feedEntries.length) {
      await delay(100);
    }
  }

  // Deduplicate by title
  const unique = dedupeByKey(allArticles, a => a.title.toLowerCase().slice(0, 50));

  logger.info(`Fetched ${unique.length} unique articles from RSS feeds`);
  return unique;
}

// =============================================================================
// NEWSAPI
// =============================================================================

const NEWSAPI_URL = 'https://newsapi.org/v2/everything';
const NEWSAPI_TOP_URL = 'https://newsapi.org/v2/top-headlines';

/**
 * Fetch news from NewsAPI
 */
export async function fetchNewsApi(
  query?: string,
  category?: string,
  pageSize: number = 100
): Promise<NewsArticle[]> {
  if (!NEWS_API_KEY) {
    logger.debug('NewsAPI key not configured');
    return [];
  }

  try {
    const params = new URLSearchParams();
    params.set('apiKey', NEWS_API_KEY);
    params.set('pageSize', String(pageSize));

    let url: string;
    if (category) {
      url = NEWSAPI_TOP_URL;
      params.set('category', category);
      params.set('country', 'us');
    } else {
      url = NEWSAPI_URL;
      params.set('q', query ?? 'market OR economy OR politics');
      params.set('language', 'en');
      params.set('sortBy', 'publishedAt');
    }

    const response = await fetch(`${url}?${params}`);

    if (!response.ok) {
      logger.warn(`NewsAPI error: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      articles?: Array<{
        source?: { name?: string };
        title?: string;
        description?: string;
        url?: string;
        publishedAt?: string;
        content?: string;
      }>;
    };

    const articles: NewsArticle[] = (data.articles ?? []).map(article => ({
      source: article.source?.name ?? 'NewsAPI',
      title: article.title ?? '',
      description: article.description ?? '',
      url: article.url ?? '',
      published: article.publishedAt ?? '',
      content: article.content ?? '',
    }));

    logger.info(`Fetched ${articles.length} articles from NewsAPI`);
    return articles;
  } catch (error) {
    logger.error(`NewsAPI fetch error: ${error}`);
    return [];
  }
}

// =============================================================================
// COMBINED FETCH
// =============================================================================

/**
 * Fetch news from all sources
 */
export async function fetchAllNews(includeNewsApi: boolean = true): Promise<NewsArticle[]> {
  const results = await Promise.allSettled([
    fetchAllRssFeeds(),
    includeNewsApi && NEWS_API_KEY ? fetchNewsApi() : Promise.resolve([]),
  ]);

  const allArticles: NewsArticle[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allArticles.push(...result.value);
    }
  }

  // Deduplicate
  const unique = dedupeByKey(allArticles, a => a.title.toLowerCase().slice(0, 50));

  logger.info(`Total unique news articles: ${unique.length}`);
  return unique;
}
