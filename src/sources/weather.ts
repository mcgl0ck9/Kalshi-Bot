/**
 * Game-Day Weather Data Source (v4)
 *
 * Fetches weather conditions for outdoor sports venues using Open-Meteo API.
 * Weather factors impact NFL/MLB games: wind, rain, cold, heat.
 *
 * Migrated from src/fetchers/weather.ts
 */

import { defineSource, type Category } from '../core/index.js';
import { logger } from '../utils/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WeatherConditions {
  temperature: number;         // Fahrenheit
  feelsLike: number;
  humidity: number;            // Percentage
  windSpeed: number;           // MPH
  windGust?: number;           // MPH
  windDirection: string;       // e.g., "NW"
  precipitation: number;       // Probability 0-100
  precipitationType?: 'rain' | 'snow' | 'sleet' | 'none';
  cloudCover: number;          // Percentage
  visibility: number;          // Miles
  description: string;         // e.g., "Partly cloudy"
}

export interface WeatherImpact {
  overallScore: number;        // 0-100, higher = more impact
  passingImpact: number;       // 0-100
  kickingImpact: number;       // 0-100
  runningImpact: number;       // 0-100
  scoringImpact: 'higher' | 'lower' | 'neutral';
  favoredStyle: 'passing' | 'running' | 'balanced';
  alerts: string[];
}

export interface VenueWeather {
  venue: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  isOutdoor: boolean;
  conditions: WeatherConditions;
  impact: WeatherImpact;
  source: string;
}

export interface WeatherData {
  venues: VenueWeather[];
  lastUpdated: string;
}

// =============================================================================
// VENUE DATA
// =============================================================================

interface VenueInfo {
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  outdoor: boolean;
  teams: string[];
}

const NFL_OUTDOOR_VENUES: VenueInfo[] = [
  { name: 'GEHA Field at Arrowhead Stadium', city: 'Kansas City', state: 'MO', latitude: 39.0489, longitude: -94.4839, outdoor: true, teams: ['chiefs'] },
  { name: 'Lambeau Field', city: 'Green Bay', state: 'WI', latitude: 44.5013, longitude: -88.0622, outdoor: true, teams: ['packers'] },
  { name: 'Soldier Field', city: 'Chicago', state: 'IL', latitude: 41.8623, longitude: -87.6167, outdoor: true, teams: ['bears'] },
  { name: 'Acrisure Stadium', city: 'Pittsburgh', state: 'PA', latitude: 40.4468, longitude: -80.0158, outdoor: true, teams: ['steelers'] },
  { name: 'Cleveland Browns Stadium', city: 'Cleveland', state: 'OH', latitude: 41.5061, longitude: -81.6995, outdoor: true, teams: ['browns'] },
  { name: 'Paycor Stadium', city: 'Cincinnati', state: 'OH', latitude: 39.0954, longitude: -84.5160, outdoor: true, teams: ['bengals'] },
  { name: 'Highmark Stadium', city: 'Orchard Park', state: 'NY', latitude: 42.7738, longitude: -78.7870, outdoor: true, teams: ['bills'] },
  { name: 'Gillette Stadium', city: 'Foxborough', state: 'MA', latitude: 42.0909, longitude: -71.2643, outdoor: true, teams: ['patriots'] },
  { name: 'MetLife Stadium', city: 'East Rutherford', state: 'NJ', latitude: 40.8128, longitude: -74.0742, outdoor: true, teams: ['giants', 'jets'] },
  { name: 'Lincoln Financial Field', city: 'Philadelphia', state: 'PA', latitude: 39.9008, longitude: -75.1675, outdoor: true, teams: ['eagles'] },
  { name: 'Lumen Field', city: 'Seattle', state: 'WA', latitude: 47.5952, longitude: -122.3316, outdoor: true, teams: ['seahawks'] },
  { name: "Levi's Stadium", city: 'Santa Clara', state: 'CA', latitude: 37.4033, longitude: -121.9695, outdoor: true, teams: ['49ers'] },
  { name: 'Empower Field at Mile High', city: 'Denver', state: 'CO', latitude: 39.7439, longitude: -105.0201, outdoor: true, teams: ['broncos'] },
];

// =============================================================================
// SOURCE DEFINITION
// =============================================================================

export default defineSource<WeatherData>({
  name: 'weather',
  category: 'sports' as Category,
  cacheTTL: 1800,  // 30 minutes

  async fetch(): Promise<WeatherData> {
    const venues: VenueWeather[] = [];

    // Fetch weather for outdoor venues in parallel
    const results = await Promise.allSettled(
      NFL_OUTDOOR_VENUES.map(venue => fetchVenueWeather(venue))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        venues.push(result.value);
      }
    }

    logger.info(`Fetched weather for ${venues.length} venues`);

    return {
      venues,
      lastUpdated: new Date().toISOString(),
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    cloud_cover: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
  };
}

async function fetchVenueWeather(venue: VenueInfo): Promise<VenueWeather | null> {
  try {
    const params = new URLSearchParams({
      latitude: venue.latitude.toString(),
      longitude: venue.longitude.toString(),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'America/New_York',
    });

    const response = await fetch(`${OPEN_METEO_URL}?${params}`);
    if (!response.ok) return null;

    const data = await response.json() as OpenMeteoResponse;
    if (!data.current) return null;

    const conditions = parseConditions(data.current);
    const impact = calculateFootballImpact(conditions);

    return {
      venue: venue.name,
      city: venue.city,
      state: venue.state,
      latitude: venue.latitude,
      longitude: venue.longitude,
      isOutdoor: venue.outdoor,
      conditions,
      impact,
      source: 'Open-Meteo',
    };
  } catch (error) {
    logger.debug(`Weather fetch failed for ${venue.name}: ${error}`);
    return null;
  }
}

function parseConditions(data: NonNullable<OpenMeteoResponse['current']>): WeatherConditions {
  return {
    temperature: Math.round(data.temperature_2m),
    feelsLike: Math.round(data.apparent_temperature),
    humidity: data.relative_humidity_2m,
    windSpeed: Math.round(data.wind_speed_10m),
    windGust: data.wind_gusts_10m ? Math.round(data.wind_gusts_10m) : undefined,
    windDirection: degreesToCompass(data.wind_direction_10m),
    precipitation: 0,
    cloudCover: data.cloud_cover,
    visibility: 10,
    description: weatherCodeToDescription(data.weather_code),
  };
}

function degreesToCompass(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(degrees / 22.5) % 16];
}

function weatherCodeToDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
  };
  return descriptions[code] ?? 'Unknown';
}

function calculateFootballImpact(conditions: WeatherConditions): WeatherImpact {
  const alerts: string[] = [];
  let overallScore = 0;
  let passingImpact = 0;
  let kickingImpact = 0;
  let runningImpact = 0;

  // Wind impact
  if (conditions.windSpeed >= 20) {
    passingImpact += 40;
    kickingImpact += 50;
    alerts.push(`High winds (${conditions.windSpeed} mph)`);
    overallScore += 35;
  } else if (conditions.windSpeed >= 15) {
    passingImpact += 25;
    kickingImpact += 35;
    overallScore += 20;
  }

  // Cold weather impact
  if (conditions.temperature <= 32) {
    passingImpact += 20;
    kickingImpact += 15;
    alerts.push(`Freezing (${conditions.temperature}F)`);
    overallScore += 20;
  } else if (conditions.temperature <= 40) {
    passingImpact += 10;
    kickingImpact += 10;
    overallScore += 10;
  }

  // Heat impact
  if (conditions.feelsLike >= 95) {
    alerts.push(`Extreme heat (${conditions.feelsLike}F feels like)`);
    overallScore += 15;
  }

  // Snow impact
  if (conditions.description.toLowerCase().includes('snow')) {
    passingImpact += 35;
    kickingImpact += 40;
    alerts.push('Snow conditions');
    overallScore += 40;
  }

  const scoringImpact: 'higher' | 'lower' | 'neutral' =
    overallScore >= 30 ? 'lower' : 'neutral';

  const favoredStyle: 'passing' | 'running' | 'balanced' =
    passingImpact > 30 ? 'running' : 'balanced';

  return {
    overallScore: Math.min(100, overallScore),
    passingImpact: Math.min(100, passingImpact),
    kickingImpact: Math.min(100, kickingImpact),
    runningImpact: Math.min(100, runningImpact),
    scoringImpact,
    favoredStyle,
    alerts,
  };
}

// =============================================================================
// EXPORTS FOR EDGE ANALYSIS
// =============================================================================

/**
 * Find weather for a team's venue.
 */
export function getTeamWeather(
  data: WeatherData,
  team: string
): VenueWeather | null {
  const teamLower = team.toLowerCase();
  return data.venues.find(v =>
    NFL_OUTDOOR_VENUES.find(nv =>
      nv.teams.some(t => teamLower.includes(t))
    )?.name === v.venue
  ) ?? null;
}

/**
 * Calculate weather edge for a matchup.
 * Returns positive value if weather favors home team.
 */
export function calculateWeatherEdge(
  data: WeatherData,
  homeTeam: string
): { edge: number; reason: string } | null {
  const weather = getTeamWeather(data, homeTeam);
  if (!weather) return null;

  const impact = weather.impact;
  if (impact.overallScore < 20) {
    return null;  // Weather not impactful enough
  }

  // Home teams with weather experience have an edge
  const edge = impact.overallScore * 0.002;  // ~2% edge per 10 impact points
  const reason = impact.alerts.join(', ') || `Weather impact score: ${impact.overallScore}`;

  return { edge, reason };
}
