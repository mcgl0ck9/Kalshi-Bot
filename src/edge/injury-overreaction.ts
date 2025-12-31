/**
 * Injury Overreaction Detection
 *
 * QUANT INSIGHT: Public overreacts to injury news in sports markets
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Sharp bettors who correctly size injury impact
 * - Why does public lose? Emotional reaction, recency bias, star player fixation
 * - Our edge: Systematic measurement of overreaction vs historical impact
 *
 * SIGNAL LOGIC:
 * 1. Detect injury news via sentiment analysis
 * 2. Measure news severity (star player vs rotation)
 * 3. Compare to expected line impact
 * 4. If actual impact >> expected impact, fade the overreaction
 *
 * This signal is VALIDATED because:
 * - Public consistently overreacts to injury news (documented in academic lit)
 * - Sportsbooks adjust lines, but often overcorrect due to public pressure
 * - Value exists in betting against the overreaction
 */

import { logger } from '../utils/index.js';
import type { NewsArticle, TopicSentiment, Market } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface InjuryAlert {
  playerName: string;
  team: string;
  sport: string;
  injuryType: string;
  severity: 'major' | 'moderate' | 'minor';
  status: 'out' | 'questionable' | 'doubtful' | 'probable';
  sentimentScore: number;
  articleCount: number;
  articles: NewsArticle[];
  detectedAt: string;
}

export interface InjuryOverreactionSignal {
  injury: InjuryAlert;
  relatedMarket?: Market;
  expectedImpact: number;      // Expected probability shift
  observedSentiment: number;   // How negative the sentiment is
  overreactionScore: number;   // How much sentiment exceeds expected impact
  signalStrength: 'strong' | 'moderate' | 'weak';
  direction: 'fade' | 'follow' | 'no_signal';
  reasoning: string;
  confidence: number;
}

// =============================================================================
// INJURY DETECTION PATTERNS
// =============================================================================

const INJURY_PATTERNS = {
  status: {
    out: /(?:ruled out|out for|will miss|sidelined|will not play|inactive|placed on ir)/i,
    questionable: /(?:questionable|game-time decision|uncertain|listed as)/i,
    doubtful: /(?:doubtful|unlikely to play|not expected to play)/i,
    probable: /(?:probable|expected to play|likely to play|cleared to play)/i,
  },
  severity: {
    major: /(?:torn acl|season-ending|surgery|broken|fractured|acl tear|achilles|out for season|career-threatening)/i,
    moderate: /(?:concussion|hamstring|ankle|sprain|strain|groin|back injury|knee injury)/i,
    minor: /(?:rest|load management|illness|personal|day-to-day|precaution)/i,
  },
  playerType: {
    qb: /(?:quarterback|qb)/i,
    star: /(?:all-star|mvp|pro bowl|all-pro|star|superstar)/i,
    starter: /(?:starter|starting|first-string)/i,
    backup: /(?:backup|second-string|reserve)/i,
  },
};

// Expected sentiment magnitude by injury severity
const EXPECTED_SENTIMENT_BY_SEVERITY: Record<string, number> = {
  major: -0.6,
  moderate: -0.35,
  minor: -0.15,
};

// Overreaction thresholds
const OVERREACTION_THRESHOLDS = {
  strong: 0.25,   // Sentiment 25%+ more negative than expected
  moderate: 0.15, // Sentiment 15-25% more negative
  weak: 0.08,     // Sentiment 8-15% more negative
};

// =============================================================================
// INJURY DETECTION
// =============================================================================

/**
 * Extract injury alerts from sentiment analysis of sports news
 */
export function detectInjuriesFromSentiment(
  topicSentiments: Map<string, TopicSentiment>
): InjuryAlert[] {
  const injuryAlerts: InjuryAlert[] = [];

  // Look for sports injury topic
  const injurySentiment = topicSentiments.get('sports_injury');
  if (!injurySentiment || injurySentiment.articleCount === 0) {
    return [];
  }

  // Also check individual sport topics for injury mentions
  const sportTopics = ['nfl', 'nba', 'mlb', 'nhl', 'soccer', 'college_football', 'college_basketball'];

  for (const sportKey of sportTopics) {
    const sportSentiment = topicSentiments.get(sportKey);
    if (!sportSentiment) continue;

    // Look for injury-related articles in this sport
    for (const article of sportSentiment.topArticles) {
      const injuryInfo = extractInjuryInfo(article, sportKey);
      if (injuryInfo) {
        injuryAlerts.push(injuryInfo);
      }
    }
  }

  // Deduplicate by player name
  const seen = new Set<string>();
  return injuryAlerts.filter(alert => {
    const key = `${alert.playerName}-${alert.team}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract injury information from a news article
 */
function extractInjuryInfo(article: NewsArticle, sport: string): InjuryAlert | null {
  const text = `${article.title} ${article.description ?? ''} ${article.content ?? ''}`.toLowerCase();

  // Check if this is injury-related
  const hasInjuryKeyword = /(?:injury|injured|out|ruled out|miss|sidelined|surgery|tear|strain|sprain|concussion)/i.test(text);
  if (!hasInjuryKeyword) return null;

  // Detect status
  let status: InjuryAlert['status'] = 'questionable';
  for (const [statusKey, pattern] of Object.entries(INJURY_PATTERNS.status)) {
    if (pattern.test(text)) {
      status = statusKey as InjuryAlert['status'];
      break;
    }
  }

  // Detect severity
  let severity: InjuryAlert['severity'] = 'moderate';
  for (const [severityKey, pattern] of Object.entries(INJURY_PATTERNS.severity)) {
    if (pattern.test(text)) {
      severity = severityKey as InjuryAlert['severity'];
      break;
    }
  }

  // Try to extract player name (simplified - look for capitalized names)
  const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)(?:'s| is | has | will )/);
  const playerName = nameMatch ? nameMatch[1] : 'Unknown Player';

  // Try to extract team
  const teamPatterns = [
    /(?:the |for )(chiefs|eagles|cowboys|49ers|bills|packers|dolphins|lions|ravens|bengals)/i,
    /(?:the |for )(lakers|celtics|warriors|nuggets|bucks|suns|heat|76ers|knicks)/i,
    /(?:the |for )(yankees|dodgers|braves|astros|phillies|rangers|orioles|rays)/i,
  ];

  let team = 'Unknown Team';
  for (const pattern of teamPatterns) {
    const teamMatch = text.match(pattern);
    if (teamMatch) {
      team = teamMatch[1];
      break;
    }
  }

  // Extract injury type
  const injuryTypes = ['acl', 'concussion', 'hamstring', 'ankle', 'knee', 'back', 'shoulder', 'illness'];
  let injuryType = 'undisclosed';
  for (const type of injuryTypes) {
    if (text.includes(type)) {
      injuryType = type;
      break;
    }
  }

  return {
    playerName,
    team,
    sport,
    injuryType,
    severity,
    status,
    sentimentScore: article.sentiment ?? -0.3,
    articleCount: 1,
    articles: [article],
    detectedAt: new Date().toISOString(),
  };
}

// =============================================================================
// OVERREACTION ANALYSIS
// =============================================================================

/**
 * Analyze if there's an overreaction to injury news
 *
 * ADVERSARIAL LOGIC:
 * - Expected sentiment based on injury severity
 * - If actual sentiment is significantly more negative → overreaction
 * - Public is providing liquidity to sharps who correctly size the impact
 * - We fade the overreaction
 */
export function analyzeInjuryOverreaction(
  injury: InjuryAlert,
  relatedMarket?: Market
): InjuryOverreactionSignal {
  // Get expected sentiment based on severity
  const expectedSentiment = EXPECTED_SENTIMENT_BY_SEVERITY[injury.severity] ?? -0.3;

  // Calculate overreaction score
  // More negative sentiment than expected = positive overreaction score
  const overreactionScore = expectedSentiment - injury.sentimentScore;

  // Determine signal strength
  let signalStrength: 'strong' | 'moderate' | 'weak' = 'weak';
  if (overreactionScore > OVERREACTION_THRESHOLDS.strong) {
    signalStrength = 'strong';
  } else if (overreactionScore > OVERREACTION_THRESHOLDS.moderate) {
    signalStrength = 'moderate';
  } else if (overreactionScore > OVERREACTION_THRESHOLDS.weak) {
    signalStrength = 'weak';
  }

  // Determine direction
  let direction: 'fade' | 'follow' | 'no_signal' = 'no_signal';
  if (overreactionScore > OVERREACTION_THRESHOLDS.weak) {
    // Significant overreaction - fade it (bet against the panic)
    direction = 'fade';
  } else if (overreactionScore < -OVERREACTION_THRESHOLDS.weak) {
    // Underreaction - follow the injury impact
    direction = 'follow';
  }

  // Expected probability impact based on player type and severity
  const expectedImpact = calculateExpectedImpact(injury);

  // Confidence based on article count and signal strength
  let confidence = 0.4;
  if (injury.articleCount >= 5) confidence += 0.15;
  if (injury.articleCount >= 10) confidence += 0.1;
  if (signalStrength === 'strong') confidence += 0.15;
  if (signalStrength === 'moderate') confidence += 0.1;
  confidence = Math.min(confidence, 0.8);

  const reasoning = buildReasoning(injury, expectedSentiment, overreactionScore, direction);

  return {
    injury,
    relatedMarket,
    expectedImpact,
    observedSentiment: injury.sentimentScore,
    overreactionScore,
    signalStrength,
    direction,
    reasoning,
    confidence,
  };
}

/**
 * Calculate expected probability impact from injury
 */
function calculateExpectedImpact(injury: InjuryAlert): number {
  // Base impact by severity
  let impact = 0;
  switch (injury.severity) {
    case 'major':
      impact = 0.08; // 8% probability shift
      break;
    case 'moderate':
      impact = 0.04;
      break;
    case 'minor':
      impact = 0.01;
      break;
  }

  // Adjust by status
  switch (injury.status) {
    case 'out':
      impact *= 1.0;
      break;
    case 'doubtful':
      impact *= 0.75;
      break;
    case 'questionable':
      impact *= 0.5;
      break;
    case 'probable':
      impact *= 0.25;
      break;
  }

  return impact;
}

/**
 * Build reasoning string for the signal
 */
function buildReasoning(
  injury: InjuryAlert,
  expectedSentiment: number,
  overreactionScore: number,
  direction: 'fade' | 'follow' | 'no_signal'
): string {
  const parts: string[] = [];

  parts.push(`${injury.playerName} (${injury.team}) - ${injury.injuryType} injury`);
  parts.push(`Severity: ${injury.severity}, Status: ${injury.status}`);
  parts.push(`Expected sentiment: ${(expectedSentiment * 100).toFixed(0)}%, Actual: ${(injury.sentimentScore * 100).toFixed(0)}%`);

  if (direction === 'fade') {
    parts.push(`Overreaction detected (${(overreactionScore * 100).toFixed(0)}% more negative than expected)`);
    parts.push('Signal: FADE - bet against the panic, public is overreacting');
  } else if (direction === 'follow') {
    parts.push('Underreaction detected - market not fully pricing injury impact');
    parts.push('Signal: FOLLOW - bet with the injury impact');
  } else {
    parts.push('No significant overreaction detected');
  }

  return parts.join('. ');
}

// =============================================================================
// BATCH ANALYSIS
// =============================================================================

/**
 * Analyze all detected injuries for overreaction signals
 */
export function analyzeAllInjuryOverreactions(
  topicSentiments: Map<string, TopicSentiment>,
  markets: Market[]
): InjuryOverreactionSignal[] {
  // Detect injuries from sentiment
  const injuries = detectInjuriesFromSentiment(topicSentiments);

  if (injuries.length === 0) {
    logger.debug('No injuries detected from sentiment analysis');
    return [];
  }

  logger.debug(`Detected ${injuries.length} injury alerts`);

  // Analyze each injury
  const signals: InjuryOverreactionSignal[] = [];

  for (const injury of injuries) {
    // Try to find related market
    const relatedMarket = findRelatedMarket(injury, markets);

    const signal = analyzeInjuryOverreaction(injury, relatedMarket);

    // Only include signals with direction
    if (signal.direction !== 'no_signal') {
      signals.push(signal);
    }
  }

  // Sort by overreaction score (strongest first)
  signals.sort((a, b) => Math.abs(b.overreactionScore) - Math.abs(a.overreactionScore));

  return signals;
}

/**
 * Find market related to an injury
 */
function findRelatedMarket(injury: InjuryAlert, markets: Market[]): Market | undefined {
  const searchTerms = [
    injury.team.toLowerCase(),
    injury.playerName.toLowerCase(),
    injury.sport.toLowerCase(),
  ].filter(t => t && t !== 'unknown');

  for (const market of markets) {
    const title = market.title?.toLowerCase() ?? '';

    for (const term of searchTerms) {
      if (title.includes(term)) {
        return market;
      }
    }
  }

  return undefined;
}

/**
 * Format injury overreaction report
 */
export function formatInjuryOverreactionReport(signals: InjuryOverreactionSignal[]): string {
  if (signals.length === 0) {
    return 'No injury overreactions detected.';
  }

  const lines: string[] = [
    '**🏥 Injury Overreaction Analysis**',
    '═══════════════════════════════════',
    '',
  ];

  for (const signal of signals.slice(0, 5)) {
    const directionIcon = signal.direction === 'fade' ? '🔄' : signal.direction === 'follow' ? '➡️' : '⏸️';
    const strengthIcon = signal.signalStrength === 'strong' ? '🔥' : signal.signalStrength === 'moderate' ? '⚡' : '💡';

    lines.push(`${directionIcon} ${strengthIcon} **${signal.injury.playerName}** (${signal.injury.team})`);
    lines.push(`   Sport: ${signal.injury.sport} | Injury: ${signal.injury.injuryType}`);
    lines.push(`   Severity: ${signal.injury.severity} | Status: ${signal.injury.status}`);
    lines.push(`   Overreaction: ${(signal.overreactionScore * 100).toFixed(0)}% | Direction: ${signal.direction.toUpperCase()}`);
    lines.push(`   Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    lines.push('');
  }

  return lines.join('\n');
}
