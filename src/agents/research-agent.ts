/**
 * Research Agent Definition
 *
 * Autonomous agent for researching prediction markets.
 * Gathers news, analyzes sentiment, and synthesizes information.
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { RESEARCH_AGENT_PROMPT } from './config.js';

/**
 * Research Agent - uses Haiku for cost-effective research tasks.
 * Can be escalated to Sonnet for complex research if needed.
 */
export const researchAgentDefinition: AgentDefinition = {
  description:
    'Researches prediction markets by gathering news, analyzing sentiment, and finding relevant information that could affect market outcomes. Use this agent when you need to understand a market topic.',

  model: 'haiku',

  prompt: RESEARCH_AGENT_PROMPT,

  // Limited tool access for research
  tools: [
    'kalshi_markets',
    'kalshi_market_detail',
    'kalshi_categories',
    'news_sentiment',
    'WebSearch',
    'WebFetch',
    'Read',
  ],

  // Safety: no system modification tools
  disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
};

export default researchAgentDefinition;
