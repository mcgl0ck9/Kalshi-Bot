/**
 * Kalshi Mentions Markets Source
 *
 * Fetches active Kalshi "mentions" markets - markets that ask
 * "Will company X mention keyword Y in their earnings call?"
 *
 * Example: KXEARNINGSMENTIONSTZ-26JUN30 - Constellation Brands mentions
 */

import { defineSource } from '../core/index.js';
import { kalshiFetchJson, hasKalshiAuth } from '../utils/kalshi-auth.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface KeywordOption {
  keyword: string;          // e.g., "tariffs", "AI", "recession"
  ticker: string;           // Market ticker for this keyword
  yesPrice: number;         // Current YES price (0-1)
  noPrice: number;          // Current NO price (0-1)
  volume: number;           // Trading volume
  url: string;              // Direct link to market
}

export interface MentionsMarket {
  seriesTicker: string;     // e.g., "KXEARNINGSMENTIONSTZ"
  company: string;          // e.g., "Constellation Brands"
  companyTicker: string;    // e.g., "STZ"
  eventType: 'earnings' | 'speech' | 'interview' | 'announcement';
  eventDate: string;        // When the earnings call happens
  closeTime: string;        // Market close time
  keywords: KeywordOption[];
}

export interface MentionsMarketsData {
  markets: MentionsMarket[];
  companies: string[];      // List of companies with active markets
  fetchedAt: string;
}

// =============================================================================
// COMPANY TICKER MAPPING
// =============================================================================

const COMPANY_TICKER_MAP: Record<string, string> = {
  'constellation brands': 'STZ',
  'constellation': 'STZ',
  'meta': 'META',
  'meta platforms': 'META',
  'facebook': 'META',
  'apple': 'AAPL',
  'amazon': 'AMZN',
  'netflix': 'NFLX',
  'google': 'GOOGL',
  'alphabet': 'GOOGL',
  'microsoft': 'MSFT',
  'nvidia': 'NVDA',
  'tesla': 'TSLA',
  'jpmorgan': 'JPM',
  'jp morgan': 'JPM',
  'goldman sachs': 'GS',
  'bank of america': 'BAC',
  'wells fargo': 'WFC',
  'disney': 'DIS',
  'walmart': 'WMT',
  'target': 'TGT',
  'costco': 'COST',
  'coca-cola': 'KO',
  'pepsi': 'PEP',
  'pepsico': 'PEP',
  'mcdonalds': 'MCD',
  'starbucks': 'SBUX',
  'nike': 'NKE',
  'boeing': 'BA',
  'united airlines': 'UAL',
  'delta': 'DAL',
  'american airlines': 'AAL',
  'exxon': 'XOM',
  'chevron': 'CVX',
};

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<MentionsMarketsData>({
  name: 'kalshi-mentions',
  category: 'other',
  cacheTTL: 300,  // 5 minutes - markets change frequently

  async fetch(): Promise<MentionsMarketsData> {
    const markets: MentionsMarket[] = [];
    const companies = new Set<string>();

    try {
      // Fetch mentions-related series from Kalshi API
      const mentionsSeries = [
        'KXEARNINGSMENTIONS',
        'KXEARNINGSMENTIONSTZ',  // Constellation Brands example
        'KXSPEECHMENTIONS',
        // Add more series as they become available
      ];

      const allMarkets: RawMarket[] = [];

      for (const series of mentionsSeries) {
        const seriesMarkets = await fetchMentionsSeriesMarkets(series);
        allMarkets.push(...seriesMarkets);
      }

      // Also search for any market with "mention" in the ticker
      if (hasKalshiAuth()) {
        const searchResults = await searchMentionsMarkets();
        for (const market of searchResults) {
          if (!allMarkets.some(m => m.ticker === market.ticker)) {
            allMarkets.push(market);
          }
        }
      }

      // Group by series (company)
      const byCompany = new Map<string, RawMarket[]>();

      for (const market of allMarkets) {
        const seriesTicker = market.series_ticker || market.ticker?.split('-')[0] || '';
        if (!byCompany.has(seriesTicker)) {
          byCompany.set(seriesTicker, []);
        }
        byCompany.get(seriesTicker)!.push(market);
      }

      // Process each company's markets
      for (const [seriesTicker, companyMarkets] of byCompany) {
        const parsed = parseCompanyMarkets(seriesTicker, companyMarkets);
        if (parsed) {
          markets.push(parsed);
          companies.add(parsed.company);
        }
      }

      logger.info(`Found ${markets.length} mentions markets for ${companies.size} companies`);

    } catch (error) {
      logger.error(`Kalshi mentions fetch error: ${error}`);
      // Return empty data on error
    }

    return {
      markets,
      companies: Array.from(companies),
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// API FETCHERS
// =============================================================================

interface RawMarket {
  ticker?: string;
  title?: string;
  subtitle?: string;
  series_ticker?: string;
  yes_ask?: number;
  yes_bid?: number;
  no_ask?: number;
  no_bid?: number;
  volume?: number;
  close_time?: string;
  expiration_time?: string;
  status?: string;
  [key: string]: unknown;
}

interface KalshiMarketsResponse {
  markets: RawMarket[];
  cursor?: string;
}

async function fetchMentionsSeriesMarkets(series: string): Promise<RawMarket[]> {
  try {
    const data = await kalshiFetchJson<KalshiMarketsResponse>(
      `/markets?series_ticker=${series}&status=open`,
      { method: 'GET' }
    );
    return data?.markets || [];
  } catch (error) {
    logger.debug(`Failed to fetch mentions series ${series}: ${error}`);
    return [];
  }
}

async function searchMentionsMarkets(): Promise<RawMarket[]> {
  try {
    // Search for markets with "mention" in title
    const data = await kalshiFetchJson<KalshiMarketsResponse>(
      '/markets?status=open&limit=200',
      { method: 'GET' }
    );

    const allMarkets = data?.markets || [];

    // Filter for mentions markets
    return allMarkets.filter(m =>
      m.ticker?.toLowerCase().includes('mention') ||
      m.title?.toLowerCase().includes('mention') ||
      m.series_ticker?.toLowerCase().includes('mention')
    );
  } catch (error) {
    logger.debug(`Failed to search mentions markets: ${error}`);
    return [];
  }
}

// =============================================================================
// PARSING HELPERS
// =============================================================================

function parseCompanyMarkets(
  seriesTicker: string,
  markets: RawMarket[]
): MentionsMarket | null {
  if (markets.length === 0) return null;

  // Extract company name from first market's title
  const firstMarket = markets[0];
  const company = extractCompanyName(firstMarket.title || firstMarket.subtitle || '');
  const companyTicker = findCompanyTicker(company);

  // Parse keywords from individual markets
  const keywords: KeywordOption[] = [];

  for (const market of markets) {
    const keyword = extractKeyword(market.title || market.subtitle || '');
    if (!keyword) continue;

    keywords.push({
      keyword,
      ticker: market.ticker || '',
      yesPrice: market.yes_ask ?? 0.5,
      noPrice: market.no_ask ?? 0.5,
      volume: market.volume ?? 0,
      url: `https://kalshi.com/markets/${market.ticker}`,
    });
  }

  if (keywords.length === 0) return null;

  // Determine event type
  const eventType = determineEventType(firstMarket.title || '');

  return {
    seriesTicker,
    company,
    companyTicker,
    eventType,
    eventDate: extractEventDate(firstMarket.title || '') || '',
    closeTime: firstMarket.close_time || firstMarket.expiration_time || '',
    keywords,
  };
}

function extractCompanyName(title: string): string {
  // Pattern: "Will [Company] mention..."
  const match = title.match(/will\s+([^']+?)(?:'s|\s+mention)/i);
  if (match) return match[1].trim();

  // Pattern: "[Company] earnings..."
  const earningsMatch = title.match(/^([^']+?)(?:'s)?\s+(?:earnings|Q\d)/i);
  if (earningsMatch) return earningsMatch[1].trim();

  return 'Unknown';
}

function findCompanyTicker(company: string): string {
  const companyLower = company.toLowerCase();

  // Direct lookup
  if (COMPANY_TICKER_MAP[companyLower]) {
    return COMPANY_TICKER_MAP[companyLower];
  }

  // Partial match
  for (const [name, ticker] of Object.entries(COMPANY_TICKER_MAP)) {
    if (companyLower.includes(name) || name.includes(companyLower)) {
      return ticker;
    }
  }

  // Extract from company name (guess)
  const words = company.split(' ');
  if (words.length === 1 && words[0].length <= 5) {
    return words[0].toUpperCase();
  }

  return company.slice(0, 4).toUpperCase();
}

function extractKeyword(title: string): string | null {
  // Pattern: 'mention "[keyword]"' or 'say "[keyword]"'
  const quotedMatch = title.match(/(?:mention|say)\s+["']([^"']+)["']/i);
  if (quotedMatch) return quotedMatch[1].trim();

  // Pattern: 'mention [keyword]?' or 'say [keyword]?'
  const unquotedMatch = title.match(/(?:mention|say)\s+([a-zA-Z\s]+)\??$/i);
  if (unquotedMatch) return unquotedMatch[1].trim();

  // Pattern: market subtitle often contains keyword directly
  const simpleMatch = title.match(/(?:yes|no):\s*(.+?)(?:\s*mentioned|\s*said|\s*\?)?$/i);
  if (simpleMatch) return simpleMatch[1].trim();

  return null;
}

function determineEventType(title: string): MentionsMarket['eventType'] {
  const titleLower = title.toLowerCase();
  if (titleLower.includes('earnings') || titleLower.includes('quarter')) {
    return 'earnings';
  }
  if (titleLower.includes('speech')) {
    return 'speech';
  }
  if (titleLower.includes('interview')) {
    return 'interview';
  }
  return 'announcement';
}

function extractEventDate(title: string): string | null {
  // Pattern: "Q[1-4] 202[4-6]" or "June 2025"
  const quarterMatch = title.match(/Q(\d)\s*(20\d{2})/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    // Approximate quarter end dates
    const monthMap = { 1: '03', 2: '06', 3: '09', 4: '12' };
    return `${year}-${monthMap[quarter as 1 | 2 | 3 | 4]}-30`;
  }

  // Pattern: "June 30, 2025" or "Jun 2025"
  const dateMatch = title.match(/(\w+)\s+(\d{1,2})?,?\s*(20\d{2})/i);
  if (dateMatch) {
    const month = parseMonth(dateMatch[1]);
    const day = dateMatch[2] || '15';
    const year = dateMatch[3];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  return null;
}

function parseMonth(monthStr: string): string | null {
  const months: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };
  return months[monthStr.toLowerCase()] || null;
}

// =============================================================================
// EXPORTS FOR EDGE ANALYSIS
// =============================================================================

/**
 * Get all keywords for a specific company.
 */
export function getCompanyKeywords(
  data: MentionsMarketsData,
  companyTicker: string
): KeywordOption[] {
  const market = data.markets.find(m =>
    m.companyTicker.toUpperCase() === companyTicker.toUpperCase()
  );
  return market?.keywords ?? [];
}

/**
 * Find markets expiring soon (within N days).
 */
export function getExpiringMarkets(
  data: MentionsMarketsData,
  daysAhead: number = 7
): MentionsMarket[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);

  return data.markets.filter(m => {
    if (!m.closeTime) return false;
    return new Date(m.closeTime) <= cutoff;
  });
}

/**
 * Get keywords with extreme prices (likely mispriced).
 */
export function getExtremePricedKeywords(
  data: MentionsMarketsData,
  threshold: number = 0.15
): Array<{ market: MentionsMarket; keyword: KeywordOption }> {
  const results: Array<{ market: MentionsMarket; keyword: KeywordOption }> = [];

  for (const market of data.markets) {
    for (const keyword of market.keywords) {
      // Very low or very high prices might indicate mispricing
      if (keyword.yesPrice <= threshold || keyword.yesPrice >= (1 - threshold)) {
        results.push({ market, keyword });
      }
    }
  }

  return results;
}
