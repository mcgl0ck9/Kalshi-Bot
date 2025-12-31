/**
 * Weather Forecast Overreaction Detection
 *
 * QUANT INSIGHT: Weather forecasts have known systematic biases
 *
 * DOCUMENTED BIASES (from NWS/BAMS research):
 * 1. Wet Bias: Precipitation forecasts 5-10% too high on average
 * 2. Cone Misinterpretation: Public treats hurricane cone as "all equally likely"
 * 3. Skill Degradation: Beyond day 5, forecasts should regress to climatology
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Media-influenced retail, availability heuristic traders
 * - Why do they lose? Weight vivid scenarios over base rates
 * - Our edge: Climatological base rates + forecast skill limits
 *
 * SOURCES:
 * - Joslyn & Savelli (2010): Wet bias in precipitation forecasts
 * - Broad et al. (2007): Hurricane cone misinterpretation
 * - Silver (2012): Temperature forecast skill limits
 */

import { logger } from '../utils/index.js';
import type { Market } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WeatherEdge {
  market: Market;
  eventType: 'hurricane' | 'temperature' | 'precipitation' | 'snow' | 'other';
  kalshiPrice: number;
  historicalBaseRate: number;
  forecastProbability: number;
  forecastHorizon: number;  // Days out
  adjustedProbability: number;
  biasAdjustment: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
}

// =============================================================================
// CLIMATOLOGICAL BASE RATES
// =============================================================================

// Historical base rates for various weather events
// Source: NOAA Climate Prediction Center
const CLIMATOLOGICAL_BASE_RATES: Record<string, number> = {
  // Hurricane landfall probabilities (per season, US)
  'hurricane_us_landfall': 0.75,          // ~75% chance of at least 1 major landfall per season
  'hurricane_florida': 0.40,              // Florida's annual landfall probability
  'hurricane_gulf_coast': 0.35,
  'hurricane_east_coast': 0.25,

  // Temperature records (monthly)
  'hottest_month_record': 0.08,           // ~8% chance any given month is hottest on record
  'coldest_month_record': 0.08,
  'warmest_year_record': 0.15,            // Higher due to climate trend

  // Precipitation (daily)
  'measurable_rain_any_day': 0.30,        // US average
  'snow_northeast_winter': 0.25,          // Average winter day

  // Severe weather
  'tornado_outbreak_spring': 0.20,        // Peak season daily probability
  'heat_wave_summer': 0.15,
};

// Forecast skill degradation by horizon (from NWS verification studies)
// This is how much we should weight the forecast vs climatology
const FORECAST_SKILL_BY_HORIZON: Record<number, number> = {
  1: 0.95,   // Day 1: Trust forecast 95%
  2: 0.90,
  3: 0.85,
  4: 0.75,
  5: 0.65,
  6: 0.50,   // Day 6: Equal weight forecast and climatology
  7: 0.40,
  8: 0.30,
  9: 0.25,
  10: 0.20,  // Day 10+: Mostly climatology
};

// Known biases to adjust for
const FORECAST_BIASES = {
  precipitation: {
    wetBias: 0.08,  // PoP forecasts are ~8% too high
  },
  temperature: {
    warmBias: 0.02, // Slight warm bias in summer
    coldBias: 0.01, // Slight cold bias in winter
  },
  hurricane: {
    coneOverestimation: 0.15, // People overestimate probability at cone edges
  },
};

// =============================================================================
// WEATHER MARKET DETECTION
// =============================================================================

/**
 * Detect if a market is weather-related and extract type
 */
function detectWeatherMarket(market: Market): {
  isWeather: boolean;
  eventType: WeatherEdge['eventType'];
  baseRateKey?: string;
} {
  const title = (market.title ?? '').toLowerCase();

  // Hurricane markets
  if (title.includes('hurricane') || title.includes('tropical') || title.includes('landfall')) {
    let baseRateKey = 'hurricane_us_landfall';
    if (title.includes('florida')) baseRateKey = 'hurricane_florida';
    else if (title.includes('gulf')) baseRateKey = 'hurricane_gulf_coast';
    else if (title.includes('east coast') || title.includes('atlantic')) baseRateKey = 'hurricane_east_coast';

    return { isWeather: true, eventType: 'hurricane', baseRateKey };
  }

  // Temperature markets
  if (title.includes('hottest') || title.includes('warmest') || title.includes('temperature') ||
      title.includes('coldest') || title.includes('heat wave') || title.includes('cold snap')) {
    let baseRateKey = 'hottest_month_record';
    if (title.includes('coldest')) baseRateKey = 'coldest_month_record';
    if (title.includes('year')) baseRateKey = 'warmest_year_record';
    if (title.includes('heat wave')) baseRateKey = 'heat_wave_summer';

    return { isWeather: true, eventType: 'temperature', baseRateKey };
  }

  // Precipitation/snow markets
  if (title.includes('rain') || title.includes('precipitation') || title.includes('snow') ||
      title.includes('snowfall') || title.includes('inches')) {
    const eventType = title.includes('snow') ? 'snow' : 'precipitation';
    const baseRateKey = eventType === 'snow' ? 'snow_northeast_winter' : 'measurable_rain_any_day';

    return { isWeather: true, eventType, baseRateKey };
  }

  // Severe weather
  if (title.includes('tornado') || title.includes('severe weather')) {
    return { isWeather: true, eventType: 'other', baseRateKey: 'tornado_outbreak_spring' };
  }

  return { isWeather: false, eventType: 'other' };
}

/**
 * Extract forecast horizon from market title/description
 * Returns days until event resolution
 */
function extractForecastHorizon(market: Market): number {
  // If market has close time, calculate days
  if (market.closeTime) {
    const closeTime = new Date(market.closeTime);
    const now = new Date();
    const daysOut = Math.ceil((closeTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(daysOut, 14)); // Cap at 14 days
  }

  // Default to 7 days if unknown
  return 7;
}

// =============================================================================
// BIAS ADJUSTMENT
// =============================================================================

/**
 * Apply weather forecast biases and skill degradation
 */
function applyWeatherBiasAdjustment(
  forecastProb: number,
  baseRate: number,
  eventType: WeatherEdge['eventType'],
  horizon: number
): {
  adjustedProbability: number;
  biasAdjustment: number;
  reasoning: string;
} {
  // Get skill weight for this horizon
  const skillWeight = FORECAST_SKILL_BY_HORIZON[Math.min(horizon, 10)] ?? 0.20;

  // Start with weighted average of forecast and base rate
  let adjusted = (forecastProb * skillWeight) + (baseRate * (1 - skillWeight));

  // Apply event-type specific biases
  let biasApplied = 0;

  switch (eventType) {
    case 'precipitation':
    case 'snow':
      // Wet bias: Forecasts are too high
      biasApplied = -FORECAST_BIASES.precipitation.wetBias;
      adjusted = Math.max(0, adjusted + biasApplied);
      break;

    case 'hurricane':
      // Cone overestimation: People think entire cone is equally likely
      // If market price > adjusted, public may be overreacting
      biasApplied = -FORECAST_BIASES.hurricane.coneOverestimation * 0.5;
      adjusted = Math.max(0, adjusted + biasApplied);
      break;

    case 'temperature':
      // Slight biases, less impactful
      biasApplied = -FORECAST_BIASES.temperature.warmBias;
      adjusted = Math.max(0, Math.min(1, adjusted + biasApplied));
      break;
  }

  const reasoning = `Horizon: ${horizon}d (skill: ${(skillWeight * 100).toFixed(0)}%). ` +
    `Forecast: ${(forecastProb * 100).toFixed(0)}%, Base rate: ${(baseRate * 100).toFixed(0)}%. ` +
    `Adjusted: ${(adjusted * 100).toFixed(0)}% (${eventType} bias: ${(biasApplied * 100).toFixed(1)}%)`;

  return {
    adjustedProbability: adjusted,
    biasAdjustment: adjusted - forecastProb,
    reasoning,
  };
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Analyze weather markets for overreaction opportunities
 *
 * ADVERSARIAL LOGIC:
 * - Public overweights forecast probability, ignores skill degradation
 * - Public overweights recent extreme events (availability heuristic)
 * - We apply climatological base rates + documented biases
 */
export function analyzeWeatherMarkets(
  markets: Market[],
  minEdge: number = 0.06
): WeatherEdge[] {
  const edges: WeatherEdge[] = [];

  for (const market of markets) {
    const { isWeather, eventType, baseRateKey } = detectWeatherMarket(market);

    if (!isWeather || !baseRateKey) continue;

    const baseRate = CLIMATOLOGICAL_BASE_RATES[baseRateKey];
    if (baseRate === undefined) continue;

    const horizon = extractForecastHorizon(market);

    // Use market price as proxy for "forecast probability" since we don't have live NWS data
    // In a full implementation, we'd fetch actual NWS forecasts
    const forecastProb = market.price;

    const { adjustedProbability, biasAdjustment, reasoning } = applyWeatherBiasAdjustment(
      forecastProb,
      baseRate,
      eventType,
      horizon
    );

    const edge = adjustedProbability - market.price;
    const absEdge = Math.abs(edge);

    if (absEdge < minEdge) continue;

    const direction = edge > 0 ? 'buy_yes' : 'buy_no';

    // Confidence based on horizon (shorter = more confident) and edge magnitude
    let confidence = 0.5;
    if (horizon <= 3) confidence += 0.15;
    if (horizon <= 5) confidence += 0.1;
    if (absEdge > 0.10) confidence += 0.1;
    confidence = Math.min(confidence, 0.8);

    edges.push({
      market,
      eventType,
      kalshiPrice: market.price,
      historicalBaseRate: baseRate,
      forecastProbability: forecastProb,
      forecastHorizon: horizon,
      adjustedProbability,
      biasAdjustment,
      edge,
      direction,
      confidence,
      reasoning,
    });
  }

  // Sort by edge magnitude
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  if (edges.length > 0) {
    logger.info(`Found ${edges.length} weather market edges`);
  }

  return edges;
}

/**
 * Format weather edge report
 */
export function formatWeatherEdgeReport(edges: WeatherEdge[]): string {
  if (edges.length === 0) {
    return 'No weather market edges found.';
  }

  const lines: string[] = [
    '**🌦️ Weather Market Analysis**',
    '═══════════════════════════════════',
    '',
    '*Applying climatological base rates + forecast skill limits*',
    '',
  ];

  for (const edge of edges.slice(0, 5)) {
    const dirIcon = edge.direction === 'buy_yes' ? '📈' : '📉';
    const eventIcon = {
      hurricane: '🌀',
      temperature: '🌡️',
      precipitation: '🌧️',
      snow: '❄️',
      other: '⚡',
    }[edge.eventType];

    lines.push(`${dirIcon} ${eventIcon} **${edge.market.title?.slice(0, 50)}**`);
    lines.push(`   Type: ${edge.eventType} | Horizon: ${edge.forecastHorizon}d`);
    lines.push(`   Kalshi: ${(edge.kalshiPrice * 100).toFixed(0)}% | Base Rate: ${(edge.historicalBaseRate * 100).toFixed(0)}%`);
    lines.push(`   Adjusted: ${(edge.adjustedProbability * 100).toFixed(0)}% | Edge: ${(edge.edge * 100).toFixed(1)}%`);
    lines.push(`   Direction: ${edge.direction.toUpperCase()} | Conf: ${(edge.confidence * 100).toFixed(0)}%`);
    lines.push('');
  }

  lines.push('*Edge source: Forecast skill degradation + wet bias adjustment*');

  return lines.join('\n');
}
