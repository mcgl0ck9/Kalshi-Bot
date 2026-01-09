/**
 * Analysis MCP Tools
 *
 * Custom MCP tools for agents to access cross-platform data,
 * whale positions, and sentiment analysis.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fetchSource } from '../../core/registry.js';
import type { Market } from '../../core/types.js';

// Type for Polymarket data (matches src/sources/polymarket.ts output)
interface PolymarketData {
  id: string;
  title: string;
  price: number;
  volume?: number;
  liquidity?: number;
  tokenId?: string;
}

// Type for whale data
interface WhaleData {
  positions?: Array<{
    marketId: string;
    address?: string;
    size: number;
    direction: 'YES' | 'NO';
  }>;
}

// Type for news data
interface NewsItem {
  title: string;
  description?: string;
  source: string;
  pubDate?: string;
  sentiment?: number;
}

export const analysisMcpServer = createSdkMcpServer({
  name: 'analysis-tools',
  version: '1.0.0',
  tools: [
    // =========================================================================
    // POLYMARKET_DATA - Cross-platform price comparison
    // =========================================================================
    tool(
      'polymarket_data',
      'Fetch Polymarket prices for cross-platform comparison. Search for markets matching a query.',
      {
        search: z
          .string()
          .describe('Search term to find matching Polymarket markets'),
        limit: z.number().optional().default(10).describe('Max results'),
      },
      async ({ search, limit }) => {
        const polymarkets =
          (await fetchSource<PolymarketData[]>('polymarket')) ?? [];
        const searchLower = search.toLowerCase();

        const matches = polymarkets
          .filter((m) => m.title?.toLowerCase().includes(searchLower))
          .slice(0, limit)
          .map((m) => ({
            id: m.id,
            title: m.title,
            price_yes_cents: Math.round(m.price * 100),
            price_no_cents: Math.round((1 - m.price) * 100),
            volume: m.volume,
            liquidity: m.liquidity,
          }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  query: search,
                  matches_found: matches.length,
                  markets: matches,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    ),

    // =========================================================================
    // CROSS_PLATFORM_COMPARE - Compare Kalshi vs Polymarket prices
    // =========================================================================
    tool(
      'cross_platform_compare',
      'Compare a market across Kalshi and Polymarket to find price discrepancies.',
      {
        search: z
          .string()
          .describe('Search term to match markets (e.g., "Chiefs Super Bowl")'),
      },
      async ({ search }) => {
        const kalshiMarkets = (await fetchSource<Market[]>('kalshi')) ?? [];
        const polymarkets =
          (await fetchSource<PolymarketData[]>('polymarket')) ?? [];

        const searchLower = search.toLowerCase();

        // Find matching Kalshi market
        const kalshiMatch = kalshiMarkets.find(
          (m) =>
            m.title.toLowerCase().includes(searchLower) ||
            (m.subtitle?.toLowerCase().includes(searchLower) ?? false)
        );

        // Find matching Polymarket market
        const polyMatch = polymarkets.find((m) =>
          m.title?.toLowerCase().includes(searchLower)
        );

        if (!kalshiMatch && !polyMatch) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: `No markets found matching "${search}"`,
                    suggestion: 'Try a broader search term',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const kalshiPrice = kalshiMatch?.price ?? null;
        const polyPrice = polyMatch?.price ?? null;
        const priceDiff =
          kalshiPrice !== null && polyPrice !== null
            ? Math.abs(kalshiPrice - polyPrice)
            : null;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  search_query: search,
                  kalshi: kalshiMatch
                    ? {
                        title: kalshiMatch.title,
                        subtitle: kalshiMatch.subtitle,
                        price_yes_cents: Math.round(kalshiMatch.price * 100),
                        volume: kalshiMatch.volume,
                        url: kalshiMatch.url,
                      }
                    : null,
                  polymarket: polyMatch
                    ? {
                        title: polyMatch.title,
                        price_yes_cents: Math.round(polyMatch.price * 100),
                        volume: polyMatch.volume,
                        liquidity: polyMatch.liquidity,
                      }
                    : null,
                  comparison:
                    priceDiff !== null
                      ? {
                          price_difference_cents: Math.round(priceDiff * 100),
                          price_difference_pct: (priceDiff * 100).toFixed(1),
                          cheaper_platform:
                            kalshiPrice! < polyPrice! ? 'kalshi' : 'polymarket',
                          potential_edge: priceDiff >= 0.05,
                        }
                      : null,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    ),

    // =========================================================================
    // WHALE_POSITIONS - Whale position data
    // =========================================================================
    tool(
      'whale_positions',
      'Get Polymarket whale position data to identify smart money signals.',
      {
        market_search: z
          .string()
          .optional()
          .describe('Search for specific market'),
        min_position: z
          .number()
          .optional()
          .default(10000)
          .describe('Minimum position size in USD'),
      },
      async ({ market_search, min_position }) => {
        const whaleData = (await fetchSource<WhaleData>('whale-discovery')) ?? {
          positions: [],
        };

        let positions = whaleData.positions ?? [];

        // Filter by search if provided
        if (market_search) {
          const searchLower = market_search.toLowerCase();
          positions = positions.filter((p) =>
            p.marketId?.toLowerCase().includes(searchLower)
          );
        }

        // Filter by minimum position size
        positions = positions.filter((p) => (p.size ?? 0) >= min_position);

        // Calculate aggregates
        const totalYes = positions
          .filter((p) => p.direction === 'YES')
          .reduce((sum, p) => sum + p.size, 0);

        const totalNo = positions
          .filter((p) => p.direction === 'NO')
          .reduce((sum, p) => sum + p.size, 0);

        const dominantDirection =
          totalYes > totalNo ? 'YES' : totalNo > totalYes ? 'NO' : 'NEUTRAL';

        const conviction =
          totalYes + totalNo > 0
            ? Math.abs(totalYes - totalNo) / (totalYes + totalNo)
            : 0;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  filter: {
                    market_search: market_search ?? 'all',
                    min_position,
                  },
                  summary: {
                    total_positions: positions.length,
                    total_yes_volume: totalYes,
                    total_no_volume: totalNo,
                    dominant_direction: dominantDirection,
                    conviction_score: conviction.toFixed(2),
                  },
                  top_positions: positions.slice(0, 10).map((p) => ({
                    market: p.marketId,
                    size: p.size,
                    direction: p.direction,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    ),

    // =========================================================================
    // NEWS_SENTIMENT - Aggregated news sentiment
    // =========================================================================
    tool(
      'news_sentiment',
      'Get aggregated news sentiment for a topic. Analyzes recent headlines.',
      {
        topic: z
          .string()
          .describe(
            'Topic to analyze (e.g., "Bitcoin", "Fed rates", "Chiefs")'
          ),
        max_articles: z
          .number()
          .optional()
          .default(20)
          .describe('Max articles to analyze'),
      },
      async ({ topic, max_articles }) => {
        const news = (await fetchSource<NewsItem[]>('news')) ?? [];

        // Filter relevant news
        const topicLower = topic.toLowerCase();
        const relevant = news
          .filter(
            (n) =>
              n.title?.toLowerCase().includes(topicLower) ||
              n.description?.toLowerCase().includes(topicLower)
          )
          .slice(0, max_articles);

        // Calculate aggregate sentiment
        const sentiments = relevant
          .map((n) => n.sentiment ?? 0)
          .filter((s) => s !== 0);

        const avgSentiment =
          sentiments.length > 0
            ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
            : 0;

        const sentimentLabel =
          avgSentiment > 0.1
            ? 'bullish'
            : avgSentiment < -0.1
              ? 'bearish'
              : 'neutral';

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  topic,
                  analysis: {
                    articles_found: relevant.length,
                    articles_with_sentiment: sentiments.length,
                    average_sentiment: avgSentiment.toFixed(3),
                    sentiment_label: sentimentLabel,
                  },
                  recent_headlines: relevant.slice(0, 10).map((n) => ({
                    title: n.title,
                    source: n.source,
                    sentiment: n.sentiment?.toFixed(2) ?? 'N/A',
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    ),
  ],
});
