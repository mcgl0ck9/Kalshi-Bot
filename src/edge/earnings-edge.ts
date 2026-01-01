/**
 * Earnings Call Keyword Edge Detector
 *
 * Analyzes earnings mention markets (e.g., KXEARNINGSMENTION series) to find edges
 * based on keyword likelihood analysis for specific companies.
 *
 * METHODOLOGY:
 * 1. Identify active earnings mention series (EA, Nebius, Albertsons, etc.)
 * 2. Estimate keyword probabilities based on:
 *    - Company sector (gaming, AI, grocery, etc.)
 *    - Recent news about the company
 *    - Common earnings call topics
 * 3. Compare estimated probabilities to market prices
 *
 * EDGE THESIS:
 * - Markets often misprice low-probability events (e.g., "Uber" mention in EA call)
 * - High-probability mentions (e.g., "AI" in any tech call) may be underpriced
 * - Contextual news can significantly increase certain keyword probabilities
 */

import type { Market } from '../types/index.js';
import { logger, kalshiFetchJson } from '../utils/index.js';
import { EDGE_THRESHOLDS } from '../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface EarningsKeywordFrequency {
  frequency: number;     // 0-1 probability of being mentioned
  confidence: number;    // How reliable is this estimate
  contextual: boolean;   // Does it depend on current events?
  contextKeywords?: string[];  // Keywords in news that increase probability
}

export interface CompanySector {
  sector: string;
  keywords: Record<string, EarningsKeywordFrequency>;
}

export interface EarningsEdge {
  market: Market;
  company: string;
  keyword: string;
  marketPrice: number;
  impliedProbability: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
  signalStrength: 'critical' | 'actionable' | 'watchlist';
}

// =============================================================================
// COMPANY PROFILES AND KEYWORD FREQUENCIES
// =============================================================================

// Common abbreviations to full keywords
const KEYWORD_MAP: Record<string, string> = {
  // Common across companies
  'AI': 'artificial intelligence',
  'TARI': 'tariff',
  'RECE': 'recession',
  'ECON': 'economy',
  'INFL': 'inflation',
  'HYPE': 'hype',
  'CASH': 'cash',
  'DIVI': 'dividend',
  'BUYB': 'buyback',
  'ACQU': 'acquisition',
  'COMP': 'competition',
  'GEOP': 'geopolitical',
  'REGU': 'regulation',
  'CRYP': 'crypto',
  'BLOC': 'blockchain',
  'FINT': 'fintech',
  'TRAD': 'trading',
  'PRIV': 'private',
  'HIRI': 'hiring',
  'MA': 'merger',

  // Company-specific
  'UBER': 'uber',
  'META': 'meta',
  'NVID': 'nvidia',
  'KROG': 'kroger',
  'SNAP': 'snap',
  'PROD': 'productivity',
  'PERS': 'personalization',
  'HOLI': 'holiday',
  'DELI': 'delivery',
  'TRAF': 'traffic',
  'GLP': 'glp-1',
  'TRIP': 'triplets',
  'TOKE': 'token',
  'ROBO': 'robotaxi',
  'NEO': 'neo',
  'CLIC': 'click',
  'AETH': 'aetherium',

  // Gaming (EA)
  'SKAT': 'skate',
  'SIMS': 'sims',
  'APEX': 'apex',
  'MOBL': 'mobile',
  'LIVE': 'live service',
  'ENGA': 'engagement',
  'SPFC': 'sports fc',
  'JARE': 'jared isaacman',
  'SAUD': 'saudi arabia',
  'UNDP': 'underperform',
};

// Base keyword frequencies by sector
const SECTOR_KEYWORDS: Record<string, Record<string, EarningsKeywordFrequency>> = {
  gaming: {
    'mobile': { frequency: 0.85, confidence: 0.80, contextual: false },
    'live service': { frequency: 0.90, confidence: 0.85, contextual: false },
    'engagement': { frequency: 0.85, confidence: 0.80, contextual: false },
    'artificial intelligence': { frequency: 0.75, confidence: 0.70, contextual: true,
      contextKeywords: ['ai', 'machine learning', 'generative'] },
    'acquisition': { frequency: 0.40, confidence: 0.65, contextual: true,
      contextKeywords: ['buy', 'acquire', 'merge', 'studio'] },
    'competition': { frequency: 0.60, confidence: 0.70, contextual: false },
    'tariff': { frequency: 0.15, confidence: 0.75, contextual: true,
      contextKeywords: ['china', 'trade', 'import'] },
    'recession': { frequency: 0.20, confidence: 0.70, contextual: true,
      contextKeywords: ['downturn', 'slowdown', 'consumer'] },
    'saudi arabia': { frequency: 0.10, confidence: 0.80, contextual: true,
      contextKeywords: ['saudi', 'investment', 'gaming'] },
    'jared isaacman': { frequency: 0.02, confidence: 0.95, contextual: false },
    'underperform': { frequency: 0.08, confidence: 0.85, contextual: false },

    // EA-specific games
    'skate': { frequency: 0.70, confidence: 0.75, contextual: true,
      contextKeywords: ['skate', 'skateboard', 'release'] },
    'sims': { frequency: 0.75, confidence: 0.80, contextual: false },
    'apex': { frequency: 0.85, confidence: 0.85, contextual: false },
    'sports fc': { frequency: 0.90, confidence: 0.85, contextual: false },  // EA Sports FC is flagship
  },

  ai_infrastructure: {
    'artificial intelligence': { frequency: 0.95, confidence: 0.90, contextual: false },
    'nvidia': { frequency: 0.80, confidence: 0.75, contextual: true,
      contextKeywords: ['gpu', 'chip', 'hardware'] },
    'meta': { frequency: 0.65, confidence: 0.70, contextual: true,
      contextKeywords: ['facebook', 'llama', 'ai customer'] },
    'uber': { frequency: 0.55, confidence: 0.70, contextual: true,
      contextKeywords: ['uber', 'rideshare', 'customer'] },
    'hype': { frequency: 0.40, confidence: 0.65, contextual: false },
    'cash': { frequency: 0.75, confidence: 0.75, contextual: false },
    'token': { frequency: 0.45, confidence: 0.65, contextual: true,
      contextKeywords: ['crypto', 'blockchain', 'token'] },
    'robotaxi': { frequency: 0.50, confidence: 0.70, contextual: true,
      contextKeywords: ['autonomous', 'self-driving', 'robotaxi'] },
    'click': { frequency: 0.30, confidence: 0.70, contextual: false },
    'tariff': { frequency: 0.35, confidence: 0.70, contextual: true,
      contextKeywords: ['china', 'trade', 'russia'] },
    // Nebius-specific (Yandex spinoff)
    'triplets': { frequency: 0.08, confidence: 0.85, contextual: false },
    'neo': { frequency: 0.15, confidence: 0.75, contextual: false },
    'aetherium': { frequency: 0.12, confidence: 0.80, contextual: false },
  },

  grocery: {
    'inflation': { frequency: 0.85, confidence: 0.85, contextual: false },
    'economy': { frequency: 0.80, confidence: 0.80, contextual: false },
    'tariff': { frequency: 0.70, confidence: 0.75, contextual: true,
      contextKeywords: ['china', 'trade', 'import'] },
    'holiday': { frequency: 0.75, confidence: 0.80, contextual: true,
      contextKeywords: ['thanksgiving', 'christmas', 'holiday season'] },
    'delivery': { frequency: 0.80, confidence: 0.80, contextual: false },
    'traffic': { frequency: 0.70, confidence: 0.75, contextual: false },
    'personalization': { frequency: 0.55, confidence: 0.70, contextual: false },
    'productivity': { frequency: 0.60, confidence: 0.70, contextual: false },
    'artificial intelligence': { frequency: 0.65, confidence: 0.70, contextual: true,
      contextKeywords: ['ai', 'automation', 'technology'] },
    'glp-1': { frequency: 0.45, confidence: 0.70, contextual: true,
      contextKeywords: ['ozempic', 'wegovy', 'weight loss', 'glp'] },
    'uber': { frequency: 0.40, confidence: 0.65, contextual: true,
      contextKeywords: ['uber', 'instacart', 'delivery'] },
    'snap': { frequency: 0.15, confidence: 0.75, contextual: false },
    'dividend': { frequency: 0.60, confidence: 0.75, contextual: false },
    // Kroger merger specific
    'kroger': { frequency: 0.90, confidence: 0.90, contextual: true,
      contextKeywords: ['kroger', 'merger', 'acquisition', 'ftc'] },
  },

  fintech: {
    'trading': { frequency: 0.90, confidence: 0.85, contextual: false },
    'regulation': { frequency: 0.75, confidence: 0.80, contextual: true,
      contextKeywords: ['sec', 'regulator', 'compliance'] },
    'recession': { frequency: 0.55, confidence: 0.75, contextual: true,
      contextKeywords: ['downturn', 'slowdown'] },
    'tariff': { frequency: 0.65, confidence: 0.75, contextual: true,
      contextKeywords: ['china', 'trade'] },
    'inflation': { frequency: 0.70, confidence: 0.75, contextual: false },
    'crypto': { frequency: 0.60, confidence: 0.75, contextual: true,
      contextKeywords: ['bitcoin', 'crypto', 'digital asset'] },
    'blockchain': { frequency: 0.40, confidence: 0.70, contextual: true,
      contextKeywords: ['blockchain', 'defi'] },
    'fintech': { frequency: 0.55, confidence: 0.70, contextual: false },
    'private': { frequency: 0.65, confidence: 0.70, contextual: false },
    'hiring': { frequency: 0.50, confidence: 0.70, contextual: false },
    'geopolitical': { frequency: 0.55, confidence: 0.70, contextual: true,
      contextKeywords: ['russia', 'china', 'war', 'sanction'] },
    'merger': { frequency: 0.35, confidence: 0.70, contextual: true,
      contextKeywords: ['merger', 'acquisition', 'deal'] },
    'buyback': { frequency: 0.60, confidence: 0.75, contextual: false },
  },
};

// Map company tickers to sectors
const COMPANY_SECTORS: Record<string, { sector: string; name: string }> = {
  'KXEARNINGSMENTIONEA': { sector: 'gaming', name: 'EA' },
  'KXEARNINGSMENTIONNBIS': { sector: 'ai_infrastructure', name: 'Nebius' },
  'KXEARNINGSMENTIONACI': { sector: 'grocery', name: 'Albertsons' },
  'KXEARNINGSMENTIONJPM': { sector: 'fintech', name: 'JPMorgan' },
  'KXEARNINGSMENTIONINTC': { sector: 'ai_infrastructure', name: 'Intel' },
  'KXEARNINGSMENTIONTSLA': { sector: 'ai_infrastructure', name: 'Tesla' },
  'KXEARNINGSMENTIONUBER': { sector: 'ai_infrastructure', name: 'Uber' },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract company ticker from series ticker
 * E.g., KXEARNINGSMENTIONEA-25OCT28-SKAT -> KXEARNINGSMENTIONEA
 */
function extractSeriesTicker(ticker: string): string | null {
  const match = ticker.match(/^(KXEARNINGSMENTION[A-Z]+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract keyword abbreviation from market ticker
 * E.g., KXEARNINGSMENTIONEA-25OCT28-SKAT -> SKAT
 */
function extractKeywordAbbr(ticker: string): string | null {
  const match = ticker.match(/-([A-Z]+)$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Map abbreviation to full keyword
 */
function abbrevToKeyword(abbrev: string): string {
  return KEYWORD_MAP[abbrev.toUpperCase()] ?? abbrev.toLowerCase();
}

/**
 * Calculate context boost based on recent news
 */
function calculateContextBoost(
  contextKeywords: string[] | undefined,
  recentHeadlines: string[]
): number {
  if (!contextKeywords || contextKeywords.length === 0) return 0;
  if (recentHeadlines.length === 0) return 0;

  const combinedText = recentHeadlines.join(' ').toLowerCase();
  let matchCount = 0;

  for (const keyword of contextKeywords) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchCount++;
    }
  }

  // Boost probability based on matches (max +20%)
  if (matchCount >= 3) return 0.20;
  if (matchCount >= 2) return 0.12;
  if (matchCount >= 1) return 0.06;
  return 0;
}

/**
 * Generate human-readable reasoning
 */
function generateReasoning(
  company: string,
  keyword: string,
  marketPrice: number,
  impliedProbability: number,
  edge: number
): string {
  const pricePct = (marketPrice * 100).toFixed(0);
  const impliedPct = (impliedProbability * 100).toFixed(0);
  const edgePct = Math.abs(edge * 100).toFixed(1);

  if (edge > 0) {
    return `"${keyword}" has ${impliedPct}% probability in ${company} call but trades at ${pricePct}¢. ` +
           `Edge: +${edgePct}% → BUY YES`;
  } else {
    return `"${keyword}" has ${impliedPct}% probability in ${company} call but trades at ${pricePct}¢. ` +
           `Market overpriced by ${edgePct}% → BUY NO`;
  }
}

// =============================================================================
// MAIN EDGE DETECTION
// =============================================================================

/**
 * Find edges in earnings mention markets
 *
 * @param recentHeadlines - Optional recent news headlines for context adjustment
 */
export async function findEarningsEdges(
  recentHeadlines: string[] = []
): Promise<EarningsEdge[]> {
  const edges: EarningsEdge[] = [];

  try {
    // Fetch all series
    const seriesData = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
      '/trade-api/v2/series?limit=500'
    );

    if (!seriesData) {
      logger.warn('Failed to fetch series for earnings markets');
      return [];
    }

    const allSeries = seriesData.series ?? [];

    // Find earnings mention series
    const earningsSeries = allSeries.filter(s =>
      s.ticker?.toUpperCase().includes('KXEARNINGSMENTION')
    );

    if (earningsSeries.length === 0) {
      logger.debug('No earnings mention series found');
      return [];
    }

    logger.info(`Analyzing ${earningsSeries.length} earnings mention series`);

    // Process each series
    for (const series of earningsSeries) {
      const seriesTicker = series.ticker.toUpperCase();
      const companyInfo = COMPANY_SECTORS[seriesTicker];

      if (!companyInfo) {
        logger.debug(`Unknown company for series: ${seriesTicker}`);
        // Use default sector for unknown companies
      }

      const sector = companyInfo?.sector ?? 'fintech';  // Default to fintech
      const companyName = companyInfo?.name ?? series.title;
      const sectorKeywords = SECTOR_KEYWORDS[sector] ?? SECTOR_KEYWORDS.fintech;

      // Fetch markets for this series
      try {
        const data = await kalshiFetchJson<{ markets?: unknown[] }>(
          `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=100`
        );

        if (!data) continue;
        const markets = data.markets ?? [];

        for (const m of markets) {
          const market = m as Record<string, unknown>;
          const status = market.status as string ?? '';
          if (status !== 'active') continue;

          const ticker = (market.ticker as string) ?? '';
          const yesPrice = (market.yes_bid as number) ?? (market.last_price as number) ?? 0;

          // Extract keyword
          const keywordAbbr = extractKeywordAbbr(ticker);
          if (!keywordAbbr) continue;

          const keyword = abbrevToKeyword(keywordAbbr);
          const freqData = sectorKeywords[keyword];

          if (!freqData) {
            // Unknown keyword - assume low probability
            logger.debug(`Unknown keyword "${keyword}" for ${companyName}`);
            continue;
          }

          // Adjust frequency based on context
          let adjustedFrequency = freqData.frequency;
          if (freqData.contextual && recentHeadlines.length > 0) {
            const contextBoost = calculateContextBoost(freqData.contextKeywords, recentHeadlines);
            adjustedFrequency = Math.min(0.95, adjustedFrequency + contextBoost);
            if (contextBoost > 0) {
              logger.debug(`Context boost for "${keyword}" in ${companyName}: +${(contextBoost * 100).toFixed(0)}%`);
            }
          }

          // Calculate edge
          const marketPrice = yesPrice / 100;  // Kalshi prices are in cents
          const edge = adjustedFrequency - marketPrice;

          // Only surface significant edges (>2%)
          if (Math.abs(edge) < 0.02) continue;

          // Determine signal strength
          let signalStrength: 'critical' | 'actionable' | 'watchlist';
          const absEdge = Math.abs(edge);
          if (absEdge >= EDGE_THRESHOLDS.critical) {
            signalStrength = 'critical';
          } else if (absEdge >= EDGE_THRESHOLDS.actionable) {
            signalStrength = 'actionable';
          } else {
            signalStrength = 'watchlist';
          }

          const title = market.title as string ?? '';
          const subtitle = market.subtitle as string ?? '';

          edges.push({
            market: {
              platform: 'kalshi' as const,
              id: ticker,
              ticker,
              title: subtitle ? `${title} ${subtitle}` : title,
              description: market.rules_primary as string,
              category: 'other',
              price: marketPrice,
              volume: (market.volume as number) ?? 0,
              volume24h: (market.volume_24h as number) ?? 0,
              liquidity: (market.open_interest as number) ?? 0,
              url: `https://kalshi.com/markets/${series.ticker.toLowerCase()}/${ticker.toLowerCase()}`,
              closeTime: market.close_time as string,
            },
            company: companyName,
            keyword,
            marketPrice,
            impliedProbability: adjustedFrequency,
            edge,
            direction: edge > 0 ? 'buy_yes' : 'buy_no',
            confidence: freqData.confidence,
            reasoning: generateReasoning(companyName, keyword, marketPrice, adjustedFrequency, edge),
            signalStrength,
          });
        }
      } catch (e) {
        logger.debug(`Error fetching markets for ${series.ticker}: ${e}`);
      }
    }

    // Sort by absolute edge size
    edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

    if (edges.length > 0) {
      logger.info(`Found ${edges.length} earnings mention edges`);
    }

    return edges;
  } catch (error) {
    logger.error(`Earnings edge detection error: ${error}`);
    return [];
  }
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format earnings edge for Discord
 */
export function formatEarningsEdge(edge: EarningsEdge): string {
  const emoji = edge.direction === 'buy_yes' ? '🟢' : '🔴';
  const actionEmoji = edge.signalStrength === 'critical' ? '🔥' : edge.signalStrength === 'actionable' ? '⚡' : '👀';

  const lines = [
    `${actionEmoji} **Earnings Edge: ${edge.company} - "${edge.keyword}"**`,
    '',
    `${emoji} **Action:** ${edge.direction.toUpperCase().replace('_', ' ')} @ ${(edge.marketPrice * 100).toFixed(0)}¢`,
    '',
    `📊 **Implied Probability:** ${(edge.impliedProbability * 100).toFixed(0)}%`,
    `💰 **Market Price:** ${(edge.marketPrice * 100).toFixed(0)}¢`,
    `📈 **Edge:** ${edge.edge > 0 ? '+' : ''}${(edge.edge * 100).toFixed(1)}%`,
    `🎯 **Confidence:** ${(edge.confidence * 100).toFixed(0)}%`,
    '',
    `**Reasoning:** ${edge.reasoning}`,
    '',
    `[>>> TRADE <<<](${edge.market.url})`,
  ];

  return lines.join('\n');
}

/**
 * Format summary of earnings edges
 */
export function formatEarningsEdgesSummary(edges: EarningsEdge[]): string {
  if (edges.length === 0) {
    return 'No earnings mention edges found.';
  }

  // Group by company
  const byCompany = new Map<string, EarningsEdge[]>();
  for (const edge of edges) {
    const list = byCompany.get(edge.company) ?? [];
    list.push(edge);
    byCompany.set(edge.company, list);
  }

  const lines = [
    '**📊 Earnings Call Keyword Edges**',
    '',
  ];

  for (const [company, companyEdges] of byCompany) {
    lines.push(`**${company}:**`);

    for (const edge of companyEdges.slice(0, 5)) {
      const emoji = edge.direction === 'buy_yes' ? '🟢' : '🔴';
      const signalEmoji = edge.signalStrength === 'critical' ? '🔥' : edge.signalStrength === 'actionable' ? '⚡' : '👀';
      const edgeStr = edge.edge > 0 ? `+${(edge.edge * 100).toFixed(0)}%` : `${(edge.edge * 100).toFixed(0)}%`;

      lines.push(
        `  ${signalEmoji} "${edge.keyword}" ${emoji} ${edge.direction.split('_')[1].toUpperCase()} @ ${(edge.marketPrice * 100).toFixed(0)}¢ | Edge: ${edgeStr}`
      );
    }

    if (companyEdges.length > 5) {
      lines.push(`  _...and ${companyEdges.length - 5} more_`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
