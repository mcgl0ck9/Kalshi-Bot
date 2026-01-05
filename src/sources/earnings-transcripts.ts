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
