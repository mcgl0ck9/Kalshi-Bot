/**
 * City-Specific Weather Edge Detection
 *
 * QUANT INSIGHT: Monthly precipitation/snow markets often misprice due to:
 * 1. Recency bias - Recent weather heavily influences expectations
 * 2. Ignoring cumulative progress - Market doesn't track month-to-date totals
 * 3. Forecast overweighting - 10-day forecasts treated as certainty
 *
 * EDGE SOURCE:
 * - Historical climatological data (30-year averages by city/month)
 * - Current month-to-date accumulation
 * - Probabilistic forecast integration
 *
 * DATA SOURCES:
 * - NOAA Climate Normals (1991-2020)
 * - Open-Meteo Historical API
 * - NWS Forecast API
 */

import { logger } from '../utils/index.js';
import type { Market, EdgeOpportunity, MarketCategory } from '../types/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface CityWeatherEdge {
  market: Market;
  city: string;
  measurementType: 'snow' | 'rain' | 'temperature';
  threshold: number;
  unit: string;
  currentMonthTotal: number;
  daysRemaining: number;
  historicalAverage: number;
  historicalStdDev: number;
  probabilityAboveThreshold: number;
  kalshiPrice: number;
  edge: number;
  direction: 'buy_yes' | 'buy_no';
  confidence: number;
  reasoning: string;
}

interface CityClimateData {
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  // Monthly averages (index 0 = January, 11 = December)
  snowfallAvg: number[];    // inches
  snowfallStdDev: number[]; // standard deviation
  rainfallAvg: number[];    // inches
  rainfallStdDev: number[];
  avgHighTemp: number[];    // Fahrenheit
  avgLowTemp: number[];
}

// =============================================================================
// HISTORICAL CLIMATE DATA (NOAA 1991-2020 Normals)
// =============================================================================

const CITY_CLIMATE_DATA: Record<string, CityClimateData> = {
  'chicago': {
    name: 'Chicago',
    state: 'IL',
    latitude: 41.8781,
    longitude: -87.6298,
    // Monthly snowfall averages (inches) - O'Hare data
    snowfallAvg: [11.5, 9.1, 5.4, 1.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 1.3, 8.5],
    snowfallStdDev: [8.2, 7.1, 5.8, 2.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 2.1, 7.0],
    rainfallAvg: [2.0, 1.9, 2.7, 3.6, 4.1, 4.1, 3.8, 4.1, 3.3, 3.0, 3.0, 2.4],
    rainfallStdDev: [1.2, 1.3, 1.5, 1.8, 2.0, 2.2, 2.0, 2.3, 1.9, 1.7, 1.6, 1.3],
    avgHighTemp: [32, 36, 47, 59, 70, 80, 84, 82, 75, 62, 48, 36],
    avgLowTemp: [18, 21, 31, 41, 51, 61, 66, 65, 57, 45, 34, 23],
  },
  'los_angeles': {
    name: 'Los Angeles',
    state: 'CA',
    latitude: 34.0522,
    longitude: -118.2437,
    snowfallAvg: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snowfallStdDev: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    // LA rainfall - mostly winter months
    rainfallAvg: [3.1, 3.8, 2.4, 0.7, 0.3, 0.1, 0.0, 0.1, 0.2, 0.6, 1.0, 2.3],
    rainfallStdDev: [3.2, 3.5, 2.8, 1.2, 0.5, 0.2, 0.1, 0.2, 0.4, 1.0, 1.5, 2.8],
    avgHighTemp: [68, 69, 70, 73, 75, 79, 84, 85, 84, 78, 72, 67],
    avgLowTemp: [49, 50, 52, 55, 58, 62, 65, 66, 64, 59, 53, 48],
  },
  'new_york': {
    name: 'New York',
    state: 'NY',
    latitude: 40.7128,
    longitude: -74.0060,
    snowfallAvg: [8.0, 9.2, 4.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 5.0],
    snowfallStdDev: [7.5, 8.0, 5.5, 1.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 1.5, 6.0],
    rainfallAvg: [3.6, 3.0, 4.0, 4.2, 4.2, 4.5, 4.6, 4.4, 4.3, 3.9, 3.6, 3.8],
    rainfallStdDev: [1.8, 1.6, 1.9, 1.8, 2.0, 2.2, 2.4, 2.3, 2.5, 2.0, 1.8, 1.9],
    avgHighTemp: [39, 42, 50, 62, 72, 81, 85, 84, 76, 65, 54, 44],
    avgLowTemp: [26, 28, 35, 45, 55, 64, 70, 69, 62, 51, 42, 32],
  },
  'denver': {
    name: 'Denver',
    state: 'CO',
    latitude: 39.7392,
    longitude: -104.9903,
    snowfallAvg: [6.8, 7.5, 11.5, 8.8, 1.5, 0.0, 0.0, 0.0, 0.8, 4.0, 8.5, 7.2],
    snowfallStdDev: [6.5, 7.0, 10.0, 8.5, 3.0, 0.0, 0.0, 0.0, 2.0, 5.5, 8.0, 7.0],
    rainfallAvg: [0.4, 0.4, 1.1, 1.8, 2.4, 1.8, 2.0, 1.8, 1.2, 1.0, 0.7, 0.5],
    rainfallStdDev: [0.4, 0.4, 0.9, 1.2, 1.5, 1.2, 1.4, 1.3, 1.0, 0.9, 0.6, 0.5],
    avgHighTemp: [45, 47, 54, 61, 70, 82, 90, 87, 79, 66, 52, 44],
    avgLowTemp: [16, 19, 27, 34, 44, 53, 59, 57, 48, 36, 25, 17],
  },
  'boston': {
    name: 'Boston',
    state: 'MA',
    latitude: 42.3601,
    longitude: -71.0589,
    snowfallAvg: [12.9, 11.3, 7.8, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 8.3],
    snowfallStdDev: [10.0, 9.5, 7.5, 2.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 2.0, 7.5],
    rainfallAvg: [3.4, 3.2, 4.3, 3.7, 3.5, 3.7, 3.4, 3.4, 3.5, 3.8, 3.7, 3.7],
    rainfallStdDev: [1.8, 1.7, 2.0, 1.8, 1.7, 2.0, 1.9, 2.0, 2.2, 2.0, 1.9, 1.9],
    avgHighTemp: [36, 39, 46, 56, 67, 76, 82, 80, 73, 62, 51, 41],
    avgLowTemp: [22, 24, 31, 41, 50, 60, 66, 65, 57, 47, 38, 28],
  },
  'minneapolis': {
    name: 'Minneapolis',
    state: 'MN',
    latitude: 44.9778,
    longitude: -93.2650,
    snowfallAvg: [12.2, 8.0, 10.3, 3.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.5, 8.8, 11.5],
    snowfallStdDev: [9.0, 7.0, 9.0, 4.5, 0.3, 0.0, 0.0, 0.0, 0.0, 1.2, 7.5, 9.0],
    rainfallAvg: [1.0, 0.8, 1.9, 2.8, 3.4, 4.3, 4.0, 4.3, 3.1, 2.4, 1.8, 1.2],
    rainfallStdDev: [0.7, 0.6, 1.3, 1.5, 1.8, 2.2, 2.0, 2.3, 1.8, 1.5, 1.2, 0.9],
    avgHighTemp: [24, 29, 41, 57, 69, 79, 84, 81, 72, 58, 41, 28],
    avgLowTemp: [8, 13, 25, 38, 49, 59, 64, 62, 52, 40, 26, 13],
  },
  'seattle': {
    name: 'Seattle',
    state: 'WA',
    latitude: 47.6062,
    longitude: -122.3321,
    snowfallAvg: [1.5, 1.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 1.2],
    snowfallStdDev: [3.0, 2.5, 1.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8, 2.5],
    rainfallAvg: [5.1, 3.5, 3.7, 2.6, 2.0, 1.5, 0.8, 1.0, 1.5, 3.2, 5.6, 5.3],
    rainfallStdDev: [2.5, 2.0, 1.8, 1.5, 1.2, 1.0, 0.7, 0.8, 1.0, 1.8, 2.5, 2.5],
    avgHighTemp: [47, 50, 54, 59, 65, 70, 76, 77, 71, 60, 51, 45],
    avgLowTemp: [36, 37, 39, 43, 48, 53, 56, 57, 53, 46, 40, 35],
  },
  'miami': {
    name: 'Miami',
    state: 'FL',
    latitude: 25.7617,
    longitude: -80.1918,
    snowfallAvg: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snowfallStdDev: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rainfallAvg: [1.9, 2.2, 2.6, 3.4, 5.5, 9.7, 6.5, 8.9, 9.8, 6.3, 3.3, 2.2],
    rainfallStdDev: [1.5, 1.8, 2.0, 2.5, 3.5, 4.5, 3.5, 4.0, 4.5, 3.5, 2.5, 1.8],
    avgHighTemp: [76, 78, 80, 84, 87, 90, 91, 91, 89, 86, 82, 78],
    avgLowTemp: [60, 62, 65, 69, 74, 77, 79, 79, 78, 74, 68, 63],
  },
  'phoenix': {
    name: 'Phoenix',
    state: 'AZ',
    latitude: 33.4484,
    longitude: -112.0740,
    snowfallAvg: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snowfallStdDev: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rainfallAvg: [0.8, 0.9, 1.0, 0.3, 0.1, 0.0, 0.9, 0.9, 0.7, 0.6, 0.6, 0.9],
    rainfallStdDev: [0.8, 0.9, 1.0, 0.5, 0.2, 0.1, 1.0, 1.0, 0.8, 0.7, 0.7, 0.9],
    avgHighTemp: [67, 71, 77, 85, 95, 104, 106, 104, 100, 89, 76, 66],
    avgLowTemp: [45, 48, 53, 60, 69, 78, 84, 83, 77, 65, 52, 44],
  },
};

// =============================================================================
// MARKET DETECTION
// =============================================================================

/**
 * Parse a weather market to extract city, measurement type, and threshold
 */
function parseWeatherMarket(market: Market): {
  city: string | null;
  measurementType: 'snow' | 'rain' | 'temperature' | null;
  threshold: number | null;
  month: number | null; // 0-11
  unit: string;
} | null {
  const title = (market.title ?? '').toLowerCase();
  const ticker = (market.ticker ?? '').toUpperCase();

  // Try to detect city
  let city: string | null = null;
  for (const [key, data] of Object.entries(CITY_CLIMATE_DATA)) {
    if (title.includes(data.name.toLowerCase()) ||
        title.includes(key.replace('_', ' ')) ||
        ticker.includes(key.toUpperCase().replace('_', ''))) {
      city = key;
      break;
    }
  }

  // Common city name variations
  if (!city) {
    if (title.includes('la ') || title.includes('l.a.') || title.includes('los angeles')) city = 'los_angeles';
    else if (title.includes('nyc') || title.includes('new york')) city = 'new_york';
    else if (title.includes('chi') && title.includes('snow')) city = 'chicago';
    else if (title.includes('denver')) city = 'denver';
    else if (title.includes('boston')) city = 'boston';
    else if (title.includes('minneapolis') || title.includes('twin cities')) city = 'minneapolis';
    else if (title.includes('seattle')) city = 'seattle';
    else if (title.includes('miami')) city = 'miami';
    else if (title.includes('phoenix')) city = 'phoenix';
  }

  if (!city) return null;

  // Detect measurement type
  let measurementType: 'snow' | 'rain' | 'temperature' | null = null;
  let unit = '';

  if (title.includes('snow') || title.includes('snowfall')) {
    measurementType = 'snow';
    unit = 'inches';
  } else if (title.includes('rain') || title.includes('rainfall') || title.includes('precipitation')) {
    measurementType = 'rain';
    unit = 'inches';
  } else if (title.includes('temperature') || title.includes('degrees') || title.includes('°f')) {
    measurementType = 'temperature';
    unit = '°F';
  }

  if (!measurementType) return null;

  // Extract threshold number
  const thresholdMatch = title.match(/(\d+\.?\d*)\s*(inches?|"|in\b|degrees?|°f?)/i) ||
                         title.match(/(above|over|more than|at least)\s*(\d+\.?\d*)/i) ||
                         title.match(/(\d+\.?\d*)\s*(or more|plus|\+)/i);

  let threshold: number | null = null;
  if (thresholdMatch) {
    // Find the numeric group
    for (const group of thresholdMatch) {
      const num = parseFloat(group);
      if (!isNaN(num) && num > 0 && num < 200) {
        threshold = num;
        break;
      }
    }
  }

  // Try to extract from ticker (e.g., KXCHISNOW-10)
  if (!threshold) {
    const tickerMatch = ticker.match(/(\d+)/);
    if (tickerMatch) {
      threshold = parseFloat(tickerMatch[1]);
    }
  }

  // Detect month
  let month: number | null = null;
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
  const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  for (let i = 0; i < months.length; i++) {
    if (title.includes(months[i]) || title.includes(shortMonths[i])) {
      month = i;
      break;
    }
  }

  // Check for "this month" - use current month
  if (month === null && (title.includes('this month') || title.includes('monthly'))) {
    month = new Date().getMonth();
  }

  return { city, measurementType, threshold, month, unit };
}

// =============================================================================
// PROBABILITY CALCULATION
// =============================================================================

/**
 * Calculate probability of exceeding threshold using normal distribution
 * Based on historical average and standard deviation
 */
function calculateExceedanceProbability(
  threshold: number,
  currentTotal: number,
  daysRemaining: number,
  monthlyAverage: number,
  monthlyStdDev: number
): number {
  // Remaining amount needed
  const remaining = threshold - currentTotal;

  if (remaining <= 0) {
    // Already exceeded threshold
    return 1.0;
  }

  // Calculate expected remaining based on days left in month
  const totalDaysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysPassed = totalDaysInMonth - daysRemaining;

  // Proportion of month remaining
  const proportionRemaining = daysRemaining / totalDaysInMonth;

  // Expected remaining accumulation
  const expectedRemaining = monthlyAverage * proportionRemaining;
  const stdDevRemaining = monthlyStdDev * Math.sqrt(proportionRemaining); // Scale std dev

  if (stdDevRemaining === 0) {
    // No variance (e.g., LA snow) - either 0 or 100%
    return expectedRemaining >= remaining ? 0.95 : 0.05;
  }

  // Z-score: how many std devs away from expected is our threshold
  const zScore = (remaining - expectedRemaining) / stdDevRemaining;

  // Convert to probability using approximation of normal CDF
  // P(X > threshold) = 1 - P(X < threshold) = 1 - Φ(z)
  const probability = 1 - normalCDF(zScore);

  // Clamp to reasonable bounds
  return Math.max(0.02, Math.min(0.98, probability));
}

/**
 * Approximation of standard normal CDF
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z / 2);

  return 0.5 * (1.0 + sign * y);
}

// =============================================================================
// CURRENT WEATHER FETCHING
// =============================================================================

/**
 * Fetch current month-to-date precipitation/snow from Open-Meteo Historical API
 */
async function fetchMonthToDateWeather(
  city: string
): Promise<{ snow: number; rain: number } | null> {
  const climateData = CITY_CLIMATE_DATA[city];
  if (!climateData) return null;

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Format dates for API
    const startDate = startOfMonth.toISOString().split('T')[0];
    const endDate = yesterday.toISOString().split('T')[0];

    // Don't fetch if we're on the 1st of the month
    if (startOfMonth.getDate() === now.getDate()) {
      return { snow: 0, rain: 0 };
    }

    const params = new URLSearchParams({
      latitude: climateData.latitude.toString(),
      longitude: climateData.longitude.toString(),
      start_date: startDate,
      end_date: endDate,
      daily: 'precipitation_sum,snowfall_sum',
      temperature_unit: 'fahrenheit',
      precipitation_unit: 'inch',
      timezone: 'America/New_York',
    });

    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);

    if (!response.ok) {
      logger.debug(`Open-Meteo historical failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      daily?: {
        precipitation_sum?: number[];
        snowfall_sum?: number[];
      };
    };

    if (!data.daily) return null;

    // Sum up precipitation and snowfall for the month
    const rain = (data.daily.precipitation_sum ?? []).reduce((a, b) => a + (b ?? 0), 0);
    const snow = (data.daily.snowfall_sum ?? []).reduce((a, b) => a + (b ?? 0), 0);

    return { rain, snow };
  } catch (error) {
    logger.debug(`Failed to fetch MTD weather for ${city}: ${error}`);
    return null;
  }
}

/**
 * Get remaining days in current month
 */
function getDaysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

// =============================================================================
// EDGE DETECTION
// =============================================================================

/**
 * Analyze city weather markets for edges
 */
export async function analyzeCityWeatherMarkets(
  markets: Market[],
  minEdge: number = 0.08
): Promise<CityWeatherEdge[]> {
  const edges: CityWeatherEdge[] = [];
  const currentMonth = new Date().getMonth();
  const daysRemaining = getDaysRemainingInMonth();

  // Group markets by city to batch weather fetches
  const marketsByCity: Record<string, Array<{ market: Market; parsed: ReturnType<typeof parseWeatherMarket> }>> = {};

  for (const market of markets) {
    const parsed = parseWeatherMarket(market);
    if (!parsed || !parsed.city || !parsed.threshold) continue;

    // Only analyze markets for current month or unspecified month
    if (parsed.month !== null && parsed.month !== currentMonth) continue;

    if (!marketsByCity[parsed.city]) {
      marketsByCity[parsed.city] = [];
    }
    marketsByCity[parsed.city].push({ market, parsed });
  }

  // Process each city
  for (const [city, cityMarkets] of Object.entries(marketsByCity)) {
    const climateData = CITY_CLIMATE_DATA[city];
    if (!climateData) continue;

    // Fetch current month-to-date weather
    const mtdWeather = await fetchMonthToDateWeather(city);

    for (const { market, parsed } of cityMarkets) {
      if (!parsed || !parsed.measurementType || !parsed.threshold) continue;

      let currentTotal = 0;
      let monthlyAvg = 0;
      let monthlyStdDev = 0;

      if (parsed.measurementType === 'snow') {
        currentTotal = mtdWeather?.snow ?? 0;
        monthlyAvg = climateData.snowfallAvg[currentMonth];
        monthlyStdDev = climateData.snowfallStdDev[currentMonth];
      } else if (parsed.measurementType === 'rain') {
        currentTotal = mtdWeather?.rain ?? 0;
        monthlyAvg = climateData.rainfallAvg[currentMonth];
        monthlyStdDev = climateData.rainfallStdDev[currentMonth];
      }

      // Calculate probability based on climatology
      const probabilityAbove = calculateExceedanceProbability(
        parsed.threshold,
        currentTotal,
        daysRemaining,
        monthlyAvg,
        monthlyStdDev
      );

      const kalshiPrice = market.price;
      const edge = probabilityAbove - kalshiPrice;
      const absEdge = Math.abs(edge);

      if (absEdge < minEdge) continue;

      const direction = edge > 0 ? 'buy_yes' : 'buy_no';

      // Confidence based on data quality and edge magnitude
      let confidence = 0.55;
      if (mtdWeather) confidence += 0.1; // Have actual MTD data
      if (absEdge > 0.15) confidence += 0.1;
      if (daysRemaining <= 7) confidence += 0.1; // Near month end = more certain
      confidence = Math.min(0.85, confidence);

      // CRITICAL: Early in month, data is unreliable
      // Reduce confidence significantly for first 3 days of month
      const dayOfMonth = new Date().getDate();
      if (dayOfMonth <= 3) {
        confidence = Math.min(0.35, confidence);
        // Skip very large edges early in month - likely data issues
        if (absEdge > 0.50) {
          logger.debug(`Skipping ${city} ${parsed.measurementType}: ${(absEdge * 100).toFixed(0)}% edge on day ${dayOfMonth} (too early in month)`);
          continue;
        }
      }

      // Require minimum confidence for large edges
      if (absEdge > 0.40 && confidence < 0.50) {
        logger.debug(`Skipping ${city}: ${(absEdge * 100).toFixed(0)}% edge but only ${(confidence * 100).toFixed(0)}% confidence`);
        continue;
      }

      const reasoning = `${climateData.name} ${parsed.measurementType}: ` +
        `MTD=${currentTotal.toFixed(1)}${parsed.unit}, ` +
        `Need=${(parsed.threshold - currentTotal).toFixed(1)}${parsed.unit} more, ` +
        `${daysRemaining}d left. ` +
        `Historical avg: ${monthlyAvg.toFixed(1)}${parsed.unit}/mo (σ=${monthlyStdDev.toFixed(1)}). ` +
        `Climatological P(>${parsed.threshold})=${(probabilityAbove * 100).toFixed(0)}% vs Kalshi ${(kalshiPrice * 100).toFixed(0)}%`;

      edges.push({
        market,
        city: climateData.name,
        measurementType: parsed.measurementType,
        threshold: parsed.threshold,
        unit: parsed.unit,
        currentMonthTotal: currentTotal,
        daysRemaining,
        historicalAverage: monthlyAvg,
        historicalStdDev: monthlyStdDev,
        probabilityAboveThreshold: probabilityAbove,
        kalshiPrice,
        edge,
        direction,
        confidence,
        reasoning,
      });
    }
  }

  // Sort by edge magnitude
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

  if (edges.length > 0) {
    logger.info(`Found ${edges.length} city weather edges`);
  }

  return edges;
}

/**
 * Convert city weather edge to EdgeOpportunity
 */
export function cityWeatherEdgeToOpportunity(edge: CityWeatherEdge): EdgeOpportunity {
  return {
    market: edge.market,
    source: 'sentiment', // Categorize under macro/sentiment
    edge: Math.abs(edge.edge),
    confidence: edge.confidence,
    urgency: Math.abs(edge.edge) > 0.15 ? 'critical' : 'standard',
    direction: edge.direction === 'buy_yes' ? 'BUY YES' : 'BUY NO',
    signals: {
      weatherBias: edge.reasoning,
    },
  };
}

/**
 * Format city weather edges report
 */
export function formatCityWeatherReport(edges: CityWeatherEdge[]): string {
  if (edges.length === 0) {
    return 'No city weather edges found.';
  }

  const lines: string[] = [
    '**🌦️ City Weather Market Analysis**',
    '═══════════════════════════════════',
    '',
    '*Using NOAA 30-year climate normals + current month accumulation*',
    '',
  ];

  for (const edge of edges.slice(0, 5)) {
    const dirIcon = edge.direction === 'buy_yes' ? '📈' : '📉';
    const weatherIcon = edge.measurementType === 'snow' ? '❄️' :
                        edge.measurementType === 'rain' ? '🌧️' : '🌡️';

    lines.push(`${dirIcon} ${weatherIcon} **${edge.market.title?.slice(0, 55)}**`);
    lines.push(`   📍 ${edge.city} | ${edge.measurementType} | Threshold: ${edge.threshold}${edge.unit}`);
    lines.push(`   📊 MTD: ${edge.currentMonthTotal.toFixed(1)}${edge.unit} | ${edge.daysRemaining}d remaining`);
    lines.push(`   📉 Historical: ${edge.historicalAverage.toFixed(1)}${edge.unit}/mo avg`);
    lines.push(`   🎯 Climatological: ${(edge.probabilityAboveThreshold * 100).toFixed(0)}% | Kalshi: ${(edge.kalshiPrice * 100).toFixed(0)}%`);
    lines.push(`   💰 Edge: ${(edge.edge * 100).toFixed(1)}% | ${edge.direction.toUpperCase()} | Conf: ${(edge.confidence * 100).toFixed(0)}%`);
    lines.push('');
  }

  lines.push('*Edge source: NOAA climate normals + Open-Meteo MTD accumulation*');

  return lines.join('\n');
}
