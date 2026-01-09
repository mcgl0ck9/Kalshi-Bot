/**
 * Agent-Powered Edge Detector
 *
 * Integrates Claude Agent SDK with the v4.0 pipeline.
 * Uses adaptive model selection: Haiku for initial scan, Sonnet for deep analysis.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import { kalshiMcpServer, analysisMcpServer } from './tools/index.js';
import { researchAgentDefinition } from './research-agent.js';
import {
  edgeAgentInitialDefinition,
  edgeAgentDeepDefinition,
} from './edge-agent.js';
import {
  getAgentConfig,
  buildInitialAnalysisPrompt,
  buildDeepAnalysisPrompt,
} from './config.js';
import type { AgentEdgeResult, AgentEdgeSignal } from './types.js';

// =============================================================================
// STATE
// =============================================================================

// Track recently analyzed markets to avoid re-analysis
const recentlyAnalyzed = new Map<string, number>();

// Track budget spent in current run
let runBudgetSpent = 0;

// =============================================================================
// AGENT-POWERED DETECTOR
// =============================================================================

export default defineDetector({
  name: 'agent-edge',
  description: 'Claude Agent-powered deep analysis for edge detection',
  sources: ['kalshi', 'polymarket', 'news'],
  minEdge: 0.05,
  enabled: false, // Disabled until ANTHROPIC_API_KEY is configured

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const config = getAgentConfig();
    const edges: Edge[] = [];

    // Check if agents are enabled
    if (!config.enabled) {
      logger.debug('Agent detector disabled via config');
      return edges;
    }

    // Reset run budget
    runBudgetSpent = 0;

    // Filter to high-priority markets worth agent analysis
    const priorityMarkets = selectPriorityMarkets(markets, config);
    logger.info(
      `Agent detector: Analyzing ${priorityMarkets.length} priority markets`
    );

    for (const market of priorityMarkets) {
      // Check run budget
      if (runBudgetSpent >= config.maxBudgetPerRun) {
        logger.warn(
          `Agent detector: Run budget exhausted ($${runBudgetSpent.toFixed(2)})`
        );
        break;
      }

      try {
        const edge = await analyzeMarketAdaptive(market, config);
        if (edge) {
          edges.push(edge);
          logger.info(
            `Agent found edge: ${market.title} - ${(edge.edge * 100).toFixed(1)}% ${edge.direction}`
          );
        }
      } catch (error) {
        logger.error(`Agent analysis failed for ${market.id}: ${error}`);
      }
    }

    logger.info(
      `Agent detector complete: ${edges.length} edges found, $${runBudgetSpent.toFixed(2)} spent`
    );
    return edges;
  },
});

// =============================================================================
// MARKET SELECTION
// =============================================================================

function selectPriorityMarkets(
  markets: Market[],
  config: ReturnType<typeof getAgentConfig>
): Market[] {
  const now = Date.now();
  const cooldownMs = config.cooldownMinutes * 60 * 1000;

  return markets
    // Filter by volume
    .filter((m) => (m.volume ?? 0) >= config.minMarketVolume)
    // Filter out recently analyzed
    .filter((m) => {
      const lastAnalyzed = recentlyAnalyzed.get(m.id);
      if (lastAnalyzed && now - lastAnalyzed < cooldownMs) {
        return false;
      }
      return true;
    })
    // Prioritize by volume
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    // Take top N
    .slice(0, config.maxMarketsPerRun);
}

// =============================================================================
// ADAPTIVE ANALYSIS
// =============================================================================

async function analyzeMarketAdaptive(
  market: Market,
  config: ReturnType<typeof getAgentConfig>
): Promise<Edge | null> {
  const startTime = Date.now();

  // Mark as analyzed (even if we fail)
  recentlyAnalyzed.set(market.id, Date.now());

  // Phase 1: Initial scan with Haiku
  const initialResult = await runInitialAnalysis(market, config);

  if (!initialResult) {
    return null;
  }

  // If no edge found, stop here
  if (!initialResult.has_edge || initialResult.edge_size < 0.05) {
    logger.debug(`No edge found for ${market.id}`);
    return null;
  }

  // Phase 2: If edge >= threshold, escalate to deep analysis
  let finalResult = initialResult;

  if (initialResult.edge_size >= config.escalationEdgeThreshold) {
    logger.info(
      `Escalating ${market.id} to deep analysis (${(initialResult.edge_size * 100).toFixed(1)}% edge)`
    );

    const deepResult = await runDeepAnalysis(
      market,
      initialResult,
      config
    );

    if (deepResult) {
      finalResult = deepResult;
    }
  }

  // Convert to Edge format
  const elapsed = Date.now() - startTime;

  if (!finalResult.has_edge || finalResult.edge_size < 0.05) {
    return null;
  }

  const signal: AgentEdgeSignal = {
    type: 'agent',
    signal_type: finalResult.signal_type ?? 'agent-research',
    model_used:
      finalResult.edge_size >= config.escalationEdgeThreshold
        ? 'sonnet'
        : 'haiku',
    analysis_time_ms: elapsed,
    supporting_data: finalResult.supporting_data ?? {},
    reasoning: finalResult.reasoning ?? 'Agent-detected edge',
    escalated: finalResult.edge_size >= config.escalationEdgeThreshold,
  };

  return createEdge(
    market,
    finalResult.direction ?? 'YES',
    finalResult.edge_size,
    finalResult.confidence ?? 0.5,
    finalResult.reasoning ?? 'Agent-detected edge',
    signal
  );
}

// =============================================================================
// INITIAL ANALYSIS (HAIKU)
// =============================================================================

async function runInitialAnalysis(
  market: Market,
  config: ReturnType<typeof getAgentConfig>
): Promise<AgentEdgeResult | null> {
  const prompt = buildInitialAnalysisPrompt(
    market.title,
    market.subtitle,
    market.price,
    market.volume,
    market.closeTime
  );

  const options: Options = {
    model: 'claude-haiku-3-5-20241022',
    maxTurns: 5,
    maxBudgetUsd: config.maxBudgetPerAnalysis / 2, // Half budget for initial
    permissionMode: 'dontAsk',
    cwd: process.cwd(),

    // Custom MCP servers
    mcpServers: {
      'kalshi-tools': kalshiMcpServer,
      'analysis-tools': analysisMcpServer,
    },

    // Available agents for sub-tasks
    agents: {
      research: researchAgentDefinition,
      'edge-initial': edgeAgentInitialDefinition,
    },

    // Structured output
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          has_edge: { type: 'boolean' },
          edge_size: { type: 'number' },
          direction: { type: 'string', enum: ['YES', 'NO'] },
          confidence: { type: 'number' },
          urgency: { type: 'string', enum: ['critical', 'standard', 'low'] },
          signal_type: { type: 'string' },
          reasoning: { type: 'string' },
          needs_deep_analysis: { type: 'boolean' },
          supporting_data: { type: 'object' },
        },
        required: ['has_edge', 'reasoning'],
      },
    },
  };

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      config.agentTimeoutMs
    );

    const queryResult = query({
      prompt,
      options: { ...options, abortController },
    });

    let result: AgentEdgeResult | null = null;
    let costUsd = 0;

    for await (const message of queryResult) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = message.structured_output as AgentEdgeResult;
          costUsd = message.total_cost_usd;
        }
      }
    }

    clearTimeout(timeout);
    runBudgetSpent += costUsd;

    return result;
  } catch (error) {
    logger.error(`Initial analysis failed for ${market.id}: ${error}`);
    return null;
  }
}

// =============================================================================
// DEEP ANALYSIS (SONNET)
// =============================================================================

async function runDeepAnalysis(
  market: Market,
  initialResult: AgentEdgeResult,
  config: ReturnType<typeof getAgentConfig>
): Promise<AgentEdgeResult | null> {
  const prompt = buildDeepAnalysisPrompt(
    market.title,
    market.subtitle,
    market.id,
    market.price,
    initialResult.edge_size,
    initialResult.signal_type ?? 'unknown',
    market.closeTime
  );

  const options: Options = {
    model: 'claude-sonnet-4-20250514',
    maxTurns: 8,
    maxBudgetUsd: config.maxBudgetPerAnalysis, // Full budget for deep
    permissionMode: 'dontAsk',
    cwd: process.cwd(),

    // Custom MCP servers
    mcpServers: {
      'kalshi-tools': kalshiMcpServer,
      'analysis-tools': analysisMcpServer,
    },

    // Available agents
    agents: {
      research: researchAgentDefinition,
      'edge-deep': edgeAgentDeepDefinition,
    },

    // Structured output
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          has_edge: { type: 'boolean' },
          market_id: { type: 'string' },
          market_title: { type: 'string' },
          platform: { type: 'string' },
          current_price: { type: 'number' },
          fair_value_estimate: { type: 'number' },
          edge_size: { type: 'number' },
          direction: { type: 'string', enum: ['YES', 'NO'] },
          confidence: { type: 'number' },
          urgency: { type: 'string', enum: ['critical', 'standard', 'low'] },
          signal_type: { type: 'string' },
          reasoning: { type: 'string' },
          supporting_data: { type: 'object' },
          suggested_size_pct: { type: 'number' },
        },
        required: ['has_edge', 'reasoning'],
      },
    },
  };

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      config.agentTimeoutMs * 2 // Double timeout for deep analysis
    );

    const queryResult = query({
      prompt,
      options: { ...options, abortController },
    });

    let result: AgentEdgeResult | null = null;
    let costUsd = 0;

    for await (const message of queryResult) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = message.structured_output as AgentEdgeResult;
          costUsd = message.total_cost_usd;
        }
      }
    }

    clearTimeout(timeout);
    runBudgetSpent += costUsd;

    return result;
  } catch (error) {
    logger.error(`Deep analysis failed for ${market.id}: ${error}`);
    return null;
  }
}

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export { selectPriorityMarkets, analyzeMarketAdaptive };
