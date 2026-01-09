/**
 * Agent Types for Claude Agent SDK Integration
 *
 * Defines types for research and edge detection agents.
 */

import type { Category, Direction, Urgency } from '../core/types.js';

// =============================================================================
// AGENT RESULT TYPES
// =============================================================================

/**
 * Result from the Research Agent's investigation.
 */
export interface AgentResearchResult {
  market_title: string;
  research_summary: string;
  key_findings: string[];
  sentiment_score: number; // -1 to 1
  data_sources: string[];
  confidence: number; // 0 to 1
  recommendation: 'bullish' | 'bearish' | 'neutral';
  reasoning: string;
}

/**
 * Result from the Edge Detection Agent's analysis.
 */
export interface AgentEdgeResult {
  has_edge: boolean;
  market_id: string;
  market_title: string;
  platform: 'kalshi' | 'polymarket';
  current_price: number;
  fair_value_estimate: number;
  edge_size: number;
  direction: Direction;
  confidence: number;
  urgency: Urgency;
  signal_type: AgentSignalType;
  reasoning: string;
  supporting_data: AgentSupportingData;
  suggested_size_pct?: number;
}

export type AgentSignalType =
  | 'cross-platform'
  | 'whale'
  | 'sentiment'
  | 'time-decay'
  | 'combined'
  | 'agent-research';

export interface AgentSupportingData {
  whale_positions?: WhalePosition[];
  sentiment_score?: number;
  cross_platform_diff?: number;
  days_to_expiry?: number;
  news_headlines?: string[];
  polymarket_price?: number;
  research_findings?: string[];
  [key: string]: unknown;
}

export interface WhalePosition {
  address?: string;
  size: number;
  direction: Direction;
  market_id?: string;
}

// =============================================================================
// AGENT CONFIGURATION
// =============================================================================

export interface AgentConfig {
  /** Whether agent detection is enabled */
  enabled: boolean;

  /** Maximum markets to analyze per pipeline run */
  maxMarketsPerRun: number;

  /** Minimum market volume to consider for analysis */
  minMarketVolume: number;

  /** Timeout for agent calls in milliseconds */
  agentTimeoutMs: number;

  /** Cooldown before re-analyzing same market (minutes) */
  cooldownMinutes: number;

  /** Maximum budget per single market analysis (USD) */
  maxBudgetPerAnalysis: number;

  /** Maximum total budget per pipeline run (USD) */
  maxBudgetPerRun: number;

  /** Edge threshold to escalate from Haiku to Sonnet */
  escalationEdgeThreshold: number;

  /** Default model for initial scan */
  defaultModel: 'haiku' | 'sonnet';

  /** Model for deep analysis */
  deepAnalysisModel: 'sonnet' | 'opus';
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  enabled: true,
  maxMarketsPerRun: 10,
  minMarketVolume: 5000,
  agentTimeoutMs: 60000,
  cooldownMinutes: 30,
  maxBudgetPerAnalysis: 0.10,
  maxBudgetPerRun: 1.00,
  escalationEdgeThreshold: 0.08,
  defaultModel: 'haiku',
  deepAnalysisModel: 'sonnet',
};

// =============================================================================
// AGENT SIGNAL FOR EDGE OUTPUT
// =============================================================================

/**
 * Signal data for agent-detected edges.
 * This extends the base EdgeSignal with agent-specific fields.
 */
export interface AgentEdgeSignal {
  type: 'agent';
  signal_type: AgentSignalType;
  model_used: string;
  analysis_time_ms: number;
  supporting_data: AgentSupportingData;
  reasoning: string;
  escalated?: boolean; // True if escalated from Haiku to Sonnet
  [key: string]: unknown; // Index signature for EdgeSignal compatibility
}

// =============================================================================
// MCP TOOL RESPONSE TYPES
// =============================================================================

export interface KalshiMarketsResponse {
  id: string;
  ticker?: string;
  title: string;
  subtitle?: string;
  category: Category;
  price: number;
  volume?: number;
  url: string;
  closeTime?: string;
}

export interface PolymarketResponse {
  id: string;
  title: string;
  price: number;
  volume?: number;
  liquidity?: number;
}

export interface WhalePositionsResponse {
  positions: WhalePosition[];
  total_volume: number;
  dominant_direction: Direction;
  conviction_score: number;
}

export interface NewsSentimentResponse {
  topic: string;
  article_count: number;
  avg_sentiment: number;
  sentiment_label: 'bullish' | 'bearish' | 'neutral';
  recent_headlines: string[];
}
