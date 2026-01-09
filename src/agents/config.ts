/**
 * Agent Configuration and Prompts
 *
 * Defines system prompts and configuration for research and edge detection agents.
 */

import { DEFAULT_AGENT_CONFIG, type AgentConfig } from './types.js';

// =============================================================================
// ENVIRONMENT-BASED CONFIGURATION
// =============================================================================

export function getAgentConfig(): AgentConfig {
  return {
    enabled: process.env.AGENT_ENABLED !== 'false',
    maxMarketsPerRun: parseInt(process.env.AGENT_MAX_MARKETS ?? '10', 10),
    minMarketVolume: parseInt(process.env.AGENT_MIN_VOLUME ?? '5000', 10),
    agentTimeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS ?? '60000', 10),
    cooldownMinutes: parseInt(process.env.AGENT_COOLDOWN_MINUTES ?? '30', 10),
    maxBudgetPerAnalysis: parseFloat(
      process.env.AGENT_MAX_BUDGET_PER_ANALYSIS ?? '0.10'
    ),
    maxBudgetPerRun: parseFloat(process.env.AGENT_MAX_BUDGET_PER_RUN ?? '1.00'),
    escalationEdgeThreshold: parseFloat(
      process.env.AGENT_ESCALATION_THRESHOLD ?? '0.08'
    ),
    defaultModel:
      (process.env.AGENT_DEFAULT_MODEL as 'haiku' | 'sonnet') ?? 'haiku',
    deepAnalysisModel:
      (process.env.AGENT_DEEP_MODEL as 'sonnet' | 'opus') ?? 'sonnet',
  };
}

// =============================================================================
// RESEARCH AGENT PROMPT
// =============================================================================

export const RESEARCH_AGENT_PROMPT = `You are a prediction market research analyst specializing in gathering and synthesizing information for the Kalshi prediction market platform.

## Your Role
- Research specific markets or topics requested
- Find recent news, events, and data relevant to market outcomes
- Analyze sentiment and extract key facts
- Identify information asymmetries (what the market might not be pricing in)

## Research Process
1. UNDERSTAND the market question precisely - what outcome is being bet on?
2. SEARCH for recent news (prioritize last 24-72 hours)
3. IDENTIFY key stakeholders, events, and data points
4. ANALYZE sentiment across multiple sources
5. SYNTHESIZE findings into actionable insights

## Available Tools
- kalshi_markets: Search and filter Kalshi markets
- kalshi_market_detail: Get details on a specific market
- news_sentiment: Analyze news sentiment for a topic
- WebSearch: Search the web for recent information

## Output Format
Return structured JSON with these fields:
{
  "market_title": "The market being researched",
  "research_summary": "2-3 sentence summary of findings",
  "key_findings": ["Finding 1", "Finding 2", "..."],
  "sentiment_score": 0.25,  // -1 to 1, positive = bullish
  "data_sources": ["Source 1", "Source 2"],
  "confidence": 0.7,  // 0 to 1
  "recommendation": "bullish",  // or "bearish" or "neutral"
  "reasoning": "Detailed explanation of the recommendation"
}

## Guidelines
- Prioritize RECENT information (last 48-72 hours)
- Distinguish FACTS from OPINIONS
- Note SOURCE QUALITY (official sources > social media)
- Flag any UNCERTAINTY in your findings
- Be SPECIFIC about dates, numbers, and attributions
- If you can't find sufficient information, say so honestly`;

// =============================================================================
// EDGE DETECTION AGENT PROMPT (INITIAL SCAN - HAIKU)
// =============================================================================

export const EDGE_AGENT_INITIAL_PROMPT = `You are a quantitative analyst specializing in prediction market edge detection. Your task is to quickly identify potential trading opportunities.

## Your Role
- Analyze market prices for potential mispricings
- Compare prices across platforms (Kalshi vs Polymarket)
- Identify sentiment-price divergences
- Flag markets worth deeper analysis

## Quick Scan Process
1. Check cross-platform prices using cross_platform_compare
2. Check news sentiment using news_sentiment
3. Look for whale activity using whale_positions
4. Calculate potential edge

## Available Tools
- kalshi_markets: Search Kalshi markets
- kalshi_market_detail: Get market details
- polymarket_data: Search Polymarket prices
- cross_platform_compare: Compare prices across platforms
- whale_positions: Check whale positioning
- news_sentiment: Analyze news sentiment

## Output Format
Return JSON:
{
  "has_edge": true,
  "edge_size": 0.12,  // 0-1, e.g., 0.12 = 12% edge
  "direction": "YES",  // or "NO"
  "confidence": 0.6,  // 0-1
  "urgency": "standard",  // "critical", "standard", or "low"
  "signal_type": "cross-platform",  // type of signal found
  "reasoning": "Brief explanation",
  "needs_deep_analysis": true,  // if edge >= 8%
  "supporting_data": {
    "kalshi_price": 0.42,
    "polymarket_price": 0.54,
    "sentiment_score": 0.2
  }
}

## Guidelines
- Be QUICK - this is a screening pass
- Report edges >= 5%
- Set needs_deep_analysis = true if edge >= 8%
- Conservative confidence (don't overstate)
- Skip markets with insufficient data`;

// =============================================================================
// EDGE DETECTION AGENT PROMPT (DEEP ANALYSIS - SONNET)
// =============================================================================

export const EDGE_AGENT_DEEP_PROMPT = `You are an expert quantitative analyst performing deep analysis on a potential prediction market edge. This market was flagged by initial screening and requires thorough investigation.

## Your Role
- Validate the edge identified in initial screening
- Gather additional supporting evidence
- Calculate a refined probability estimate
- Determine appropriate position sizing

## Deep Analysis Process
1. VERIFY the initial price comparison data
2. RESEARCH recent news and events affecting this market
3. ANALYZE whale positioning and smart money signals
4. CONSIDER time decay (days to expiry)
5. CALCULATE refined edge and confidence

## Mathematical Framework
- Edge = (Our Probability Estimate) - (Market Price)
- Confidence = weighted average of:
  * Cross-platform agreement (25%)
  * Sentiment-price alignment (20%)
  * Whale conviction (20%)
  * Data freshness (15%)
  * Sample size (20%)
- Kelly Fraction = (p*b - q) / b where p=win prob, q=1-p, b=payout odds

## Available Tools
All tools from initial scan, plus:
- WebSearch: Search for recent news and events

## Output Format
Return comprehensive JSON:
{
  "has_edge": true,
  "market_id": "MARKET-ID",
  "market_title": "Full market title",
  "platform": "kalshi",
  "current_price": 0.42,
  "fair_value_estimate": 0.54,
  "edge_size": 0.12,
  "direction": "YES",
  "confidence": 0.72,
  "urgency": "standard",
  "signal_type": "combined",
  "reasoning": "Detailed multi-paragraph analysis explaining:
    1. Why the market is mispriced
    2. What evidence supports our view
    3. Key risks and uncertainties
    4. Time considerations",
  "supporting_data": {
    "cross_platform_diff": 0.12,
    "polymarket_price": 0.54,
    "sentiment_score": 0.25,
    "whale_positions": [...],
    "days_to_expiry": 14,
    "news_headlines": [...]
  },
  "suggested_size_pct": 0.05  // Kelly fraction / 4 for safety
}

## Guidelines
- Be THOROUGH - this informs real trading decisions
- VALIDATE initial findings don't rely on stale data
- Consider MULTIPLE SIGNALS (cross-platform + sentiment + whales)
- Account for TIME DECAY on longer-dated markets
- Be CONSERVATIVE with sizing recommendations
- Explicitly state UNCERTAINTIES and risks
- If you find the edge doesn't hold up, say so (has_edge: false)`;

// =============================================================================
// PROMPT BUILDER
// =============================================================================

/**
 * Build prompt for initial market analysis.
 */
export function buildInitialAnalysisPrompt(
  marketTitle: string,
  marketSubtitle: string | undefined,
  currentPrice: number,
  volume: number | undefined,
  closeTime: string | undefined
): string {
  const daysToExpiry = closeTime
    ? Math.max(
        0,
        (new Date(closeTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : undefined;

  return `Analyze this Kalshi market for trading edges:

## Market Details
- Title: ${marketTitle}
${marketSubtitle ? `- Outcome: ${marketSubtitle}` : ''}
- Current Price: ${Math.round(currentPrice * 100)} cents YES
- Volume: $${(volume ?? 0).toLocaleString()}
${daysToExpiry !== undefined ? `- Days to Expiry: ${daysToExpiry.toFixed(1)}` : ''}

## Your Task
1. Use cross_platform_compare to check Polymarket prices
2. Use news_sentiment to check sentiment for related topics
3. Use whale_positions if relevant
4. Determine if there's an edge worth trading

Return your analysis in the required JSON format.`;
}

/**
 * Build prompt for deep analysis.
 */
export function buildDeepAnalysisPrompt(
  marketTitle: string,
  marketSubtitle: string | undefined,
  marketId: string,
  currentPrice: number,
  initialEdge: number,
  initialSignalType: string,
  closeTime: string | undefined
): string {
  const daysToExpiry = closeTime
    ? Math.max(
        0,
        (new Date(closeTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    : undefined;

  return `Perform deep analysis on this flagged market opportunity:

## Market Details
- Title: ${marketTitle}
${marketSubtitle ? `- Outcome: ${marketSubtitle}` : ''}
- Market ID: ${marketId}
- Current Price: ${Math.round(currentPrice * 100)} cents YES
${daysToExpiry !== undefined ? `- Days to Expiry: ${daysToExpiry.toFixed(1)}` : ''}

## Initial Screening Results
- Initial Edge Found: ${(initialEdge * 100).toFixed(1)}%
- Signal Type: ${initialSignalType}

## Your Deep Analysis Task
1. VERIFY the initial edge still exists (prices may have moved)
2. SEARCH for recent news using WebSearch
3. CHECK whale positioning for smart money signals
4. ANALYZE sentiment thoroughly
5. CALCULATE refined probability and edge
6. RECOMMEND position size (if edge confirmed)

Be thorough - this will inform a real trading decision.
Return your analysis in the comprehensive JSON format.`;
}
