/**
 * Mentions Edge Detection
 *
 * CORE INSIGHT: Kalshi mentions markets ask "Will Company X mention Keyword Y?"
 * We can analyze historical earnings transcripts and recent executive media
 * to predict the probability of a keyword being mentioned.
 *
 * EXAMPLE:
 * - Market: "Will Constellation Brands mention 'tariffs' in Q2 earnings?"
 * - Market price: 35% YES
 * - Historical data: STZ mentioned "tariffs" in 4 of last 4 quarters (100%)
 * - Recent media: CEO discussed tariffs in Bloomberg interview 2 days ago
 * - Fair value: 85%+
 * - Edge: +50% underpriced
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Traders without access to transcript history
 * - Why do they lose? They're guessing without historical base rates
 * - Our edge: Systematic keyword analysis across 4 quarters + media monitoring
 */

import { logger } from '../utils/index.js';
import type { EdgeOpportunity } from '../types/index.js';

// Import source types
import type { MentionsMarketsData, MentionsMarket, KeywordOption } from '../sources/kalshi-mentions.js';
import type { TranscriptsData, EarningsTranscript } from '../sources/earnings-transcripts.js';
import type { ExecutiveMediaData, MediaAppearance } from '../sources/executive-media.js';
import {
  calculateMentionRate,
  analyzeKeywordTrend,
  getAnalystInterest,
  getKeywordVariants,
} from '../sources/earnings-transcripts.js';
import {
  getCompanyAppearances,
  analyzeKeywordFrequency,
} from '../sources/executive-media.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MentionsEdge {
  // Market info
  market: MentionsMarket;
  keyword: KeywordOption;

  // Historical analysis
  historicalRate: number;       // % of past quarters mentioning keyword
  quartersMentioned: number;
  quartersAnalyzed: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  analystInterest: number;      // How often analysts ask about it

  // Media signals
  recentMediaMentions: number;  // Count in last 14 days
  mediaRecency: number;         // Days since last media mention
  mediaSignal: 'bullish' | 'neutral' | 'bearish';

  // Probability calculation
  marketPrice: number;          // Current YES price
  fairValue: number;            // Our estimated probability
  edge: number;                 // Fair value - market price
  direction: 'BUY YES' | 'BUY NO';

  // Confidence
  confidence: number;
  signalStrength: 'strong' | 'moderate' | 'weak';
  urgency: 'critical' | 'standard' | 'fyi';

  // Reasoning
  reasoning: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Minimum edge to report
  minEdge: 0.10,  // 10%

  // Historical weighting
  baseRateWeight: 0.60,     // 60% from historical base rate
  trendWeight: 0.15,        // 15% from trend direction
  analystWeight: 0.10,      // 10% from analyst interest
  mediaWeight: 0.15,        // 15% from recent media

  // Trend adjustments
  trendBoost: {
    increasing: 0.10,       // +10% if trend is increasing
    stable: 0.00,
    decreasing: -0.10,      // -10% if trend is decreasing
  },

  // Analyst interest boost
  analystInterestThreshold: 0.20,  // >20% questions mention keyword
  analystBoost: 0.05,              // +5% if high analyst interest

  // Media recency boost
  mediaRecencyDays: 14,
  mediaBoostPerMention: 0.03,      // +3% per recent mention
  mediaBoostCap: 0.10,             // Max 10% boost

  // Confidence thresholds
  highConfidenceQuarters: 4,       // Need 4 quarters for high confidence
  strongEdgeThreshold: 0.20,       // 20%+ edge = strong signal
};

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Find edge opportunities in mentions markets.
 */
export async function findMentionsEdges(
  mentionsData: MentionsMarketsData,
  transcriptsData: TranscriptsData,
  mediaData: ExecutiveMediaData
): Promise<MentionsEdge[]> {
  const edges: MentionsEdge[] = [];

  for (const market of mentionsData.markets) {
    // Get historical transcripts for this company
    const companyTranscripts = transcriptsData.byTicker[market.companyTicker] || [];

    // Get recent media for this company
    const companyMedia = getCompanyAppearances(mediaData, market.companyTicker);

    // Analyze each keyword option
    for (const keyword of market.keywords) {
      const edge = analyzeKeywordEdge(
        market,
        keyword,
        companyTranscripts,
        companyMedia
      );

      if (edge && Math.abs(edge.edge) >= CONFIG.minEdge) {
        edges.push(edge);
      }
    }
  }

  // Sort by edge magnitude
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  logger.info(`Found ${edges.length} mentions edges above ${CONFIG.minEdge * 100}%`);

  return edges;
}

/**
 * Analyze edge for a single keyword.
 */
function analyzeKeywordEdge(
  market: MentionsMarket,
  keyword: KeywordOption,
  transcripts: EarningsTranscript[],
  media: MediaAppearance[]
): MentionsEdge | null {
  // Skip if no historical data
  if (transcripts.length === 0) {
    logger.debug(`No transcripts for ${market.companyTicker}`);
    return null;
  }

  // Calculate historical mention rate
  const mentionRate = calculateMentionRate(transcripts, keyword.keyword);
  const trend = analyzeKeywordTrend(transcripts, keyword.keyword);
  const analystInterest = getAnalystInterest(transcripts, keyword.keyword);

  // Analyze recent media
  const mediaAnalysis = analyzeMediaSignal(media, keyword.keyword);

  // Calculate fair value probability
  const fairValue = calculateFairValue({
    baseRate: mentionRate.rate,
    trend,
    analystInterest,
    recentMediaMentions: mediaAnalysis.count,
  });

  // Calculate edge
  const marketPrice = keyword.yesPrice;
  const edge = fairValue - marketPrice;

  // Determine direction
  const direction: 'BUY YES' | 'BUY NO' = edge > 0 ? 'BUY YES' : 'BUY NO';

  // Calculate confidence based on data quality
  const confidence = calculateConfidence({
    quartersAnalyzed: transcripts.length,
    edgeMagnitude: Math.abs(edge),
    mediaSupport: mediaAnalysis.count > 0,
    trendClarity: trend !== 'stable',
  });

  // Determine signal strength
  const signalStrength = getSignalStrength(Math.abs(edge), confidence);

  // Determine urgency based on market close time
  const urgency = getUrgency(market.closeTime);

  // Build reasoning
  const reasoning = buildReasoning({
    market,
    keyword,
    mentionRate,
    trend,
    analystInterest,
    mediaAnalysis,
    fairValue,
    marketPrice,
  });

  return {
    market,
    keyword,
    historicalRate: mentionRate.rate,
    quartersMentioned: mentionRate.count,
    quartersAnalyzed: mentionRate.total,
    trend,
    analystInterest,
    recentMediaMentions: mediaAnalysis.count,
    mediaRecency: mediaAnalysis.daysSinceLast,
    mediaSignal: mediaAnalysis.signal,
    marketPrice,
    fairValue,
    edge,
    direction,
    confidence,
    signalStrength,
    urgency,
    reasoning,
  };
}

// =============================================================================
// FAIR VALUE CALCULATION
// =============================================================================

interface FairValueInputs {
  baseRate: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  analystInterest: number;
  recentMediaMentions: number;
}

function calculateFairValue(inputs: FairValueInputs): number {
  let fairValue = inputs.baseRate;

  // Apply trend adjustment
  fairValue += CONFIG.trendBoost[inputs.trend];

  // Apply analyst interest boost
  if (inputs.analystInterest > CONFIG.analystInterestThreshold) {
    fairValue += CONFIG.analystBoost;
  }

  // Apply media boost (capped)
  const mediaBoost = Math.min(
    inputs.recentMediaMentions * CONFIG.mediaBoostPerMention,
    CONFIG.mediaBoostCap
  );
  fairValue += mediaBoost;

  // Clamp to valid probability range
  fairValue = Math.max(0.05, Math.min(0.95, fairValue));

  return fairValue;
}

// =============================================================================
// MEDIA ANALYSIS
// =============================================================================

interface MediaSignalResult {
  count: number;
  daysSinceLast: number;
  signal: 'bullish' | 'neutral' | 'bearish';
}

function analyzeMediaSignal(
  media: MediaAppearance[],
  keyword: string
): MediaSignalResult {
  const variants = getKeywordVariants(keyword);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.mediaRecencyDays);

  // Find recent media mentioning this keyword
  const recentMentions = media.filter(m => {
    const publishedDate = new Date(m.publishedAt);
    if (publishedDate < cutoff) return false;

    // Check if keyword appears in title, description, or tracked keywords
    const searchText = `${m.title} ${m.description}`.toLowerCase();
    return variants.some(v => searchText.includes(v.toLowerCase())) ||
           m.mentionedKeywords.some(k =>
             variants.some(v => k.toLowerCase().includes(v.toLowerCase()))
           );
  });

  // Calculate days since last mention
  let daysSinceLast = 999;
  if (media.length > 0) {
    const sortedMedia = [...media].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    const lastMention = sortedMedia.find(m => {
      const searchText = `${m.title} ${m.description}`.toLowerCase();
      return variants.some(v => searchText.includes(v.toLowerCase()));
    });
    if (lastMention) {
      daysSinceLast = Math.floor(
        (Date.now() - new Date(lastMention.publishedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
    }
  }

  // Determine signal
  let signal: 'bullish' | 'neutral' | 'bearish' = 'neutral';
  if (recentMentions.length >= 2) {
    signal = 'bullish';  // Multiple recent mentions = likely to mention again
  } else if (recentMentions.length === 0 && daysSinceLast > 90) {
    signal = 'bearish';  // No recent mentions = less likely
  }

  return {
    count: recentMentions.length,
    daysSinceLast,
    signal,
  };
}

// =============================================================================
// CONFIDENCE & STRENGTH
// =============================================================================

interface ConfidenceInputs {
  quartersAnalyzed: number;
  edgeMagnitude: number;
  mediaSupport: boolean;
  trendClarity: boolean;
}

function calculateConfidence(inputs: ConfidenceInputs): number {
  let confidence = 0.5;  // Base confidence

  // More historical data = higher confidence
  if (inputs.quartersAnalyzed >= CONFIG.highConfidenceQuarters) {
    confidence += 0.20;
  } else if (inputs.quartersAnalyzed >= 2) {
    confidence += 0.10;
  }

  // Larger edge = higher confidence
  if (inputs.edgeMagnitude >= CONFIG.strongEdgeThreshold) {
    confidence += 0.15;
  } else if (inputs.edgeMagnitude >= CONFIG.minEdge) {
    confidence += 0.05;
  }

  // Media support = higher confidence
  if (inputs.mediaSupport) {
    confidence += 0.10;
  }

  // Clear trend = higher confidence
  if (inputs.trendClarity) {
    confidence += 0.05;
  }

  return Math.min(0.95, confidence);
}

function getSignalStrength(
  edge: number,
  confidence: number
): 'strong' | 'moderate' | 'weak' {
  if (edge >= CONFIG.strongEdgeThreshold && confidence >= 0.70) {
    return 'strong';
  }
  if (edge >= CONFIG.minEdge && confidence >= 0.50) {
    return 'moderate';
  }
  return 'weak';
}

function getUrgency(closeTime: string): 'critical' | 'standard' | 'fyi' {
  if (!closeTime) return 'standard';

  const close = new Date(closeTime);
  const now = new Date();
  const daysUntilClose = (close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (daysUntilClose <= 3) return 'critical';
  if (daysUntilClose <= 14) return 'standard';
  return 'fyi';
}

// =============================================================================
// REASONING
// =============================================================================

interface ReasoningInputs {
  market: MentionsMarket;
  keyword: KeywordOption;
  mentionRate: { rate: number; count: number; total: number };
  trend: 'increasing' | 'stable' | 'decreasing';
  analystInterest: number;
  mediaAnalysis: MediaSignalResult;
  fairValue: number;
  marketPrice: number;
}

function buildReasoning(inputs: ReasoningInputs): string {
  const parts: string[] = [];

  // Historical base rate
  const pct = (inputs.mentionRate.rate * 100).toFixed(0);
  parts.push(
    `📊 **Historical**: "${inputs.keyword.keyword}" mentioned in ${inputs.mentionRate.count}/${inputs.mentionRate.total} quarters (${pct}%)`
  );

  // Trend
  const trendEmoji = {
    increasing: '📈',
    stable: '➡️',
    decreasing: '📉',
  };
  parts.push(
    `${trendEmoji[inputs.trend]} **Trend**: ${inputs.trend} over recent quarters`
  );

  // Analyst interest
  if (inputs.analystInterest > CONFIG.analystInterestThreshold) {
    const aiPct = (inputs.analystInterest * 100).toFixed(0);
    parts.push(`🎯 **Analyst Interest**: ${aiPct}% of Q&A questions mention this topic`);
  }

  // Media signal
  if (inputs.mediaAnalysis.count > 0) {
    parts.push(
      `📺 **Recent Media**: ${inputs.mediaAnalysis.count} appearances in last ${CONFIG.mediaRecencyDays} days`
    );
  } else if (inputs.mediaAnalysis.daysSinceLast < 999) {
    parts.push(
      `📺 **Media**: Last mention ${inputs.mediaAnalysis.daysSinceLast} days ago`
    );
  }

  // Fair value calculation
  const fvPct = (inputs.fairValue * 100).toFixed(0);
  const mkPct = (inputs.marketPrice * 100).toFixed(0);
  const edgePct = ((inputs.fairValue - inputs.marketPrice) * 100).toFixed(1);
  parts.push(`\n💡 **Fair Value**: ${fvPct}% vs Market ${mkPct}% = **${edgePct}% edge**`);

  return parts.join('\n');
}

// =============================================================================
// EDGE OPPORTUNITY CONVERSION
// =============================================================================

/**
 * Convert MentionsEdge to standard EdgeOpportunity format.
 */
export function toEdgeOpportunity(edge: MentionsEdge): EdgeOpportunity {
  const title = `${edge.market.company}: Will they mention "${edge.keyword.keyword}"?`;

  return {
    market: {
      id: edge.keyword.ticker,
      title,
      ticker: edge.keyword.ticker,
      yes_price: edge.keyword.yesPrice,
      no_price: edge.keyword.noPrice,
      volume: edge.keyword.volume,
      url: edge.keyword.url,
    } as any,
    source: 'earnings',  // Use 'earnings' source type for mentions
    direction: edge.direction,
    edge: Math.abs(edge.edge),
    confidence: edge.confidence,
    urgency: edge.urgency,
    signals: {
      earnings: {
        company: edge.market.company,
        keyword: edge.keyword.keyword,
        impliedProbability: edge.fairValue,
        reasoning: edge.reasoning,
      },
    },
  };
}

/**
 * Find and convert all mentions edges to EdgeOpportunity format.
 */
export async function getMentionsEdgeOpportunities(
  mentionsData: MentionsMarketsData,
  transcriptsData: TranscriptsData,
  mediaData: ExecutiveMediaData
): Promise<EdgeOpportunity[]> {
  const edges = await findMentionsEdges(mentionsData, transcriptsData, mediaData);
  return edges.map(toEdgeOpportunity);
}
