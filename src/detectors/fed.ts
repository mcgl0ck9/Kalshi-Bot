/**
 * Fed Edge Detector v4.0
 *
 * Detects edges in Federal Reserve related markets by combining multiple signals:
 * 1. Regime bias adjustment - Adjusts FedWatch probabilities based on rate environment
 * 2. Fed speech keyword analysis - Historical word frequency vs market prices
 * 3. Fed nowcasts - GDPNow and inflation nowcast vs macro markets
 *
 * VALIDATED SIGNALS:
 * - Regime-adjusted FedWatch has edge over raw FedWatch (academic research)
 * - Historical keyword frequencies show consistent patterns in Powell's speeches
 * - Fed nowcasts lead official releases by weeks
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Traders using raw FedWatch without bias correction
 * - Why do they lose? They don't know about the academic research on FedWatch biases
 * - Our edge: Information processing advantage from academic research
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import type { FedNowcastData } from '../sources/fed-nowcasts.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.02;           // 2% minimum edge
const MIN_CONFIDENCE = 0.50;
const REGIME_BIAS_MIN_EDGE = 0.02;  // Lower threshold for regime-adjusted signals

// =============================================================================
// TYPES
// =============================================================================

export type RateRegime = 'rising' | 'falling' | 'stable';

interface RegimeAdjustment {
  regime: RateRegime;
  confidence: number;
  reasoning: string;
  cutMultiplier: number;
  holdMultiplier: number;
  hikeMultiplier: number;
}

interface FedKeywordFrequency {
  frequency: number;     // 0-1 probability of being said
  confidence: number;    // How reliable is this estimate
  contextual: boolean;   // Does it depend on current events?
  contextKeywords?: string[];  // Keywords in news that increase probability
}

// =============================================================================
// FED RATE HISTORY
// =============================================================================

const FED_RATE_HISTORY: Array<{ date: string; rate: number; action: 'cut' | 'hike' | 'hold' }> = [
  { date: '2024-12-18', rate: 4.50, action: 'cut' },    // -25bp
  { date: '2024-11-07', rate: 4.75, action: 'cut' },    // -25bp
  { date: '2024-09-18', rate: 5.00, action: 'cut' },    // -50bp
  { date: '2024-07-31', rate: 5.50, action: 'hold' },
  { date: '2024-06-12', rate: 5.50, action: 'hold' },
  { date: '2024-05-01', rate: 5.50, action: 'hold' },
  { date: '2024-03-20', rate: 5.50, action: 'hold' },
  { date: '2024-01-31', rate: 5.50, action: 'hold' },
  { date: '2023-12-13', rate: 5.50, action: 'hold' },
  { date: '2023-11-01', rate: 5.50, action: 'hold' },
  { date: '2023-09-20', rate: 5.50, action: 'hold' },
  { date: '2023-07-26', rate: 5.50, action: 'hike' },   // +25bp
];

// =============================================================================
// REGIME BIAS ADJUSTMENTS
// =============================================================================

const REGIME_BIAS_ADJUSTMENTS = {
  rising: {
    // In rising rate environments, FedWatch OVERPREDICTS cuts
    cutMultiplier: 0.85,     // Reduce cut prob by 15%
    holdMultiplier: 1.05,    // Slight increase to hold
    hikeMultiplier: 1.15,    // Increase hike prob by 15%
  },
  falling: {
    // In falling rate environments, FedWatch UNDERPREDICTS cuts
    cutMultiplier: 1.10,     // Increase cut prob by 10%
    holdMultiplier: 0.95,    // Slight decrease to hold
    hikeMultiplier: 0.85,    // Reduce hike prob
  },
  stable: {
    cutMultiplier: 1.0,
    holdMultiplier: 1.0,
    hikeMultiplier: 1.0,
  },
};

// =============================================================================
// KEYWORD FREQUENCIES
// Based on analysis of 20+ FOMC press conference transcripts (2023-2025)
// =============================================================================

const KEYWORD_FREQUENCIES: Record<string, FedKeywordFrequency> = {
  // NEAR CERTAINTIES (95%+)
  'good afternoon': { frequency: 0.99, confidence: 0.99, contextual: false },
  'expectation': { frequency: 0.98, confidence: 0.95, contextual: false },
  'expectations': { frequency: 0.98, confidence: 0.95, contextual: false },
  'balance of risk': { frequency: 0.95, confidence: 0.90, contextual: false },
  'balance of risks': { frequency: 0.95, confidence: 0.90, contextual: false },

  // HIGH PROBABILITY (80-95%)
  'unchanged': { frequency: 0.92, confidence: 0.85, contextual: false },
  'uncertainty': { frequency: 0.88, confidence: 0.85, contextual: false },
  'restrictive': { frequency: 0.85, confidence: 0.85, contextual: false },
  'projection': { frequency: 0.85, confidence: 0.80, contextual: false },
  'projections': { frequency: 0.85, confidence: 0.80, contextual: false },
  'median': { frequency: 0.80, confidence: 0.80, contextual: false },

  // MEDIUM-HIGH (70-80%)
  'ai': { frequency: 0.80, confidence: 0.75, contextual: true,
          contextKeywords: ['artificial intelligence', 'technology', 'productivity', 'automation'] },
  'artificial intelligence': { frequency: 0.75, confidence: 0.75, contextual: true,
                               contextKeywords: ['ai', 'technology', 'productivity'] },

  // CONTEXT-DEPENDENT (50-70%)
  'tariff': { frequency: 0.70, confidence: 0.70, contextual: true,
              contextKeywords: ['trade', 'import', 'china', 'policy', 'duties'] },
  'tariffs': { frequency: 0.70, confidence: 0.70, contextual: true,
               contextKeywords: ['trade', 'import', 'china', 'policy', 'duties'] },
  'tariff inflation': { frequency: 0.65, confidence: 0.70, contextual: true,
                        contextKeywords: ['trade', 'import', 'tariff', 'price'] },
  'pandemic': { frequency: 0.55, confidence: 0.75, contextual: false },
  'softening': { frequency: 0.55, confidence: 0.70, contextual: false },
  'shutdown': { frequency: 0.50, confidence: 0.65, contextual: true,
                contextKeywords: ['government', 'congress', 'budget', 'debt ceiling'] },
  'credit': { frequency: 0.55, confidence: 0.70, contextual: false },

  // MEDIUM PROBABILITY (30-50%)
  'probability': { frequency: 0.35, confidence: 0.70, contextual: false },
  'recession': { frequency: 0.30, confidence: 0.75, contextual: true,
                 contextKeywords: ['downturn', 'contraction', 'growth', 'slowdown'] },
  'tax': { frequency: 0.28, confidence: 0.65, contextual: true,
           contextKeywords: ['fiscal', 'policy', 'spending', 'government'] },
  'volatility': { frequency: 0.28, confidence: 0.65, contextual: true,
                  contextKeywords: ['market', 'financial', 'conditions'] },

  // LOW-MEDIUM (15-30%)
  'yield curve': { frequency: 0.18, confidence: 0.70, contextual: true,
                   contextKeywords: ['inversion', 'treasury', 'spread'] },
  'egg': { frequency: 0.15, confidence: 0.70, contextual: true,
           contextKeywords: ['food', 'price', 'inflation', 'grocery'] },

  // LOW PROBABILITY (<15%)
  'soft landing': { frequency: 0.10, confidence: 0.75, contextual: true },
  'stagflation': { frequency: 0.08, confidence: 0.80, contextual: true },
  'bitcoin': { frequency: 0.08, confidence: 0.85, contextual: true,
               contextKeywords: ['crypto', 'cryptocurrency', 'digital'] },
  'trump': { frequency: 0.05, confidence: 0.90, contextual: false },
  'trade war': { frequency: 0.05, confidence: 0.80, contextual: true },
  'pardon': { frequency: 0.03, confidence: 0.95, contextual: false },
};

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'fed',
  description: 'Detects edges in Federal Reserve related markets',
  sources: ['kalshi', 'fed-nowcasts'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    const fedNowcasts = data['fed-nowcasts'] as FedNowcastData | undefined;

    // Filter to Fed-related markets
    const fedMarkets = markets.filter(m => isFedMarket(m));

    if (fedMarkets.length === 0) {
      logger.debug('Fed detector: No Fed markets found');
      return edges;
    }

    logger.info(`Fed detector: Analyzing ${fedMarkets.length} Fed markets`);

    // Get current regime for regime bias adjustments
    const regime = detectRateRegime();

    for (const market of fedMarkets) {
      // Try regime bias edge (for rate decision markets)
      const regimeEdge = analyzeRegimeBiasEdge(market, regime);
      if (regimeEdge) {
        edges.push(regimeEdge);
      }

      // Try Fed speech keyword edge (for mention markets)
      const keywordEdge = analyzeFedSpeechEdge(market);
      if (keywordEdge) {
        edges.push(keywordEdge);
      }

      // Try nowcast edge (for GDP/inflation markets)
      if (fedNowcasts) {
        const nowcastEdge = analyzeNowcastEdge(market, fedNowcasts);
        if (nowcastEdge) {
          edges.push(nowcastEdge);
        }
      }
    }

    if (edges.length > 0) {
      logger.info(`Fed detector: Found ${edges.length} edges`);
    }

    return edges;
  },
});

// =============================================================================
// MARKET CLASSIFICATION
// =============================================================================

function isFedMarket(market: Market): boolean {
  const title = (market.title ?? '').toLowerCase();
  const ticker = (market.ticker ?? market.id ?? '').toLowerCase();

  return (
    title.includes('fed') ||
    title.includes('fomc') ||
    title.includes('rate cut') ||
    title.includes('rate hike') ||
    title.includes('interest rate') ||
    title.includes('powell') ||
    ticker.includes('kxfedmention') ||
    ticker.includes('fomc') ||
    ticker.includes('fed')
  );
}

function isFedRateMarket(market: Market): boolean {
  const title = (market.title ?? '').toLowerCase();
  return (
    title.includes('rate cut') ||
    title.includes('rate hike') ||
    title.includes('rate') && (title.includes('fomc') || title.includes('fed')) ||
    title.includes('hold') && title.includes('rate')
  );
}

function isFedSpeechMarket(market: Market): boolean {
  const title = (market.title ?? '').toLowerCase();
  const ticker = (market.ticker ?? market.id ?? '').toLowerCase();
  return (
    ticker.includes('kxfedmention') ||
    title.includes('powell') && title.includes('say') ||
    title.includes('fed') && title.includes('mention')
  );
}

function isMacroThresholdMarket(market: Market): boolean {
  const title = (market.title ?? '').toLowerCase();
  return (
    title.includes('gdp') ||
    title.includes('cpi') ||
    title.includes('inflation')
  );
}

// =============================================================================
// REGIME DETECTION
// =============================================================================

function detectRateRegime(): RegimeAdjustment {
  const recentActions = FED_RATE_HISTORY.slice(0, 4);

  const cuts = recentActions.filter(a => a.action === 'cut').length;
  const hikes = recentActions.filter(a => a.action === 'hike').length;
  const holds = recentActions.filter(a => a.action === 'hold').length;

  const netDirection = cuts - hikes;

  let regime: RateRegime;
  let confidence: number;
  let reasoning: string;

  if (netDirection >= 2) {
    regime = 'falling';
    confidence = 0.8 + (netDirection * 0.05);
    reasoning = `${cuts} cuts in last 4 meetings indicates falling rate environment`;
  } else if (netDirection <= -2) {
    regime = 'rising';
    confidence = 0.8 + (Math.abs(netDirection) * 0.05);
    reasoning = `${hikes} hikes in last 4 meetings indicates rising rate environment`;
  } else if (holds >= 3) {
    regime = 'stable';
    confidence = 0.7;
    reasoning = `${holds} holds in last 4 meetings indicates stable/uncertain environment`;
  } else {
    regime = 'stable';
    confidence = 0.5;
    reasoning = 'Mixed signals - treating as stable with low confidence';
  }

  const adjustments = REGIME_BIAS_ADJUSTMENTS[regime];

  return {
    regime,
    confidence: Math.min(confidence, 0.95),
    reasoning,
    cutMultiplier: adjustments.cutMultiplier,
    holdMultiplier: adjustments.holdMultiplier,
    hikeMultiplier: adjustments.hikeMultiplier,
  };
}

// =============================================================================
// REGIME BIAS EDGE ANALYSIS
// =============================================================================

function analyzeRegimeBiasEdge(market: Market, regime: RegimeAdjustment): Edge | null {
  if (!isFedRateMarket(market)) return null;

  const title = (market.title ?? '').toLowerCase();
  const marketPrice = market.price;

  // Determine market type and get base probability
  // We'll estimate base probabilities from market price (as proxy for FedWatch)
  // In production, this would use actual FedWatch data from a source

  let adjustedProb: number;
  let rawProb: number;
  let marketType: 'cut' | 'hike' | 'hold';

  if (title.includes('cut') || title.includes('lower')) {
    marketType = 'cut';
    // Use market price as proxy for "raw" FedWatch prob
    rawProb = marketPrice;
    adjustedProb = Math.min(rawProb * regime.cutMultiplier, 0.99);
  } else if (title.includes('hike') || title.includes('raise') || title.includes('increase')) {
    marketType = 'hike';
    rawProb = marketPrice;
    adjustedProb = Math.min(rawProb * regime.hikeMultiplier, 0.99);
  } else if (title.includes('hold') || title.includes('unchanged')) {
    marketType = 'hold';
    rawProb = marketPrice;
    adjustedProb = Math.min(rawProb * regime.holdMultiplier, 0.99);
  } else {
    return null;
  }

  // Normalize adjusted probability
  adjustedProb = Math.max(0.01, Math.min(adjustedProb, 0.99));

  const edge = Math.abs(adjustedProb - marketPrice);

  if (edge < REGIME_BIAS_MIN_EDGE) return null;

  const direction = adjustedProb > marketPrice ? 'YES' : 'NO';

  const reason = `Regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}% conf). ` +
    `${regime.reasoning}. ` +
    `Market prices ${marketType} at ${(marketPrice * 100).toFixed(0)}%, ` +
    `regime-adjusted fair value: ${(adjustedProb * 100).toFixed(0)}%.`;

  const confidence = regime.confidence * Math.min(0.5 + edge, 0.9);

  return createEdge(
    market,
    direction,
    edge,
    confidence,
    reason,
    {
      type: 'fed-regime',
      regime: regime.regime,
      marketType,
      rawProb,
      adjustedProb,
      biasAdjustment: adjustedProb - rawProb,
    }
  );
}

// =============================================================================
// FED SPEECH KEYWORD EDGE ANALYSIS
// =============================================================================

function analyzeFedSpeechEdge(market: Market): Edge | null {
  if (!isFedSpeechMarket(market)) return null;

  const title = market.title ?? '';
  const keyword = extractKeywordFromTitle(title);

  if (!keyword) {
    logger.debug(`Fed: Could not extract keyword from "${title}"`);
    return null;
  }

  const keywordData = KEYWORD_FREQUENCIES[keyword.toLowerCase()];
  if (!keywordData) {
    logger.debug(`Fed: No frequency data for keyword "${keyword}"`);
    return null;
  }

  const marketPrice = market.price;
  const impliedProb = keywordData.frequency;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MIN_EDGE) return null;

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';

  const reason = `"${keyword}" has ${(impliedProb * 100).toFixed(0)}% historical frequency ` +
    `but market prices at ${(marketPrice * 100).toFixed(0)}%. ` +
    `Edge: ${direction === 'YES' ? '+' : '-'}${(edge * 100).toFixed(1)}%.`;

  return createEdge(
    market,
    direction,
    edge,
    keywordData.confidence,
    reason,
    {
      type: 'fed-speech',
      keyword,
      historicalFrequency: impliedProb,
      isContextual: keywordData.contextual,
      contextKeywords: keywordData.contextKeywords,
    }
  );
}

function extractKeywordFromTitle(title: string): string | null {
  // Pattern: "Will Powell say 'X'" or "Fed mention: X"
  const patterns = [
    /say\s+['"]([^'"]+)['"]/i,
    /mention\s+['"]?([^'"?\s]+)/i,
    /['"]([^'"]+)['"]\s+in\s+(?:fomc|fed|press)/i,
    /fed\s+mention[:\s]+['"]?([^'"?\s]+)/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return match[1].toLowerCase().trim();
  }

  // Try to extract from Kalshi ticker format (KXFEDMENTION-XXjan-KEYWORD)
  const tickerMatch = title.match(/KXFEDMENTION[^-]*-([A-Z]+)/i);
  if (tickerMatch) {
    const tickerToKeyword: Record<string, string> = {
      'GOOD': 'good afternoon',
      'EXPE': 'expectation',
      'UNCH': 'unchanged',
      'UNCE': 'uncertainty',
      'REST': 'restrictive',
      'PROJ': 'projection',
      'MEDI': 'median',
      'TARI': 'tariff',
      'TRUM': 'trump',
      'RECE': 'recession',
      'SOFT': 'soft landing',
      'SOFTE': 'softening',
      'SHUT': 'shutdown',
      'PAND': 'pandemic',
      'AI': 'ai',
      'BALA': 'balance of risk',
      'PROB': 'probability',
      'CRED': 'credit',
      'TAX': 'tax',
      'VOLA': 'volatility',
      'YIEL': 'yield curve',
      'STAG': 'stagflation',
      'TRAD': 'trade war',
      'BITC': 'bitcoin',
      'EGG': 'egg',
      'PARD': 'pardon',
    };
    const suffix = tickerMatch[1].toUpperCase();
    if (tickerToKeyword[suffix]) return tickerToKeyword[suffix];
  }

  return null;
}

// =============================================================================
// NOWCAST EDGE ANALYSIS
// =============================================================================

function analyzeNowcastEdge(market: Market, nowcasts: FedNowcastData): Edge | null {
  if (!isMacroThresholdMarket(market)) return null;

  const title = (market.title ?? '').toLowerCase();
  const threshold = extractThresholdFromTitle(title);

  if (threshold === null) return null;

  // Analyze GDP edge
  if (title.includes('gdp') && nowcasts.gdp) {
    return analyzeGDPEdge(market, nowcasts.gdp, threshold);
  }

  // Analyze inflation edge
  if ((title.includes('cpi') || title.includes('inflation')) && nowcasts.inflation) {
    return analyzeInflationEdge(market, nowcasts.inflation, threshold);
  }

  return null;
}

function analyzeGDPEdge(
  market: Market,
  gdp: NonNullable<FedNowcastData['gdp']>,
  threshold: number
): Edge | null {
  const distance = gdp.estimate - threshold;
  const standardError = 0.5;  // Typical GDPNow error

  const zScore = distance / standardError;
  const impliedProb = normalCDF(zScore);

  const marketPrice = market.price;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MIN_EDGE) return null;

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';

  const reason = `GDPNow at ${gdp.estimate.toFixed(1)}% (${gdp.quarter}) vs threshold ${threshold}%. ` +
    `Implied prob: ${(impliedProb * 100).toFixed(0)}% vs market: ${(marketPrice * 100).toFixed(0)}%.`;

  return createEdge(
    market,
    direction,
    edge,
    Math.min(edge * 2, 0.8),
    reason,
    {
      type: 'fed-nowcast',
      indicatorType: 'gdp',
      nowcast: gdp.estimate,
      threshold,
      impliedProb,
    }
  );
}

function analyzeInflationEdge(
  market: Market,
  inflation: NonNullable<FedNowcastData['inflation']>,
  threshold: number
): Edge | null {
  const distance = inflation.headline - threshold;
  const standardError = 0.2;

  const zScore = distance / standardError;
  const impliedProb = normalCDF(zScore);

  const marketPrice = market.price;
  const edge = Math.abs(impliedProb - marketPrice);

  if (edge < MIN_EDGE) return null;

  const direction = impliedProb > marketPrice ? 'YES' : 'NO';

  const reason = `Inflation nowcast at ${inflation.headline.toFixed(2)}% (${inflation.month}) ` +
    `vs threshold ${threshold}%. ` +
    `Implied prob: ${(impliedProb * 100).toFixed(0)}% vs market: ${(marketPrice * 100).toFixed(0)}%.`;

  return createEdge(
    market,
    direction,
    edge,
    Math.min(edge * 2, 0.8),
    reason,
    {
      type: 'fed-nowcast',
      indicatorType: 'cpi',
      nowcast: inflation.headline,
      threshold,
      impliedProb,
    }
  );
}

function extractThresholdFromTitle(title: string): number | null {
  // Pattern: "> X%" or "above X%" or "X% or more"
  const patterns = [
    />\s*(\d+\.?\d*)\s*%/,
    /above\s+(\d+\.?\d*)\s*%/i,
    /(\d+\.?\d*)\s*%\s+or\s+more/i,
    /exceed\s+(\d+\.?\d*)\s*%/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  return null;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Standard normal CDF approximation
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * absZ);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);

  return 0.5 * (1.0 + sign * y);
}
