/**
 * Kalshi MCP Tools
 *
 * Custom MCP tools for agents to query Kalshi market data.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fetchSource } from '../../core/registry.js';
import type { Market, Category } from '../../core/types.js';

export const kalshiMcpServer = createSdkMcpServer({
  name: 'kalshi-tools',
  version: '1.0.0',
  tools: [
    // =========================================================================
    // KALSHI_MARKETS - List markets with filtering
    // =========================================================================
    tool(
      'kalshi_markets',
      'Fetch current Kalshi market prices and metadata. Returns list of markets matching filters.',
      {
        category: z
          .enum(['sports', 'crypto', 'macro', 'politics', 'entertainment', 'health', 'weather', 'other'])
          .optional()
          .describe('Filter by category'),
        search: z
          .string()
          .optional()
          .describe('Search term to filter markets by title or subtitle'),
        min_volume: z
          .number()
          .optional()
          .default(1000)
          .describe('Minimum volume in USD'),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe('Maximum markets to return (max 50)'),
      },
      async ({ category, search, min_volume, limit }) => {
        const markets = (await fetchSource<Market[]>('kalshi')) ?? [];

        let filtered = markets;

        // Filter by category
        if (category) {
          filtered = filtered.filter((m) => m.category === category);
        }

        // Filter by search term
        if (search) {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter(
            (m) =>
              m.title.toLowerCase().includes(searchLower) ||
              (m.subtitle?.toLowerCase().includes(searchLower) ?? false)
          );
        }

        // Filter by volume
        filtered = filtered.filter((m) => (m.volume ?? 0) >= min_volume);

        // Sort by volume descending
        filtered.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

        // Limit results
        const actualLimit = Math.min(limit, 50);
        const result = filtered.slice(0, actualLimit).map((m) => ({
          id: m.id,
          ticker: m.ticker,
          title: m.title,
          subtitle: m.subtitle,
          category: m.category,
          price_cents: Math.round(m.price * 100),
          volume: m.volume,
          url: m.url,
          close_time: m.closeTime,
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total_matches: filtered.length,
                  returned: result.length,
                  markets: result,
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
    // KALSHI_MARKET_DETAIL - Get single market details
    // =========================================================================
    tool(
      'kalshi_market_detail',
      'Get detailed information about a specific Kalshi market by ticker or ID.',
      {
        identifier: z
          .string()
          .describe('Market ticker (e.g., KXBTC-26JAN09-B100500) or market ID'),
      },
      async ({ identifier }) => {
        const markets = (await fetchSource<Market[]>('kalshi')) ?? [];
        const market = markets.find(
          (m) => m.id === identifier || m.ticker === identifier
        );

        if (!market) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: `Market "${identifier}" not found`,
                    suggestion: 'Use kalshi_markets tool to search for markets',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Calculate days to expiry
        const daysToExpiry = market.closeTime
          ? Math.max(
              0,
              (new Date(market.closeTime).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24)
            )
          : null;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: market.id,
                  ticker: market.ticker,
                  title: market.title,
                  subtitle: market.subtitle,
                  category: market.category,
                  platform: market.platform,
                  price_yes_cents: Math.round(market.price * 100),
                  price_no_cents: Math.round((1 - market.price) * 100),
                  volume: market.volume,
                  liquidity: market.liquidity,
                  url: market.url,
                  close_time: market.closeTime,
                  days_to_expiry: daysToExpiry?.toFixed(1),
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
    // KALSHI_CATEGORIES - List categories with market counts
    // =========================================================================
    tool(
      'kalshi_categories',
      'Get summary of market categories and their counts.',
      {},
      async () => {
        const markets = (await fetchSource<Market[]>('kalshi')) ?? [];

        const byCategory: Record<string, { count: number; total_volume: number }> =
          {};

        for (const market of markets) {
          if (!byCategory[market.category]) {
            byCategory[market.category] = { count: 0, total_volume: 0 };
          }
          byCategory[market.category].count++;
          byCategory[market.category].total_volume += market.volume ?? 0;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total_markets: markets.length,
                  categories: byCategory,
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
