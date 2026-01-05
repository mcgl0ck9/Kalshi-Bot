/**
 * Executive Media Source
 *
 * Fetches executive interviews and appearances from YouTube (CNBC, Bloomberg, etc.)
 * for keyword analysis to predict Kalshi mentions markets.
 *
 * Data sources (all free):
 * - YouTube RSS feeds for channel subscriptions
 * - YouTube Data API for search (optional, needs YOUTUBE_API_KEY)
 * - Direct transcript extraction via youtube-transcript package
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';
import Parser from 'rss-parser';

// =============================================================================
// TYPES
// =============================================================================

export interface MediaAppearance {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
  description: string;
  thumbnailUrl: string;
  transcript?: string;
  wordFrequency?: Record<string, number>;
  mentionedCompanies: string[];
  mentionedKeywords: string[];
}

export interface ExecutiveMediaData {
  appearances: MediaAppearance[];
  byCompany: Record<string, MediaAppearance[]>;
  byChannel: Record<string, MediaAppearance[]>;
  fetchedAt: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Financial news YouTube channels (RSS feeds are free, no API key needed)
const YOUTUBE_CHANNELS = [
  { name: 'CNBC Television', channelId: 'UCvJJ_dzjViJCoLf5uKUTwoA' },
  { name: 'Bloomberg Television', channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg' },
  { name: 'Yahoo Finance', channelId: 'UCEAZeUIeJs92IQg3TBi5psg' },
  { name: 'Fox Business', channelId: 'UCsWHEfg_VAAw5-rXoo5VQAw' },
  { name: 'Wall Street Journal', channelId: 'UCK7tFWPUP1M9Y5bzPd_9Qzg' },
  { name: 'Financial Times', channelId: 'UCGkRkXCVBfBku7dZbhZn0Rg' },
  { name: 'Reuters', channelId: 'UChqUTb7kYRX8-EiaN3XFrSQ' },
];

// Companies and executives we track for mentions markets
const TRACKED_EXECUTIVES: Record<string, string[]> = {
  'STZ': ['Bill Newlands', 'Garth Hankinson'],  // Constellation Brands
  'META': ['Mark Zuckerberg', 'Susan Li'],
  'AAPL': ['Tim Cook', 'Luca Maestri'],
  'AMZN': ['Andy Jassy', 'Brian Olsavsky'],
  'GOOGL': ['Sundar Pichai', 'Ruth Porat'],
  'MSFT': ['Satya Nadella', 'Amy Hood'],
  'NVDA': ['Jensen Huang', 'Colette Kress'],
  'TSLA': ['Elon Musk', 'Vaibhav Taneja'],
  'JPM': ['Jamie Dimon', 'Jeremy Barnum'],
  'GS': ['David Solomon', 'Denis Coleman'],
  'DIS': ['Bob Iger', 'Hugh Johnston'],
  'WMT': ['Doug McMillon', 'John David Rainey'],
  'KO': ['James Quincey', 'John Murphy'],
  'BA': ['Dave Calhoun', 'Brian West'],
};

// Keywords we track for mentions markets
const MEDIA_KEYWORDS = [
  'tariff', 'tariffs', 'trade war',
  'ai', 'artificial intelligence', 'machine learning', 'gpt', 'llm',
  'recession', 'downturn', 'economic slowdown',
  'inflation', 'price increases', 'pricing',
  'layoffs', 'restructuring', 'cost cutting', 'job cuts',
  'china', 'supply chain', 'asia',
  'guidance', 'outlook', 'forecast',
  'dividend', 'buyback', 'shareholders',
  'regulation', 'regulatory', 'antitrust',
  'growth', 'expansion', 'market share',
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<ExecutiveMediaData>({
  name: 'executive-media',
  category: 'other',
  cacheTTL: 3600,  // 1 hour - new videos appear frequently

  async fetch(): Promise<ExecutiveMediaData> {
    const appearances: MediaAppearance[] = [];
    const byCompany: Record<string, MediaAppearance[]> = {};
    const byChannel: Record<string, MediaAppearance[]> = {};

    // Fetch from YouTube RSS feeds (free, no API key)
    for (const channel of YOUTUBE_CHANNELS) {
      const channelAppearances = await fetchChannelFeed(channel.name, channel.channelId);

      for (const appearance of channelAppearances) {
        appearances.push(appearance);

        // Index by channel
        if (!byChannel[channel.name]) {
          byChannel[channel.name] = [];
        }
        byChannel[channel.name].push(appearance);

        // Index by company
        for (const company of appearance.mentionedCompanies) {
          if (!byCompany[company]) {
            byCompany[company] = [];
          }
          byCompany[company].push(appearance);
        }
      }
    }

    // Optional: Use YouTube Data API for search if available
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      const searchResults = await searchForExecutives(apiKey);
      appearances.push(...searchResults);

      for (const appearance of searchResults) {
        for (const company of appearance.mentionedCompanies) {
          if (!byCompany[company]) {
            byCompany[company] = [];
          }
          byCompany[company].push(appearance);
        }
      }
    }

    logger.info(`Fetched ${appearances.length} executive media appearances from ${Object.keys(byChannel).length} channels`);

    return {
      appearances,
      byCompany,
      byChannel,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// RSS FEED FETCHER
// =============================================================================

const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'mediaGroup'],
      ['media:thumbnail', 'thumbnail'],
    ],
  },
});

async function fetchChannelFeed(
  channelName: string,
  channelId: string
): Promise<MediaAppearance[]> {
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feed = await parser.parseURL(feedUrl);

    const appearances: MediaAppearance[] = [];

    for (const item of feed.items.slice(0, 20)) {  // Last 20 videos
      // Extract video ID from link
      const videoId = extractVideoId(item.link || '');
      if (!videoId) continue;

      const title = item.title || '';
      const description = item.contentSnippet || item.content || '';

      // Check if this is relevant (mentions executives or companies)
      const relevance = checkRelevance(title, description);
      if (!relevance.isRelevant) continue;

      // Extract thumbnail
      const thumbnailUrl = extractThumbnail(item);

      appearances.push({
        videoId,
        title,
        channel: channelName,
        publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
        description,
        thumbnailUrl,
        mentionedCompanies: relevance.companies,
        mentionedKeywords: relevance.keywords,
      });
    }

    return appearances;

  } catch (error) {
    logger.debug(`RSS fetch error for ${channelName}: ${error}`);
    return [];
  }
}

function extractVideoId(link: string): string | null {
  // Pattern: https://www.youtube.com/watch?v=VIDEO_ID
  const match = link.match(/[?&]v=([^&]+)/);
  if (match) return match[1];

  // Pattern: https://youtu.be/VIDEO_ID
  const shortMatch = link.match(/youtu\.be\/([^?]+)/);
  if (shortMatch) return shortMatch[1];

  return null;
}

function extractThumbnail(item: Parser.Item & { thumbnail?: { $?: { url?: string } } }): string {
  // Try media:thumbnail
  if (item.thumbnail?.$?.url) {
    return item.thumbnail.$.url;
  }

  // Extract from enclosure
  if (item.enclosure?.url) {
    return item.enclosure.url;
  }

  // Default YouTube thumbnail
  const videoId = extractVideoId(item.link || '');
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  return '';
}

// =============================================================================
// RELEVANCE CHECKING
// =============================================================================

interface RelevanceResult {
  isRelevant: boolean;
  companies: string[];
  keywords: string[];
}

function checkRelevance(title: string, description: string): RelevanceResult {
  const combined = `${title} ${description}`.toLowerCase();
  const companies: string[] = [];
  const keywords: string[] = [];

  // Check for executives
  for (const [ticker, executives] of Object.entries(TRACKED_EXECUTIVES)) {
    for (const exec of executives) {
      if (combined.includes(exec.toLowerCase())) {
        if (!companies.includes(ticker)) {
          companies.push(ticker);
        }
      }
    }
  }

  // Check for company names in title (more likely to be relevant)
  const companyPatterns: Record<string, string[]> = {
    'STZ': ['constellation brands', 'constellation'],
    'META': ['meta', 'facebook', 'zuckerberg'],
    'AAPL': ['apple', 'tim cook'],
    'AMZN': ['amazon', 'andy jassy'],
    'GOOGL': ['google', 'alphabet', 'sundar pichai'],
    'MSFT': ['microsoft', 'satya nadella'],
    'NVDA': ['nvidia', 'jensen huang'],
    'TSLA': ['tesla', 'elon musk'],
    'JPM': ['jpmorgan', 'jp morgan', 'jamie dimon'],
    'GS': ['goldman sachs', 'goldman', 'david solomon'],
    'DIS': ['disney', 'bob iger'],
    'WMT': ['walmart', 'doug mcmillon'],
    'KO': ['coca-cola', 'coca cola', 'coke'],
    'BA': ['boeing', 'dave calhoun'],
  };

  for (const [ticker, patterns] of Object.entries(companyPatterns)) {
    for (const pattern of patterns) {
      if (combined.includes(pattern)) {
        if (!companies.includes(ticker)) {
          companies.push(ticker);
        }
      }
    }
  }

  // Check for keywords
  for (const keyword of MEDIA_KEYWORDS) {
    if (combined.includes(keyword.toLowerCase())) {
      keywords.push(keyword);
    }
  }

  // Relevant if we found any companies AND any keywords
  const isRelevant = companies.length > 0 || keywords.length >= 2;

  return { isRelevant, companies, keywords };
}

// =============================================================================
// YOUTUBE DATA API SEARCH (OPTIONAL)
// =============================================================================

interface YouTubeSearchResult {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      channelTitle: string;
      publishedAt: string;
      thumbnails: { high?: { url: string } };
    };
  }>;
}

async function searchForExecutives(apiKey: string): Promise<MediaAppearance[]> {
  const appearances: MediaAppearance[] = [];

  // Search for each executive
  for (const [ticker, executives] of Object.entries(TRACKED_EXECUTIVES)) {
    for (const exec of executives) {
      try {
        const query = encodeURIComponent(`${exec} interview`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&order=date&key=${apiKey}`;

        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
          logger.debug(`YouTube API search failed for ${exec}: ${response.status}`);
          continue;
        }

        const data = await response.json() as YouTubeSearchResult;

        for (const item of data.items || []) {
          const combined = `${item.snippet.title} ${item.snippet.description}`.toLowerCase();
          const keywords = MEDIA_KEYWORDS.filter(k => combined.includes(k.toLowerCase()));

          appearances.push({
            videoId: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            description: item.snippet.description,
            thumbnailUrl: item.snippet.thumbnails?.high?.url || '',
            mentionedCompanies: [ticker],
            mentionedKeywords: keywords,
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        logger.debug(`YouTube API error for ${exec}: ${error}`);
      }
    }
  }

  return appearances;
}

// =============================================================================
// TRANSCRIPT EXTRACTION
// =============================================================================

/**
 * Fetch transcript for a YouTube video.
 * Uses youtube-transcript package or YoutubeTranscriptApi.
 *
 * Note: This is separate from the source fetch because transcripts
 * are fetched on-demand for specific videos to avoid rate limits.
 */
export async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Try using youtube-transcript-api pattern from reference file
    // In Node.js, we can use the youtube-transcript package
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // For now, return null - transcript fetching requires additional setup
    // The mentions-edge detector will call this when needed
    logger.debug(`Transcript fetch for ${videoId} - requires youtube-transcript package`);
    return null;

  } catch (error) {
    logger.debug(`Transcript fetch error for ${videoId}: ${error}`);
    return null;
  }
}

/**
 * Calculate word frequency from transcript text.
 */
export function calculateWordFrequency(text: string): Record<string, number> {
  const frequency: Record<string, number> = {};
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);

  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }

  return frequency;
}

// =============================================================================
// ANALYSIS HELPERS
// =============================================================================

/**
 * Find media appearances for a specific company.
 */
export function getCompanyAppearances(
  data: ExecutiveMediaData,
  ticker: string
): MediaAppearance[] {
  return data.byCompany[ticker] || [];
}

/**
 * Get recent appearances mentioning specific keywords.
 */
export function getAppearancesWithKeywords(
  data: ExecutiveMediaData,
  keywords: string[],
  daysBack: number = 30
): MediaAppearance[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return data.appearances.filter(a => {
    const publishedDate = new Date(a.publishedAt);
    if (publishedDate < cutoff) return false;

    return keywords.some(k =>
      a.mentionedKeywords.some(mk => mk.toLowerCase().includes(k.toLowerCase()))
    );
  });
}

/**
 * Calculate keyword frequency across recent appearances.
 */
export function analyzeKeywordFrequency(
  appearances: MediaAppearance[],
  keyword: string
): { count: number; total: number; rate: number } {
  let count = 0;
  const keywordLower = keyword.toLowerCase();

  for (const appearance of appearances) {
    if (appearance.mentionedKeywords.some(k => k.toLowerCase().includes(keywordLower))) {
      count++;
    }
  }

  return {
    count,
    total: appearances.length,
    rate: appearances.length > 0 ? count / appearances.length : 0,
  };
}

/**
 * Get executives who have appeared recently.
 */
export function getRecentExecutiveAppearances(
  data: ExecutiveMediaData,
  ticker: string,
  daysBack: number = 14
): MediaAppearance[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const companyAppearances = data.byCompany[ticker] || [];

  return companyAppearances.filter(a => {
    const publishedDate = new Date(a.publishedAt);
    return publishedDate >= cutoff;
  });
}
