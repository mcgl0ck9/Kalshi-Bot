/**
 * Weather Edge Detector v4.0
 *
 * Detects edges in weather-related markets by applying:
 * 1. Climatological base rates (historical averages)
 * 2. Forecast skill degradation (accuracy drops beyond 5 days)
 * 3. Known biases (wet bias, cone overestimation)
 *
 * ACADEMIC FOUNDATION:
 * - Joslyn & Savelli (2010): Wet bias in precipitation forecasts
 * - Broad et al. (2007): Hurricane cone misinterpretation
 * - Silver (2012): Temperature forecast skill limits
 *
 * ADVERSARIAL TEST:
 * - Who's on the other side? Media-influenced retail, availability heuristic traders
 * - Why do they lose? Weight vivid scenarios over base rates
 * - Our edge: Climatological base rates + forecast skill limits
 */

import {
  defineDetector,
  createEdge,
  type Edge,
  type Market,
  type SourceData,
} from '../core/index.js';
import { logger } from '../utils/index.js';
import {
  WEATHER_CONFIG,
  analyzeTimeHorizon,
  meetsTimeHorizonThreshold,
  preFilterMarkets,
} from '../utils/time-horizon.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_EDGE = 0.06;           // 6% minimum for weather markets (higher uncertainty)
const MIN_CONFIDENCE = 0.50;

// =============================================================================
// TYPES
// =============================================================================

type WeatherEventType = 'hurricane' | 'temperature' | 'precipitation' | 'snow' | 'other';

export interface WeatherEdgeSignal {
  type: 'weather';
  eventType: WeatherEventType;
  historicalBaseRate: number;
  forecastHorizon: number;
  skillWeight: number;
  biasAdjustment: number;
  adjustedProbability: number;
  [key: string]: unknown;  // Index signature for EdgeSignal compatibility
}

// =============================================================================
// CLIMATOLOGICAL BASE RATES
// =============================================================================

// Historical base rates for various weather events (Source: NOAA CPC)
const CLIMATOLOGICAL_BASE_RATES: Record<string, number> = {
  // Hurricane landfall probabilities (per season, US)
  'hurricane_us_landfall': 0.75,
  'hurricane_florida': 0.40,
  'hurricane_gulf_coast': 0.35,
  'hurricane_east_coast': 0.25,

  // Temperature records (monthly)
  'hottest_month_record': 0.08,
  'coldest_month_record': 0.08,
  'warmest_year_record': 0.15,  // Higher due to climate trend

  // Precipitation (daily)
  'measurable_rain_any_day': 0.30,
  'snow_northeast_winter': 0.25,

  // Severe weather
  'tornado_outbreak_spring': 0.20,
  'heat_wave_summer': 0.15,
};

// Forecast skill degradation by horizon (from NWS verification studies)
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
  precipitation: { wetBias: 0.08 },  // PoP forecasts are ~8% too high
  temperature: { warmBias: 0.02, coldBias: 0.01 },
  hurricane: { coneOverestimation: 0.15 },  // People overestimate at cone edges
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Detect if a market is weather-related and extract type
 */
function detectWeatherMarket(market: Market): {
  isWeather: boolean;
  eventType: WeatherEventType;
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
 * Extract forecast horizon from market close time
 */
function extractForecastHorizon(market: Market): number {
  if (market.closeTime) {
    const closeTime = new Date(market.closeTime);
    const now = new Date();
    const daysOut = Math.ceil((closeTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(daysOut, 14));
  }
  return 7;  // Default to 7 days if unknown
}

/**
 * Apply weather forecast biases and skill degradation
 */
function applyWeatherBiasAdjustment(
  forecastProb: number,
  baseRate: number,
  eventType: WeatherEventType,
  horizon: number
): {
  adjustedProbability: number;
  biasAdjustment: number;
  skillWeight: number;
} {
  // Get skill weight for this horizon
  const skillWeight = FORECAST_SKILL_BY_HORIZON[Math.min(horizon, 10)] ?? 0.20;

  // Weighted average of forecast and base rate
  let adjusted = (forecastProb * skillWeight) + (baseRate * (1 - skillWeight));

  // Apply event-type specific biases
  let biasApplied = 0;

  switch (eventType) {
    case 'precipitation':
    case 'snow':
      biasApplied = -FORECAST_BIASES.precipitation.wetBias;
      adjusted = Math.max(0, adjusted + biasApplied);
      break;

    case 'hurricane':
      biasApplied = -FORECAST_BIASES.hurricane.coneOverestimation * 0.5;
      adjusted = Math.max(0, adjusted + biasApplied);
      break;

    case 'temperature':
      biasApplied = -FORECAST_BIASES.temperature.warmBias;
      adjusted = Math.max(0, Math.min(1, adjusted + biasApplied));
      break;
  }

  return {
    adjustedProbability: adjusted,
    biasAdjustment: biasApplied,
    skillWeight,
  };
}

// =============================================================================
// DETECTOR DEFINITION
// =============================================================================

export default defineDetector({
  name: 'weather',
  description: 'Weather market edge detection using climatological base rates and forecast skill limits',
  sources: ['kalshi', 'weather'],
  minEdge: MIN_EDGE,

  async detect(data: SourceData, markets: Market[]): Promise<Edge[]> {
    const edges: Edge[] = [];

    // Filter to weather-related markets
    const allWeatherMarkets = markets.filter(m => {
      const { isWeather } = detectWeatherMarket(m);
      return isWeather;
    });

    // Apply time horizon pre-filter (0-3d good, 4-7d higher edge, 7+ filter unless extreme)
    const weatherMarkets = preFilterMarkets(allWeatherMarkets, WEATHER_CONFIG, 14);
    const filteredCount = allWeatherMarkets.length - weatherMarkets.length;
    if (filteredCount > 0) {
      logger.info(`Weather detector: Filtered ${filteredCount} far-dated weather markets`);
    }

    if (weatherMarkets.length === 0) {
      logger.debug('Weather detector: No weather markets found');
      return edges;
    }

    logger.info(`Weather detector: Analyzing ${weatherMarkets.length} weather markets`);

    for (const market of weatherMarkets) {
      const { eventType, baseRateKey } = detectWeatherMarket(market);

      if (!baseRateKey) continue;

      const baseRate = CLIMATOLOGICAL_BASE_RATES[baseRateKey];
      if (baseRate === undefined) continue;

      const horizon = extractForecastHorizon(market);

      // Use market price as proxy for forecast probability
      const forecastProb = market.price;

      const { adjustedProbability, biasAdjustment, skillWeight } = applyWeatherBiasAdjustment(
        forecastProb,
        baseRate,
        eventType,
        horizon
      );

      const edge = adjustedProbability - market.price;
      const absEdge = Math.abs(edge);

      if (absEdge < MIN_EDGE) continue;

      // Apply time horizon threshold check
      if (!meetsTimeHorizonThreshold(market, absEdge, WEATHER_CONFIG, 'Weather')) {
        continue;
      }

      const direction = edge > 0 ? 'YES' : 'NO';

      // Confidence based on horizon and edge magnitude
      let confidence = MIN_CONFIDENCE;
      if (horizon <= 3) confidence += 0.15;
      else if (horizon <= 5) confidence += 0.1;
      if (absEdge > 0.10) confidence += 0.1;
      confidence = Math.min(confidence, 0.80);

      // Enhanced WHY rationale with time context
      const { label: timeLabel } = analyzeTimeHorizon(market, WEATHER_CONFIG);
      const reason = `${timeLabel} | **WEATHER** ${eventType.toUpperCase()} | ` +
        `Horizon: ${horizon}d (skill: ${(skillWeight * 100).toFixed(0)}%) | ` +
        `Market: ${(market.price * 100).toFixed(0)}% vs Climatology: ${(baseRate * 100).toFixed(0)}% | ` +
        `→ **${(absEdge * 100).toFixed(1)}% edge** after bias adjustment`;

      const signal: WeatherEdgeSignal = {
        type: 'weather',
        eventType,
        historicalBaseRate: baseRate,
        forecastHorizon: horizon,
        skillWeight,
        biasAdjustment,
        adjustedProbability,
      };

      edges.push(createEdge(
        market,
        direction,
        absEdge,
        confidence,
        reason,
        signal
      ));
    }

    if (edges.length > 0) {
      logger.info(`Weather detector: Found ${edges.length} edges (after time horizon filtering)`);
    }

    return edges;
  },
});
