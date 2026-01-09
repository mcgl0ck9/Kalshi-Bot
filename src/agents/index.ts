/**
 * Claude Agent SDK Integration Module
 *
 * Provides autonomous AI agents for research and edge detection
 * in the Kalshi-Bot v4.0 pipeline.
 *
 * @module agents
 */

// =============================================================================
// AGENT DEFINITIONS
// =============================================================================

export { researchAgentDefinition } from './research-agent.js';
export {
  edgeAgentInitialDefinition,
  edgeAgentDeepDefinition,
} from './edge-agent.js';

// =============================================================================
// MCP TOOLS
// =============================================================================

export { kalshiMcpServer, analysisMcpServer } from './tools/index.js';

// =============================================================================
// DETECTOR
// =============================================================================

export { default as agentDetector } from './agent-detector.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

export {
  getAgentConfig,
  buildInitialAnalysisPrompt,
  buildDeepAnalysisPrompt,
  RESEARCH_AGENT_PROMPT,
  EDGE_AGENT_INITIAL_PROMPT,
  EDGE_AGENT_DEEP_PROMPT,
} from './config.js';

// =============================================================================
// TYPES
// =============================================================================

export type {
  AgentResearchResult,
  AgentEdgeResult,
  AgentConfig,
  AgentSignalType,
  AgentSupportingData,
  AgentEdgeSignal,
  WhalePosition,
  KalshiMarketsResponse,
  PolymarketResponse,
  WhalePositionsResponse,
  NewsSentimentResponse,
} from './types.js';

export { DEFAULT_AGENT_CONFIG } from './types.js';
