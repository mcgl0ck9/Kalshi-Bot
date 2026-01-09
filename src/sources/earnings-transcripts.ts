/**
 * Earnings Transcripts Source
 *
 * Fetches historical earnings call transcripts for keyword analysis.
 * Used to predict what keywords companies will mention in future calls.
 *
 * Free API: Financial Modeling Prep (sign up at financialmodelingprep.com)
 * Fallback: Yahoo Finance earnings data
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TranscriptSection {
  speaker: string;
  role: 'executive' | 'analyst' | 'operator' | 'unknown';
  text: string;
}

export interface EarningsTranscript {
  ticker: string;
  company: string;
  quarter: string;          // e.g., "Q3 2024"
  fiscalYear: number;
  date: string;
  preparedRemarks: string;
  qaSession: string;
  fullText: string;
  speakers: TranscriptSection[];
  wordFrequency: Record<string, number>;
  analystQuestions: string[];
}

export interface TranscriptsData {
  transcripts: EarningsTranscript[];
  byTicker: Record<string, EarningsTranscript[]>;
  fetchedAt: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Companies we actively track for mentions markets
const TRACKED_TICKERS = [
  'STZ',   // Constellation Brands
  'META', 'AAPL', 'AMZN', 'NFLX', 'GOOGL',  // FAANG
  'MSFT', 'NVDA', 'TSLA',  // Tech giants
  'JPM', 'GS', 'BAC', 'WFC',  // Banks
  'DIS', 'WMT', 'TGT', 'COST',  // Consumer
  'KO', 'PEP', 'MCD', 'SBUX',  // F&B
  'BA', 'UAL', 'DAL',  // Aviation
  'XOM', 'CVX',  // Energy
];

// Keywords commonly tracked in mentions markets
const TRACKED_KEYWORDS = [
  'tariff', 'tariffs',
  'ai', 'artificial intelligence', 'machine learning',
  'recession', 'downturn', 'slowdown',
  'inflation', 'price increases', 'pricing power',
  'layoffs', 'restructuring', 'cost cutting',
  'china', 'supply chain',
  'guidance', 'outlook', 'forecast',
  'dividend', 'buyback', 'shareholder return',
  'regulation', 'regulatory', 'compliance',
  'growth', 'expansion', 'market share',
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<TranscriptsData>({
  name: 'earnings-transcripts',
  category: 'other',
  cacheTTL: 86400,  // 24 hours - transcripts don't change

  async fetch(): Promise<TranscriptsData> {
    const transcripts: EarningsTranscript[] = [];
    const byTicker: Record<string, EarningsTranscript[]> = {};

    const apiKey = process.env.FMP_API_KEY;

    if (apiKey) {
      // Use Financial Modeling Prep API
      for (const ticker of TRACKED_TICKERS) {
        const tickerTranscripts = await fetchFMPTranscripts(ticker, apiKey);
        if (tickerTranscripts.length > 0) {
          transcripts.push(...tickerTranscripts);
          byTicker[ticker] = tickerTranscripts;
        }
      }
    } else {
      // Fallback: Use cached/mock data or public sources
      logger.warn('FMP_API_KEY not set - using limited transcript data');
      for (const ticker of TRACKED_TICKERS.slice(0, 5)) {
        const tickerTranscripts = await fetchPublicTranscripts(ticker);
        if (tickerTranscripts.length > 0) {
          transcripts.push(...tickerTranscripts);
          byTicker[ticker] = tickerTranscripts;
        }
      }
    }

    logger.info(`Fetched ${transcripts.length} transcripts for ${Object.keys(byTicker).length} companies`);

    return {
      transcripts,
      byTicker,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// FMP API FETCHER
// =============================================================================

interface FMPTranscript {
  symbol: string;
  quarter: number;
  year: number;
  date: string;
  content: string;
}

async function fetchFMPTranscripts(
  ticker: string,
  apiKey: string,
  quarters: number = 4
): Promise<EarningsTranscript[]> {
  try {
    const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${ticker}?limit=${quarters}&apikey=${apiKey}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.debug(`FMP transcript fetch failed for ${ticker}: ${response.status}`);
      return [];
    }

    const data = await response.json() as FMPTranscript[];
    if (!Array.isArray(data)) return [];

    return data.map(t => parseTranscript(t)).filter(Boolean) as EarningsTranscript[];

  } catch (error) {
    logger.debug(`FMP transcript error for ${ticker}: ${error}`);
    return [];
  }
}

function parseTranscript(raw: FMPTranscript): EarningsTranscript | null {
  if (!raw.content) return null;

  const { preparedRemarks, qaSession } = splitTranscript(raw.content);
  const speakers = parseSpeakers(raw.content);
  const analystQuestions = extractAnalystQuestions(speakers);
  const wordFrequency = calculateWordFrequency(raw.content);

  return {
    ticker: raw.symbol,
    company: raw.symbol,  // Would need company name lookup
    quarter: `Q${raw.quarter} ${raw.year}`,
    fiscalYear: raw.year,
    date: raw.date,
    preparedRemarks,
    qaSession,
    fullText: raw.content,
    speakers,
    wordFrequency,
    analystQuestions,
  };
}

// =============================================================================
// PUBLIC/FALLBACK FETCHER
// =============================================================================

async function fetchPublicTranscripts(ticker: string): Promise<EarningsTranscript[]> {
  // Try Yahoo Finance earnings calendar/summaries
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=earningsHistory,earningsTrend`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'KalshiEdgeDetector/4.0' },
    });

    if (!response.ok) return [];

    // Yahoo doesn't provide full transcripts, but we can get earnings dates
    // This serves as a placeholder - full transcripts need FMP API
    logger.debug(`Yahoo fallback for ${ticker} - limited data`);
    return [];

  } catch {
    return [];
  }
}

// =============================================================================
// TRANSCRIPT PARSING
// =============================================================================

function splitTranscript(content: string): { preparedRemarks: string; qaSession: string } {
  // Common patterns that indicate Q&A section start
  const qaPatterns = [
    /question.and.answer/i,
    /q\s*&\s*a\s+session/i,
    /we.will.now.take.questions/i,
    /open.the.floor.for.questions/i,
    /operator.*instructions/i,
  ];

  for (const pattern of qaPatterns) {
    const match = content.search(pattern);
    if (match > 0) {
      return {
        preparedRemarks: content.slice(0, match).trim(),
        qaSession: content.slice(match).trim(),
      };
    }
  }

  // No clear split - assume mostly prepared remarks
  return {
    preparedRemarks: content,
    qaSession: '',
  };
}

function parseSpeakers(content: string): TranscriptSection[] {
  const sections: TranscriptSection[] = [];

  // Pattern: "Speaker Name - Title" or "Speaker Name:" followed by text
  const speakerPattern = /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s*[-–]\s*([^:]+))?\s*:\s*([^]*?)(?=(?:[A-Z][a-z]+ [A-Z][a-z]+\s*[-–:])|$)/g;

  let match;
  while ((match = speakerPattern.exec(content)) !== null) {
    const [, name, title, text] = match;
    const role = determineRole(name, title || '');

    sections.push({
      speaker: name.trim(),
      role,
      text: text.trim(),
    });
  }

  return sections;
}

function determineRole(name: string, title: string): TranscriptSection['role'] {
  const combined = `${name} ${title}`.toLowerCase();

  if (/ceo|chief executive|president|chairman/i.test(combined)) {
    return 'executive';
  }
  if (/cfo|chief financial|treasurer/i.test(combined)) {
    return 'executive';
  }
  if (/coo|chief operating/i.test(combined)) {
    return 'executive';
  }
  if (/analyst|research|capital|securities|partners/i.test(combined)) {
    return 'analyst';
  }
  if (/operator|moderator/i.test(combined)) {
    return 'operator';
  }

  return 'unknown';
}

function extractAnalystQuestions(speakers: TranscriptSection[]): string[] {
  return speakers
    .filter(s => s.role === 'analyst')
    .map(s => s.text)
    .filter(text => text.includes('?'));
}

function calculateWordFrequency(text: string): Record<string, number> {
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
 * Check if a keyword appears in a transcript.
 */
export function containsKeyword(transcript: EarningsTranscript, keyword: string): boolean {
  const variants = getKeywordVariants(keyword);
  const textLower = transcript.fullText.toLowerCase();

  return variants.some(v => textLower.includes(v.toLowerCase()));
}

/**
 * Get variants of a keyword (plurals, related terms).
 */
export function getKeywordVariants(keyword: string): string[] {
  const variants = [keyword];
  const lower = keyword.toLowerCase();

  // Add common variants
  if (!lower.endsWith('s')) {
    variants.push(keyword + 's');  // Plural
  } else {
    variants.push(keyword.slice(0, -1));  // Singular
  }

  // Special cases
  const specialVariants: Record<string, string[]> = {
    'ai': ['artificial intelligence', 'a.i.', 'machine learning', 'ML'],
    'tariff': ['tariffs', 'import duties', 'trade barriers'],
    'recession': ['downturn', 'economic slowdown', 'contraction'],
    'layoff': ['layoffs', 'job cuts', 'workforce reduction', 'restructuring'],
    'china': ['chinese', 'prc', 'asia'],
  };

  if (specialVariants[lower]) {
    variants.push(...specialVariants[lower]);
  }

  return variants;
}

/**
 * Calculate historical mention rate for a keyword.
 */
export function calculateMentionRate(
  transcripts: EarningsTranscript[],
  keyword: string
): { rate: number; count: number; total: number; byQuarter: Record<string, boolean> } {
  if (transcripts.length === 0) {
    return { rate: 0.5, count: 0, total: 0, byQuarter: {} };
  }

  let count = 0;
  const byQuarter: Record<string, boolean> = {};

  for (const transcript of transcripts) {
    const mentioned = containsKeyword(transcript, keyword);
    byQuarter[transcript.quarter] = mentioned;
    if (mentioned) count++;
  }

  return {
    rate: count / transcripts.length,
    count,
    total: transcripts.length,
    byQuarter,
  };
}

/**
 * Analyze keyword frequency trend (increasing/stable/decreasing).
 */
export function analyzeKeywordTrend(
  transcripts: EarningsTranscript[],
  keyword: string
): 'increasing' | 'stable' | 'decreasing' {
  if (transcripts.length < 2) return 'stable';

  // Sort by date (most recent first)
  const sorted = [...transcripts].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Count mentions in recent half vs older half
  const midpoint = Math.floor(sorted.length / 2);
  const recentCount = sorted.slice(0, midpoint).filter(t => containsKeyword(t, keyword)).length;
  const olderCount = sorted.slice(midpoint).filter(t => containsKeyword(t, keyword)).length;

  const recentRate = recentCount / midpoint;
  const olderRate = olderCount / (sorted.length - midpoint);

  if (recentRate > olderRate + 0.2) return 'increasing';
  if (recentRate < olderRate - 0.2) return 'decreasing';
  return 'stable';
}

/**
 * Get analyst interest score for a keyword.
 * Higher score = analysts ask about it more often.
 */
export function getAnalystInterest(
  transcripts: EarningsTranscript[],
  keyword: string
): number {
  let questionMentions = 0;
  let totalQuestions = 0;

  const variants = getKeywordVariants(keyword);

  for (const transcript of transcripts) {
    for (const question of transcript.analystQuestions) {
      totalQuestions++;
      const qLower = question.toLowerCase();
      if (variants.some(v => qLower.includes(v.toLowerCase()))) {
        questionMentions++;
      }
    }
  }

  return totalQuestions > 0 ? questionMentions / totalQuestions : 0;
}

// =============================================================================
// SMART DECAY (TIME-WEIGHTED ANALYSIS)
// =============================================================================

/**
 * Configuration for time-weighted keyword analysis.
 * Uses exponential decay to de-weight old transcripts.
 */
export interface DecayConfig {
  /** Half-life in days (default: 270 = 9 months / 3 quarters) */
  halfLifeDays: number;

  /** Minimum weight for any transcript (default: 0.05) */
  floorWeight: number;

  /** Boost multiplier for most recent quarter (default: 1.5) */
  recencyBoost: number;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  halfLifeDays: 270,    // 9 months - typical 3 quarters of lookback
  floorWeight: 0.05,    // Even old transcripts get 5% weight
  recencyBoost: 1.5,    // Most recent quarter is 1.5x weighted
};

/**
 * Calculate the time-based weight for a transcript.
 * Uses exponential decay: weight = 0.5^(age_days / half_life)
 *
 * @param transcriptDate - Date of the transcript
 * @param config - Decay configuration
 * @returns Weight between floorWeight and recencyBoost
 */
export function calculateTranscriptWeight(
  transcriptDate: string | Date,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): number {
  const date = new Date(transcriptDate);
  const now = new Date();
  const ageDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay
  let weight = Math.pow(0.5, ageDays / config.halfLifeDays);

  // Apply floor
  weight = Math.max(config.floorWeight, weight);

  // Boost most recent quarter (within 100 days)
  if (ageDays <= 100) {
    weight = Math.min(config.recencyBoost, weight * config.recencyBoost);
  }

  return weight;
}

/**
 * Time-weighted mention rate for a keyword.
 * More recent transcripts have higher influence on the rate.
 *
 * This solves the "stale keyword" problem:
 * - Kroger/Albertsons merger keywords from 2024 get low weight
 * - Recent quarters dominate the probability estimate
 */
export function calculateTimeWeightedMentionRate(
  transcripts: EarningsTranscript[],
  keyword: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): {
  rate: number;
  weightedMentions: number;
  totalWeight: number;
  effectiveN: number;
  byQuarter: Record<string, { mentioned: boolean; weight: number }>;
} {
  if (transcripts.length === 0) {
    return {
      rate: 0.5,  // Prior with no data
      weightedMentions: 0,
      totalWeight: 0,
      effectiveN: 0,
      byQuarter: {},
    };
  }

  let weightedMentions = 0;
  let totalWeight = 0;
  const byQuarter: Record<string, { mentioned: boolean; weight: number }> = {};

  for (const transcript of transcripts) {
    const weight = calculateTranscriptWeight(transcript.date, config);
    const mentioned = containsKeyword(transcript, keyword);

    byQuarter[transcript.quarter] = { mentioned, weight };
    totalWeight += weight;

    if (mentioned) {
      weightedMentions += weight;
    }
  }

  // Effective sample size (accounts for decay - reduced from nominal N)
  const effectiveN = totalWeight / Math.max(...Object.values(byQuarter).map(q => q.weight));

  return {
    rate: totalWeight > 0 ? weightedMentions / totalWeight : 0.5,
    weightedMentions,
    totalWeight,
    effectiveN,
    byQuarter,
  };
}

/**
 * Time-weighted analyst interest score.
 * Recent analyst questions count more than old ones.
 */
export function getTimeWeightedAnalystInterest(
  transcripts: EarningsTranscript[],
  keyword: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): {
  score: number;
  weightedMentions: number;
  totalWeight: number;
  trend: 'increasing' | 'stable' | 'decreasing';
} {
  let weightedMentions = 0;
  let totalWeight = 0;
  let recentMentions = 0;
  let recentWeight = 0;
  let olderMentions = 0;
  let olderWeight = 0;

  const variants = getKeywordVariants(keyword);
  const cutoffDays = 180; // 6 months for trend calculation

  for (const transcript of transcripts) {
    const weight = calculateTranscriptWeight(transcript.date, config);
    const ageDays = (new Date().getTime() - new Date(transcript.date).getTime()) / (1000 * 60 * 60 * 24);

    for (const question of transcript.analystQuestions) {
      totalWeight += weight;
      const qLower = question.toLowerCase();

      if (variants.some(v => qLower.includes(v.toLowerCase()))) {
        weightedMentions += weight;

        if (ageDays <= cutoffDays) {
          recentMentions += weight;
          recentWeight += weight;
        } else {
          olderMentions += weight;
          olderWeight += weight;
        }
      } else {
        if (ageDays <= cutoffDays) {
          recentWeight += weight;
        } else {
          olderWeight += weight;
        }
      }
    }
  }

  // Calculate trend from recent vs older weighted rates
  const recentRate = recentWeight > 0 ? recentMentions / recentWeight : 0;
  const olderRate = olderWeight > 0 ? olderMentions / olderWeight : 0;

  let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  if (recentRate > olderRate + 0.15) trend = 'increasing';
  if (recentRate < olderRate - 0.15) trend = 'decreasing';

  return {
    score: totalWeight > 0 ? weightedMentions / totalWeight : 0,
    weightedMentions,
    totalWeight,
    trend,
  };
}

/**
 * Extract "hot topics" from analyst Q&A.
 * A topic is "hot" if analysts asked about it multiple times.
 *
 * Used for cross-company inference: if analysts grilled Kroger about
 * "delivery" 5 times, it's likely they'll ask Albertsons too.
 */
export function extractHotTopics(
  transcript: EarningsTranscript,
  minMentions: number = 2
): Array<{ topic: string; mentions: number; intensity: number }> {
  const topicCounts = new Map<string, number>();
  const trackedTopics = [
    'delivery', 'online', 'e-commerce',
    'inflation', 'pricing', 'margin',
    'AI', 'artificial intelligence',
    'tariff', 'china', 'supply chain',
    'layoff', 'restructuring', 'headcount',
    'shrinkage', 'theft', 'loss',
    'guidance', 'outlook', 'forecast',
    'recession', 'slowdown', 'downturn',
    'dividend', 'buyback', 'capital return',
    'regulation', 'antitrust', 'FTC',
    'GLP-1', 'Ozempic', 'weight loss',
    'EV', 'electric', 'autonomous',
  ];

  for (const question of transcript.analystQuestions) {
    const qLower = question.toLowerCase();

    for (const topic of trackedTopics) {
      if (qLower.includes(topic.toLowerCase())) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
    }
  }

  const totalQuestions = transcript.analystQuestions.length || 1;

  return Array.from(topicCounts.entries())
    .filter(([_, count]) => count >= minMentions)
    .map(([topic, mentions]) => ({
      topic,
      mentions,
      intensity: mentions / totalQuestions,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

/**
 * Check if a keyword is "stale" - mentioned historically but likely
 * no longer relevant due to corporate events.
 *
 * Examples of stale keywords:
 * - "Kroger" for Albertsons after merger failure
 * - "Earnings" for EA if going private
 */
export interface StaleKeywordCheck {
  isStale: boolean;
  reason?: string;
  lastMentionDate?: string;
  daysSinceLastMention?: number;
  suggestedReplacement?: string;
}

export function checkKeywordStaleness(
  transcripts: EarningsTranscript[],
  keyword: string,
  staleDays: number = 365
): StaleKeywordCheck {
  if (transcripts.length === 0) {
    return { isStale: false };
  }

  // Sort by date descending
  const sorted = [...transcripts].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Find most recent mention
  let lastMentionDate: string | undefined;
  for (const transcript of sorted) {
    if (containsKeyword(transcript, keyword)) {
      lastMentionDate = transcript.date;
      break;
    }
  }

  if (!lastMentionDate) {
    return {
      isStale: true,
      reason: 'Never mentioned in available transcripts',
    };
  }

  const daysSince = (new Date().getTime() - new Date(lastMentionDate).getTime()) / (1000 * 60 * 60 * 24);

  // Check if recently mentioned
  if (daysSince <= staleDays / 2) {
    return {
      isStale: false,
      lastMentionDate,
      daysSinceLastMention: Math.round(daysSince),
    };
  }

  // Check trend - if decreasing and old, likely stale
  const trend = analyzeKeywordTrend(sorted, keyword);
  if (trend === 'decreasing' && daysSince > staleDays * 0.75) {
    return {
      isStale: true,
      reason: `Decreasing trend, last mentioned ${Math.round(daysSince)} days ago`,
      lastMentionDate,
      daysSinceLastMention: Math.round(daysSince),
    };
  }

  if (daysSince > staleDays) {
    return {
      isStale: true,
      reason: `Not mentioned in ${Math.round(daysSince)} days`,
      lastMentionDate,
      daysSinceLastMention: Math.round(daysSince),
    };
  }

  return {
    isStale: false,
    lastMentionDate,
    daysSinceLastMention: Math.round(daysSince),
  };
}
