/**
 * Polymarket Data Source
 *
 * Fetches markets from Polymarket's Gamma API and whale conviction data
 * from Goldsky subgraphs. Provides cross-platform matching data.
 */

import { defineSource, type Market, type Category } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const GAMMA_API = 'https://gamma-api.polymarket.com';
const MIN_LIQUIDITY = 5000;  // Minimum liquidity to include

// =============================================================================
// TYPES
// =============================================================================

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  clobTokenIds: string;
  liquidity: string;
  outcomePrices: string;
  volume: string;
  active: boolean;
  closed: boolean;
  slug?: string;
  category?: string;
}

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<Market[]>({
  name: 'polymarket',
  category: 'other',  // Polymarket spans all categories
  cacheTTL: 180,      // 3 minute cache

  async fetch(): Promise<Market[]> {
    const markets: Market[] = [];

    try {
      const response = await fetch(
        `${GAMMA_API}/markets?limit=200&active=true&closed=false`
      );

      if (!response.ok) {
        logger.error(`Gamma API error: ${response.status}`);
        return markets;
      }

      const gammaMarkets = await response.json() as GammaMarket[];

      for (const m of gammaMarkets) {
        // Skip low liquidity
        const liquidity = parseFloat(m.liquidity || '0');
        if (liquidity < MIN_LIQUIDITY) continue;

        // Parse price
        let price = 0;
        try {
          const prices = JSON.parse(m.outcomePrices) as string[];
          price = prices[0] ? parseFloat(prices[0]) : 0;
        } catch {
          continue;
        }

        if (price <= 0 || price >= 1) continue;

        // Parse token ID for matching
        let tokenId: string | undefined;
        try {
          const tokens = JSON.parse(m.clobTokenIds) as string[];
          tokenId = tokens[0];
        } catch {
          // Ignore
        }

        markets.push({
          platform: 'polymarket',
          id: m.id,
          title: m.question,
          category: categorizeMarket(m.question, m.category),
          price,
          volume: parseFloat(m.volume) || 0,
          liquidity,
          url: `https://polymarket.com/event/${m.slug || m.conditionId}`,
          tokenId,
        } as Market & { tokenId?: string });
      }

      logger.info(`Fetched ${markets.length} Polymarket markets via Gamma API`);
    } catch (error) {
      logger.error(`Polymarket fetch error: ${error}`);
    }

    return markets;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Categorize market based on title and Gamma category.
 */
function categorizeMarket(title: string, gammaCategory?: string): Category {
  const t = title.toLowerCase();
  const c = (gammaCategory || '').toLowerCase();

  // Crypto
  if (t.includes('bitcoin') || t.includes('btc') || t.includes('ethereum') ||
      t.includes('eth') || t.includes('crypto') || c.includes('crypto')) {
    return 'crypto';
  }

  // Politics
  if (t.includes('president') || t.includes('election') || t.includes('trump') ||
      t.includes('biden') || t.includes('congress') || t.includes('senate') ||
      c.includes('politic')) {
    return 'politics';
  }

  // Sports
  if (t.includes('nfl') || t.includes('nba') || t.includes('mlb') ||
      t.includes('super bowl') || t.includes('championship') ||
      c.includes('sport')) {
    return 'sports';
  }

  // Entertainment
  if (t.includes('oscar') || t.includes('movie') || t.includes('box office') ||
      t.includes('rotten tomatoes') || c.includes('entertainment')) {
    return 'entertainment';
  }

  // Macro/Economics
  if (t.includes('fed') || t.includes('interest rate') || t.includes('gdp') ||
      t.includes('inflation') || t.includes('cpi') || c.includes('economic')) {
    return 'macro';
  }

  // Health
  if (t.includes('covid') || t.includes('virus') || t.includes('vaccine') ||
      t.includes('disease') || c.includes('health')) {
    return 'health';
  }

  // Weather
  if (t.includes('weather') || t.includes('temperature') || t.includes('hurricane') ||
      t.includes('snow') || c.includes('weather')) {
    return 'weather';
  }

  return 'other';
}
