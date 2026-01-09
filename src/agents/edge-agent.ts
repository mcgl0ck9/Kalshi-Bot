/**
 * Edge Detection Agent Definition
 *
 * Autonomous agent for analyzing prediction market edges.
 * Two versions: initial (Haiku) and deep analysis (Sonnet).
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  EDGE_AGENT_INITIAL_PROMPT,
  EDGE_AGENT_DEEP_PROMPT,
} from './config.js';

/**
 * Initial Edge Agent - uses Haiku for quick screening.
 * Identifies markets worth deeper analysis.
 */
export const edgeAgentInitialDefinition: AgentDefinition = {
  description:
    'Performs quick screening of markets to identify potential trading edges. Uses cross-platform comparison, sentiment analysis, and whale tracking.',

  model: 'haiku',

  prompt: EDGE_AGENT_INITIAL_PROMPT,

  // Tools for market analysis
  tools: [
    'kalshi_markets',
    'kalshi_market_detail',
    'kalshi_categories',
    'polymarket_data',
    'cross_platform_compare',
    'whale_positions',
    'news_sentiment',
  ],

  // Safety: no system modification tools
  disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
};

/**
 * Deep Edge Agent - uses Sonnet for thorough analysis.
 * Only invoked for markets that pass initial screening (edge >= 8%).
 */
export const edgeAgentDeepDefinition: AgentDefinition = {
  description:
    'Performs deep analysis of markets flagged by initial screening. Validates edges, gathers additional evidence, and calculates position sizing.',

  model: 'sonnet',

  prompt: EDGE_AGENT_DEEP_PROMPT,

  // All analysis tools plus web search
  tools: [
    'kalshi_markets',
    'kalshi_market_detail',
    'kalshi_categories',
    'polymarket_data',
    'cross_platform_compare',
    'whale_positions',
    'news_sentiment',
    'WebSearch',
    'WebFetch',
  ],

  // Safety: no system modification tools
  disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
};

export default edgeAgentInitialDefinition;
