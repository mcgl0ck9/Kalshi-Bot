/**
 * Corporate Events Source
 *
 * Tracks significant corporate events that affect earnings keyword relevance:
 * - M&A announcements and failures
 * - Going private transactions
 * - Spin-offs and divestitures
 * - CEO/leadership changes
 * - Major regulatory actions
 *
 * These events can invalidate historical keywords:
 * - "Kroger" for Albertsons after merger failure
 * - "Earnings" for EA if going private
 * - "Watson" for IBM after spin-off
 */

import { defineSource } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export type CorporateEventType =
  | 'merger_announced'
  | 'merger_completed'
  | 'merger_failed'
  | 'going_private'
  | 'going_public'
  | 'spinoff'
  | 'divestiture'
  | 'ceo_change'
  | 'activist_investor'
  | 'bankruptcy'
  | 'delisting'
  | 'regulatory_action';

export interface CorporateEvent {
  /** Affected company ticker */
  ticker: string;

  /** Company name */
  company: string;

  /** Type of corporate event */
  eventType: CorporateEventType;

  /** Date the event occurred or was announced */
  eventDate: string;

  /** Brief description */
  description: string;

  /** Keywords that are now stale/invalidated by this event */
  staleKeywords: string[];

  /** New keywords made relevant by this event */
  freshKeywords: string[];

  /** Other tickers involved (e.g., merger partner) */
  relatedTickers?: string[];

  /** Source of the information */
  source: string;

  /** How this affects earnings probability estimates */
  earningsImpact: {
    /** Should we skip earnings markets entirely? */
    skipEarningsMarkets: boolean;
    /** Reason for the impact */
    reason: string;
  };
}

export interface CorporateEventsData {
  events: CorporateEvent[];
  byTicker: Record<string, CorporateEvent[]>;
  fetchedAt: string;
}

// =============================================================================
// KNOWN CORPORATE EVENTS (MANUAL REGISTRY)
// =============================================================================

/**
 * Manually maintained list of significant corporate events.
 * These are events that fundamentally change keyword relevance.
 *
 * This supplements real-time news - some events are too important
 * to risk missing due to API failures.
 */
const KNOWN_EVENTS: CorporateEvent[] = [
  // ALBERTSONS / KROGER MERGER FAILURE
  {
    ticker: 'ACI',
    company: 'Albertsons',
    eventType: 'merger_failed',
    eventDate: '2024-12-10',
    description: 'Kroger-Albertsons merger blocked by FTC, deal abandoned',
    staleKeywords: ['kroger', 'merger', 'ftc', 'combined company', 'divestiture'],
    freshKeywords: ['standalone', 'independent', 'go-forward strategy'],
    relatedTickers: ['KR'],
    source: 'SEC filings / news',
    earningsImpact: {
      skipEarningsMarkets: false,
      reason: 'Company continues as standalone - normal earnings expected',
    },
  },
  {
    ticker: 'KR',
    company: 'Kroger',
    eventType: 'merger_failed',
    eventDate: '2024-12-10',
    description: 'Kroger-Albertsons merger blocked by FTC, deal abandoned',
    staleKeywords: ['albertsons', 'merger', 'ftc', 'combined company', 'divestiture'],
    freshKeywords: ['standalone strategy', 'organic growth'],
    relatedTickers: ['ACI'],
    source: 'SEC filings / news',
    earningsImpact: {
      skipEarningsMarkets: false,
      reason: 'Company continues as standalone - normal earnings expected',
    },
  },

  // EA GOING PRIVATE (RUMORED)
  {
    ticker: 'EA',
    company: 'Electronic Arts',
    eventType: 'going_private',
    eventDate: '2025-01-06',
    description: 'EA reportedly exploring going-private transaction',
    staleKeywords: [], // Not confirmed yet
    freshKeywords: ['going private', 'buyout', 'take private', 'PE', 'private equity'],
    source: 'News reports',
    earningsImpact: {
      skipEarningsMarkets: true,
      reason: 'If going private confirmed, public earnings calls may cease',
    },
  },

  // EXAMPLES OF OTHER EVENT TYPES (add as needed)
  /*
  {
    ticker: 'IBM',
    company: 'IBM',
    eventType: 'spinoff',
    eventDate: '2021-11-03',
    description: 'IBM spun off Kyndryl (managed infrastructure services)',
    staleKeywords: ['kyndryl', 'managed services', 'GTS'],
    freshKeywords: ['software', 'hybrid cloud', 'consulting'],
    relatedTickers: ['KD'],
    source: 'SEC filings',
    earningsImpact: {
      skipEarningsMarkets: false,
      reason: 'IBM continues with reduced scope - adjust for spin-off',
    },
  },
  */
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<CorporateEventsData>({
  name: 'corporate-events',
  category: 'other',
  cacheTTL: 3600, // 1 hour - events don't change often but want fresh data

  async fetch(): Promise<CorporateEventsData> {
    const events: CorporateEvent[] = [...KNOWN_EVENTS];
    const byTicker: Record<string, CorporateEvent[]> = {};

    try {
      // Try to fetch recent corporate events from news
      const newsEvents = await fetchRecentCorporateEvents();

      // Merge with known events, avoiding duplicates
      for (const event of newsEvents) {
        const isDuplicate = events.some(e =>
          e.ticker === event.ticker &&
          e.eventType === event.eventType &&
          Math.abs(new Date(e.eventDate).getTime() - new Date(event.eventDate).getTime()) < 7 * 24 * 60 * 60 * 1000
        );
        if (!isDuplicate) {
          events.push(event);
        }
      }
    } catch (error) {
      logger.debug(`Failed to fetch recent corporate events: ${error}`);
      // Fall back to known events only
    }

    // Index by ticker
    for (const event of events) {
      if (!byTicker[event.ticker]) {
        byTicker[event.ticker] = [];
      }
      byTicker[event.ticker].push(event);

      // Also index by related tickers
      for (const related of event.relatedTickers ?? []) {
        if (!byTicker[related]) {
          byTicker[related] = [];
        }
        // Add reference to the event for related tickers too
        byTicker[related].push(event);
      }
    }

    logger.info(`Loaded ${events.length} corporate events for ${Object.keys(byTicker).length} tickers`);

    return {
      events,
      byTicker,
      fetchedAt: new Date().toISOString(),
    };
  },
});

// =============================================================================
// NEWS-BASED EVENT DETECTION
// =============================================================================

/**
 * Fetch recent corporate events from news sources.
 * Uses pattern matching on news headlines to detect M&A, etc.
 */
async function fetchRecentCorporateEvents(): Promise<CorporateEvent[]> {
  const events: CorporateEvent[] = [];

  // Try SEC EDGAR for 8-K filings (material events)
  try {
    const secEvents = await fetchSECMaterialEvents();
    events.push(...secEvents);
  } catch {
    logger.debug('SEC EDGAR fetch failed');
  }

  return events;
}

/**
 * Fetch 8-K filings from SEC EDGAR for material corporate events.
 * 8-K forms are filed for significant events like M&A, leadership changes.
 */
async function fetchSECMaterialEvents(): Promise<CorporateEvent[]> {
  // SEC EDGAR RSS feed for recent 8-K filings
  // Note: This is a simplified implementation - production would need more parsing
  try {
    const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KalshiEdgeDetector/4.0 (research@example.com)',
        'Accept': 'application/atom+xml',
      },
    });

    if (!response.ok) {
      return [];
    }

    const text = await response.text();

    // Parse for key event types from 8-K items
    // Item 1.01 = Material agreement (M&A)
    // Item 2.01 = Acquisition/disposition
    // Item 5.02 = Leadership changes
    const events: CorporateEvent[] = [];

    // Extract ticker and event type from filing titles
    // This is simplified - full implementation would parse XML properly
    const entryPattern = /<entry>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link[^>]*href="([^"]+)"[\s\S]*?<\/entry>/g;
    let match;

    while ((match = entryPattern.exec(text)) !== null) {
      const title = match[1];
      const link = match[2];

      // Extract ticker from title (format: "8-K - TICKER NAME")
      const tickerMatch = title.match(/8-K\s*-\s*([A-Z]{1,5})\s/);
      if (!tickerMatch) continue;

      const ticker = tickerMatch[1];

      // Detect event type from title keywords
      const event = detectEventFromTitle(title, ticker, link);
      if (event) {
        events.push(event);
      }
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Detect corporate event type from SEC filing title.
 */
function detectEventFromTitle(
  title: string,
  ticker: string,
  source: string
): CorporateEvent | null {
  const titleLower = title.toLowerCase();

  // Merger/Acquisition
  if (titleLower.includes('merger') || titleLower.includes('acquisition') || titleLower.includes('business combination')) {
    return {
      ticker,
      company: ticker,
      eventType: 'merger_announced',
      eventDate: new Date().toISOString().split('T')[0],
      description: `M&A activity detected from SEC filing`,
      staleKeywords: [],
      freshKeywords: ['merger', 'acquisition', 'combined company'],
      source,
      earningsImpact: {
        skipEarningsMarkets: false,
        reason: 'M&A may affect future earnings structure',
      },
    };
  }

  // Going private
  if (titleLower.includes('going private') || titleLower.includes('take private') || titleLower.includes('buyout')) {
    return {
      ticker,
      company: ticker,
      eventType: 'going_private',
      eventDate: new Date().toISOString().split('T')[0],
      description: `Going private transaction detected`,
      staleKeywords: ['quarterly earnings', 'guidance', 'analyst'],
      freshKeywords: ['going private', 'buyout'],
      source,
      earningsImpact: {
        skipEarningsMarkets: true,
        reason: 'Company may cease public reporting',
      },
    };
  }

  // CEO change
  if (titleLower.includes('chief executive') || titleLower.includes('ceo') && (titleLower.includes('appoint') || titleLower.includes('resign'))) {
    return {
      ticker,
      company: ticker,
      eventType: 'ceo_change',
      eventDate: new Date().toISOString().split('T')[0],
      description: `CEO change detected`,
      staleKeywords: [],
      freshKeywords: ['new ceo', 'leadership transition', 'strategic review'],
      source,
      earningsImpact: {
        skipEarningsMarkets: false,
        reason: 'CEO change may shift strategic messaging',
      },
    };
  }

  return null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all events for a ticker within a date range.
 */
export function getEventsForTicker(
  data: CorporateEventsData,
  ticker: string,
  daysSince: number = 365
): CorporateEvent[] {
  const events = data.byTicker[ticker.toUpperCase()] ?? [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSince);

  return events.filter(e => new Date(e.eventDate) >= cutoff);
}

/**
 * Check if a company should skip earnings markets due to corporate events.
 */
export function shouldSkipEarningsMarkets(
  data: CorporateEventsData,
  ticker: string
): { skip: boolean; reason?: string } {
  const events = data.byTicker[ticker.toUpperCase()] ?? [];

  // Look for recent events that would invalidate earnings markets
  const recentEvents = events.filter(e => {
    const daysSince = (Date.now() - new Date(e.eventDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 180; // 6 months
  });

  for (const event of recentEvents) {
    if (event.earningsImpact.skipEarningsMarkets) {
      return {
        skip: true,
        reason: event.earningsImpact.reason,
      };
    }
  }

  return { skip: false };
}

/**
 * Get stale keywords for a ticker based on corporate events.
 */
export function getStaleKeywords(
  data: CorporateEventsData,
  ticker: string
): string[] {
  const events = data.byTicker[ticker.toUpperCase()] ?? [];
  const stale = new Set<string>();

  for (const event of events) {
    // Only consider relatively recent events (1 year)
    const daysSince = (Date.now() - new Date(event.eventDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 365) {
      for (const keyword of event.staleKeywords) {
        stale.add(keyword.toLowerCase());
      }
    }
  }

  return Array.from(stale);
}

/**
 * Get fresh/relevant keywords for a ticker based on corporate events.
 */
export function getFreshKeywords(
  data: CorporateEventsData,
  ticker: string
): string[] {
  const events = data.byTicker[ticker.toUpperCase()] ?? [];
  const fresh = new Set<string>();

  for (const event of events) {
    // Only consider recent events (6 months)
    const daysSince = (Date.now() - new Date(event.eventDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 180) {
      for (const keyword of event.freshKeywords) {
        fresh.add(keyword.toLowerCase());
      }
    }
  }

  return Array.from(fresh);
}

/**
 * Check if a specific keyword is stale for a ticker.
 */
export function isKeywordStale(
  data: CorporateEventsData,
  ticker: string,
  keyword: string
): { stale: boolean; reason?: string; event?: CorporateEvent } {
  const staleKeywords = getStaleKeywords(data, ticker);
  const keywordLower = keyword.toLowerCase();

  if (staleKeywords.some(s => keywordLower.includes(s) || s.includes(keywordLower))) {
    const events = data.byTicker[ticker.toUpperCase()] ?? [];
    const relevantEvent = events.find(e =>
      e.staleKeywords.some(s => keywordLower.includes(s.toLowerCase()))
    );

    return {
      stale: true,
      reason: relevantEvent?.description,
      event: relevantEvent,
    };
  }

  return { stale: false };
}
