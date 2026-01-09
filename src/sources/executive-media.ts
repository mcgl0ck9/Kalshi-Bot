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

// =============================================================================
// PRE-EARNINGS SIGNAL DETECTION
// =============================================================================

/**
 * Appearance type classification for pre-earnings signal detection.
 * C-suite appearances before earnings often preview discussion topics.
 */
export type AppearanceType =
  | 'earnings_call'
  | 'investor_conference'
  | 'tv_interview'
  | 'podcast'
  | 'product_launch'
  | 'analyst_day'
  | 'shareholder_meeting'
  | 'other';

/**
 * Pre-earnings signal from executive media appearance.
 */
export interface PreEarningsSignal {
  ticker: string;
  appearance: MediaAppearance;
  appearanceType: AppearanceType;
  daysToEarnings: number;
  topicsDiscussed: string[];
  signalStrength: number;  // 0-1, higher = more predictive
  reasoning: string;
}

/**
 * Company earnings schedule (approximate).
 * Used to determine if an appearance is "pre-earnings".
 */
export interface EarningsSchedule {
  ticker: string;
  nextEarningsDate?: string;
  quarter?: string;
}

/**
 * Detect pre-earnings signals from executive media appearances.
 *
 * The insight: C-suite executives appearing on TV/conferences within 30 days
 * of earnings often preview topics that will be discussed on the call.
 * This gives us a forward-looking signal for mentions markets.
 *
 * @param data - Executive media data
 * @param ticker - Company ticker
 * @param earningsDate - Expected earnings call date
 * @returns Pre-earnings signals with topic predictions
 */
export function detectPreEarningsSignals(
  data: ExecutiveMediaData,
  ticker: string,
  earningsDate: string
): PreEarningsSignal[] {
  const signals: PreEarningsSignal[] = [];
  const earningsTime = new Date(earningsDate).getTime();
  const now = Date.now();

  // Only look at upcoming earnings (not past)
  if (earningsTime < now) {
    return signals;
  }

  const companyAppearances = data.byCompany[ticker] || [];

  for (const appearance of companyAppearances) {
    const appearanceTime = new Date(appearance.publishedAt).getTime();

    // Only consider appearances BEFORE earnings
    if (appearanceTime >= earningsTime) continue;

    const daysToEarnings = (earningsTime - appearanceTime) / (1000 * 60 * 60 * 24);

    // Pre-earnings window: 1-45 days before
    if (daysToEarnings < 1 || daysToEarnings > 45) continue;

    const appearanceType = classifyAppearanceType(appearance);
    const topics = extractTopicsFromAppearance(appearance);
    const signalStrength = calculatePreEarningsSignalStrength(
      appearanceType,
      daysToEarnings,
      topics.length
    );

    if (signalStrength > 0.3 && topics.length > 0) {
      signals.push({
        ticker,
        appearance,
        appearanceType,
        daysToEarnings: Math.round(daysToEarnings),
        topicsDiscussed: topics,
        signalStrength,
        reasoning: buildPreEarningsReasoning(appearanceType, daysToEarnings, topics),
      });
    }
  }

  // Sort by signal strength (most predictive first)
  return signals.sort((a, b) => b.signalStrength - a.signalStrength);
}

/**
 * Classify the type of media appearance.
 */
function classifyAppearanceType(appearance: MediaAppearance): AppearanceType {
  const titleLower = appearance.title.toLowerCase();
  const descLower = appearance.description.toLowerCase();
  const combined = `${titleLower} ${descLower}`;

  // Earnings call (historical reference)
  if (combined.includes('earnings call') || combined.includes('earnings conference')) {
    return 'earnings_call';
  }

  // Investor conference
  if (combined.includes('investor conference') ||
      combined.includes('investor day') ||
      combined.includes('morgan stanley') ||
      combined.includes('goldman sachs') ||
      combined.includes('jpmorgan') ||
      combined.includes('barclays') ||
      combined.includes('ubs conference') ||
      combined.includes('bank of america') ||
      combined.includes('bernstein') ||
      combined.includes('tech conference') ||
      combined.includes('financial conference')) {
    return 'investor_conference';
  }

  // Analyst day
  if (combined.includes('analyst day') || combined.includes('capital markets day')) {
    return 'analyst_day';
  }

  // TV interview
  if (appearance.channel.includes('CNBC') ||
      appearance.channel.includes('Bloomberg') ||
      appearance.channel.includes('Fox Business') ||
      combined.includes('interview') ||
      combined.includes('exclusive') ||
      combined.includes('speaks')) {
    return 'tv_interview';
  }

  // Podcast
  if (combined.includes('podcast') || combined.includes('episode')) {
    return 'podcast';
  }

  // Product launch
  if (combined.includes('launch') || combined.includes('announcement') || combined.includes('keynote')) {
    return 'product_launch';
  }

  // Shareholder meeting
  if (combined.includes('shareholder') || combined.includes('annual meeting')) {
    return 'shareholder_meeting';
  }

  return 'other';
}

/**
 * Extract topics discussed from appearance title and description.
 */
function extractTopicsFromAppearance(appearance: MediaAppearance): string[] {
  const topics: string[] = [];
  const combined = `${appearance.title} ${appearance.description}`.toLowerCase();

  // Topic categories with keywords
  const topicPatterns: Record<string, string[]> = {
    'AI': ['ai', 'artificial intelligence', 'machine learning', 'gpt', 'llm', 'generative'],
    'tariffs': ['tariff', 'trade war', 'import duty', 'china trade'],
    'inflation': ['inflation', 'price', 'pricing power', 'cost pressure'],
    'recession': ['recession', 'downturn', 'slowdown', 'economic'],
    'layoffs': ['layoff', 'job cut', 'restructuring', 'workforce'],
    'guidance': ['guidance', 'outlook', 'forecast', 'expect'],
    'growth': ['growth', 'expansion', 'market share'],
    'dividends': ['dividend', 'buyback', 'shareholder return'],
    'regulation': ['regulation', 'regulatory', 'antitrust', 'ftc', 'doj'],
    'china': ['china', 'chinese market', 'asia'],
    'supply chain': ['supply chain', 'logistics', 'inventory'],
    'margins': ['margin', 'profitability', 'gross margin'],
    'capex': ['capex', 'capital expenditure', 'investment'],
    'M&A': ['acquisition', 'merger', 'deal', 'buy'],
    'cloud': ['cloud', 'aws', 'azure', 'gcp'],
    'EV': ['ev', 'electric vehicle', 'battery'],
    'streaming': ['streaming', 'subscriber', 'content'],
  };

  for (const [topic, patterns] of Object.entries(topicPatterns)) {
    if (patterns.some(p => combined.includes(p))) {
      topics.push(topic);
    }
  }

  // Also include keywords already extracted
  for (const keyword of appearance.mentionedKeywords) {
    const normalized = keyword.toLowerCase();
    if (!topics.some(t => t.toLowerCase() === normalized)) {
      topics.push(keyword);
    }
  }

  return topics;
}

/**
 * Calculate signal strength based on appearance characteristics.
 *
 * Higher signal strength = more predictive of earnings call content.
 */
function calculatePreEarningsSignalStrength(
  appearanceType: AppearanceType,
  daysToEarnings: number,
  topicsCount: number
): number {
  let strength = 0.3;  // Base

  // Appearance type weighting
  // Investor conferences are highly predictive - executives preview strategy
  const typeWeights: Record<AppearanceType, number> = {
    'investor_conference': 0.35,
    'analyst_day': 0.35,
    'tv_interview': 0.25,
    'podcast': 0.15,
    'shareholder_meeting': 0.20,
    'product_launch': 0.10,
    'earnings_call': 0.0,  // Historical, not predictive
    'other': 0.05,
  };
  strength += typeWeights[appearanceType] || 0;

  // Proximity weighting - closer to earnings = more relevant
  // Sweet spot is 7-21 days before (enough time to trade, recent enough to be relevant)
  if (daysToEarnings >= 7 && daysToEarnings <= 21) {
    strength += 0.20;  // Optimal window
  } else if (daysToEarnings >= 3 && daysToEarnings < 7) {
    strength += 0.25;  // Very close - high urgency
  } else if (daysToEarnings > 21 && daysToEarnings <= 35) {
    strength += 0.10;  // Moderate relevance
  }
  // Beyond 35 days: base strength only

  // Topic diversity - more topics = richer signal
  strength += Math.min(0.15, topicsCount * 0.03);

  return Math.min(1.0, strength);
}

/**
 * Build reasoning explanation for pre-earnings signal.
 */
function buildPreEarningsReasoning(
  appearanceType: AppearanceType,
  daysToEarnings: number,
  topics: string[]
): string {
  const typeDescriptions: Record<AppearanceType, string> = {
    'investor_conference': 'Investor conference appearances often preview strategic themes',
    'analyst_day': 'Analyst days typically discuss topics that will be emphasized in earnings',
    'tv_interview': 'TV interviews before earnings often hint at discussion topics',
    'podcast': 'Podcast appearances can reveal executive thinking',
    'shareholder_meeting': 'Shareholder meetings preview company messaging',
    'product_launch': 'Product launches may be referenced in earnings',
    'earnings_call': 'Historical earnings call',
    'other': 'Media appearance',
  };

  const topicList = topics.slice(0, 3).join(', ');
  const moreTopics = topics.length > 3 ? ` (+${topics.length - 3} more)` : '';

  return `${typeDescriptions[appearanceType]}. ` +
    `${Math.round(daysToEarnings)} days before earnings. ` +
    `Topics: ${topicList}${moreTopics}`;
}

/**
 * Get aggregated topic predictions from all pre-earnings signals.
 *
 * Combines signals to produce a weighted probability boost for each topic.
 */
export function aggregatePreEarningsTopics(
  signals: PreEarningsSignal[]
): Array<{ topic: string; confidenceBoost: number; appearances: number }> {
  const topicScores = new Map<string, { totalStrength: number; count: number }>();

  for (const signal of signals) {
    for (const topic of signal.topicsDiscussed) {
      const existing = topicScores.get(topic) || { totalStrength: 0, count: 0 };
      existing.totalStrength += signal.signalStrength;
      existing.count += 1;
      topicScores.set(topic, existing);
    }
  }

  return Array.from(topicScores.entries())
    .map(([topic, scores]) => ({
      topic,
      confidenceBoost: Math.min(0.25, scores.totalStrength / signals.length * 0.3),
      appearances: scores.count,
    }))
    .sort((a, b) => b.confidenceBoost - a.confidenceBoost);
}

/**
 * Check if a keyword is "warmed up" by pre-earnings executive appearances.
 *
 * A warmed-up keyword has higher probability of being mentioned in earnings
 * because the executive already discussed it publicly.
 */
export function isKeywordWarmedUp(
  data: ExecutiveMediaData,
  ticker: string,
  keyword: string,
  earningsDate: string
): { warmedUp: boolean; confidenceBoost: number; reasoning?: string } {
  const signals = detectPreEarningsSignals(data, ticker, earningsDate);

  const keywordLower = keyword.toLowerCase();
  const matchingSignals = signals.filter(s =>
    s.topicsDiscussed.some(t => t.toLowerCase().includes(keywordLower) ||
                                keywordLower.includes(t.toLowerCase()))
  );

  if (matchingSignals.length === 0) {
    return { warmedUp: false, confidenceBoost: 0 };
  }

  // Calculate confidence boost from matching appearances
  const totalStrength = matchingSignals.reduce((sum, s) => sum + s.signalStrength, 0);
  const confidenceBoost = Math.min(0.20, totalStrength * 0.15);

  const recentAppearance = matchingSignals[0];
  const reasoning = `Executive discussed "${keyword}" ${recentAppearance.daysToEarnings}d before earnings ` +
    `in ${recentAppearance.appearanceType.replace('_', ' ')}`;

  return {
    warmedUp: true,
    confidenceBoost,
    reasoning,
  };
}
