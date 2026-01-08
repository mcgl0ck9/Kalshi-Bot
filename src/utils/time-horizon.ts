/**
 * Time Horizon Filtering Utility
 *
 * Shared utility for filtering markets based on time to expiry.
 * Each category has different time horizon requirements.
 */

import type { Market } from '../core/types.js';

// =============================================================================
// CATEGORY-SPECIFIC CONFIGURATIONS
// =============================================================================

export interface TimeHorizonConfig {
  /** Days for each horizon tier */
  horizons: {
    immediate: number;   // Highest priority (e.g., today, this week)
    short: number;       // High priority
    medium: number;      // Moderate priority
    extended: number;    // Lower priority
  };
  /** Minimum edge required for each horizon */
  edgeThresholds: {
    immediate: number;
    short: number;
    medium: number;
    extended: number;
    tooFar: number;      // Markets beyond extended
  };
  /** Keywords that identify "futures" type markets requiring extreme edge */
  futuresKeywords?: string[];
}

// SPORTS: Games today/this week prioritized
export const SPORTS_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 1, short: 7, medium: 30, extended: 60 },
  edgeThresholds: { immediate: 0.05, short: 0.05, medium: 0.12, extended: 0.15, tooFar: 0.20 },
  futuresKeywords: [
    'win super bowl', 'super bowl champion', 'world series winner',
    'nba champion', 'stanley cup', 'win championship', 'mvp',
    'win division', 'make playoffs',
  ],
};

// ECONOMICS: 3 weeks out, closer = priority
export const ECON_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 3, short: 7, medium: 14, extended: 21 },
  edgeThresholds: { immediate: 0.05, short: 0.06, medium: 0.10, extended: 0.15, tooFar: 0.20 },
  futuresKeywords: [
    'annual gdp', 'year-end', 'full year', '2027', '2028',
  ],
};

// MENTIONS/EARNINGS: Same as Econ (3 weeks, prioritize closer)
export const MENTIONS_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 3, short: 7, medium: 14, extended: 21 },
  edgeThresholds: { immediate: 0.05, short: 0.06, medium: 0.10, extended: 0.15, tooFar: 0.20 },
  futuresKeywords: [
    'annual report', 'fiscal year',
  ],
};

// WEATHER: Forecasts degrade quickly
export const WEATHER_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 1, short: 3, medium: 5, extended: 7 },
  edgeThresholds: { immediate: 0.05, short: 0.05, medium: 0.10, extended: 0.15, tooFar: 0.25 },
  futuresKeywords: [
    'seasonal', 'winter outlook', 'summer outlook', 'annual',
  ],
};

// HEALTH: Filter vague long-term predictions
export const HEALTH_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 7, short: 14, medium: 30, extended: 60 },
  edgeThresholds: { immediate: 0.05, short: 0.06, medium: 0.10, extended: 0.15, tooFar: 0.25 },
  futuresKeywords: [
    'by end of year', 'annual total', 'yearly', 'by 2027', 'by 2028',
    'pandemic', 'endemic',
  ],
};

// POLITICS: Elections have fixed dates
export const POLITICS_CONFIG: TimeHorizonConfig = {
  horizons: { immediate: 7, short: 30, medium: 60, extended: 90 },
  edgeThresholds: { immediate: 0.05, short: 0.06, medium: 0.12, extended: 0.18, tooFar: 0.25 },
  futuresKeywords: [
    '2028 election', '2032 election', 'next president after',
  ],
};

// =============================================================================
// TIME HORIZON ANALYSIS
// =============================================================================

export type HorizonTier = 'immediate' | 'short' | 'medium' | 'extended' | 'too_far';

export interface TimeHorizonResult {
  daysToExpiry: number;
  tier: HorizonTier;
  isFutures: boolean;
  minEdgeRequired: number;
  label: string;
}

/**
 * Analyze market time horizon for a specific category config
 */
export function analyzeTimeHorizon(
  market: Market,
  config: TimeHorizonConfig
): TimeHorizonResult {
  const titleLower = market.title.toLowerCase();

  // Check if this is a "futures" type market
  const isFutures = config.futuresKeywords?.some(kw => titleLower.includes(kw)) ?? false;

  // Calculate days to expiry
  let daysToExpiry = 365; // Default to far future
  if (market.closeTime) {
    const expiryDate = new Date(market.closeTime);
    daysToExpiry = Math.max(0, (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  // Determine tier and required edge
  let tier: HorizonTier;
  let minEdgeRequired: number;
  let label: string;

  if (isFutures) {
    tier = 'too_far';
    minEdgeRequired = config.edgeThresholds.tooFar;
    label = '🏆 FUTURES';
  } else if (daysToExpiry <= config.horizons.immediate) {
    tier = 'immediate';
    minEdgeRequired = config.edgeThresholds.immediate;
    label = daysToExpiry < 1 ? '🔴 TODAY' : `🔴 ${Math.ceil(daysToExpiry)}d`;
  } else if (daysToExpiry <= config.horizons.short) {
    tier = 'short';
    minEdgeRequired = config.edgeThresholds.short;
    label = `📅 ${Math.ceil(daysToExpiry)}d`;
  } else if (daysToExpiry <= config.horizons.medium) {
    tier = 'medium';
    minEdgeRequired = config.edgeThresholds.medium;
    label = `📆 ${Math.ceil(daysToExpiry)}d`;
  } else if (daysToExpiry <= config.horizons.extended) {
    tier = 'extended';
    minEdgeRequired = config.edgeThresholds.extended;
    label = `⏳ ${Math.ceil(daysToExpiry)}d`;
  } else {
    tier = 'too_far';
    minEdgeRequired = config.edgeThresholds.tooFar;
    label = `⚠️ ${Math.ceil(daysToExpiry)}d`;
  }

  return { daysToExpiry, tier, isFutures, minEdgeRequired, label };
}

/**
 * Check if edge meets the time horizon threshold
 */
export function meetsTimeHorizonThreshold(
  market: Market,
  edge: number,
  config: TimeHorizonConfig,
  logPrefix?: string
): boolean {
  const { minEdgeRequired, tier, isFutures, daysToExpiry } = analyzeTimeHorizon(market, config);

  if (edge < minEdgeRequired) {
    if (logPrefix) {
      if (isFutures) {
        console.debug(`${logPrefix}: Filtering futures "${market.title}" - edge ${(edge*100).toFixed(1)}% < ${(minEdgeRequired*100).toFixed(0)}%`);
      } else if (tier === 'too_far') {
        console.debug(`${logPrefix}: Filtering far-dated "${market.title}" (${Math.ceil(daysToExpiry)}d out)`);
      }
    }
    return false;
  }

  return true;
}

/**
 * Pre-filter markets that are definitely too far out
 */
export function preFilterMarkets(
  markets: Market[],
  config: TimeHorizonConfig,
  maxDaysForFutures: number = 90
): Market[] {
  return markets.filter(m => {
    const { isFutures, daysToExpiry } = analyzeTimeHorizon(m, config);

    // Filter futures that are way too far out
    if (isFutures && daysToExpiry > maxDaysForFutures) {
      return false;
    }

    // Filter anything beyond 1 year (unless it's very close somehow)
    if (daysToExpiry > 365) {
      return false;
    }

    return true;
  });
}

/**
 * Get time label for display
 */
export function getTimeLabel(market: Market, config: TimeHorizonConfig): string {
  return analyzeTimeHorizon(market, config).label;
}

// =============================================================================
// CATEGORY HELPERS
// =============================================================================

export function getConfigForCategory(category: string): TimeHorizonConfig {
  switch (category.toLowerCase()) {
    case 'sports':
      return SPORTS_CONFIG;
    case 'macro':
    case 'economics':
    case 'econ':
      return ECON_CONFIG;
    case 'mentions':
    case 'earnings':
      return MENTIONS_CONFIG;
    case 'weather':
      return WEATHER_CONFIG;
    case 'health':
      return HEALTH_CONFIG;
    case 'politics':
      return POLITICS_CONFIG;
    default:
      // Default to a moderate config
      return ECON_CONFIG;
  }
}
