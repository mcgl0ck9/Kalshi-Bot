/**
 * Game-Day Weather Fetcher
 *
 * Fetches weather conditions for outdoor sports venues:
 * - NFL stadiums (outdoor only)
 * - MLB ballparks (most are outdoor)
 * - MLS/Soccer stadiums
 *
 * Weather factors that impact games:
 * - Wind: Affects passing/kicking (NFL), home runs (MLB)
 * - Rain: Slows play, fumbles, run-heavy games
 * - Cold: Favors run game, reduces scoring
 * - Heat: Endurance factor, injuries
 *
 * Uses Open-Meteo API (free, no key required)
 * Fallback: National Weather Service API (also free)
 */

import { logger } from '../utils/index.js';
import { fetchWithFallback, createSource, type FetchResult } from '../utils/resilient-fetch.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GameWeather {
  venue: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  gameTime: string;
  isOutdoor: boolean;
  isRetractableRoof: boolean;
  roofStatus?: 'open' | 'closed' | 'unknown';
  conditions: WeatherConditions;
  impact: WeatherImpact;
  source: string;
  fetchedAt: string;
}

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
  overallScore: number;        // 0-100, higher = more impact on game
  passingImpact: number;       // 0-100, impact on passing game
  kickingImpact: number;       // 0-100, impact on kicking
  runningImpact: number;       // 0-100, impact on running game
  scoringImpact: 'higher' | 'lower' | 'neutral';
  favoredStyle: 'passing' | 'running' | 'balanced';
  alerts: string[];            // Notable weather concerns
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
  retractable: boolean;
  teams: string[];
}

// NFL Stadiums (focusing on outdoor/retractable)
const NFL_VENUES: Record<string, VenueInfo> = {
  // Outdoor stadiums
  'arrowhead': { name: 'GEHA Field at Arrowhead Stadium', city: 'Kansas City', state: 'MO', latitude: 39.0489, longitude: -94.4839, outdoor: true, retractable: false, teams: ['chiefs', 'kansas city chiefs'] },
  'lambeau': { name: 'Lambeau Field', city: 'Green Bay', state: 'WI', latitude: 44.5013, longitude: -88.0622, outdoor: true, retractable: false, teams: ['packers', 'green bay packers'] },
  'soldier': { name: 'Soldier Field', city: 'Chicago', state: 'IL', latitude: 41.8623, longitude: -87.6167, outdoor: true, retractable: false, teams: ['bears', 'chicago bears'] },
  'heinz': { name: 'Acrisure Stadium', city: 'Pittsburgh', state: 'PA', latitude: 40.4468, longitude: -80.0158, outdoor: true, retractable: false, teams: ['steelers', 'pittsburgh steelers'] },
  'firstenergy': { name: 'Cleveland Browns Stadium', city: 'Cleveland', state: 'OH', latitude: 41.5061, longitude: -81.6995, outdoor: true, retractable: false, teams: ['browns', 'cleveland browns'] },
  'paycor': { name: 'Paycor Stadium', city: 'Cincinnati', state: 'OH', latitude: 39.0954, longitude: -84.5160, outdoor: true, retractable: false, teams: ['bengals', 'cincinnati bengals'] },
  'highmark': { name: 'Highmark Stadium', city: 'Orchard Park', state: 'NY', latitude: 42.7738, longitude: -78.7870, outdoor: true, retractable: false, teams: ['bills', 'buffalo bills'] },
  'gillette': { name: 'Gillette Stadium', city: 'Foxborough', state: 'MA', latitude: 42.0909, longitude: -71.2643, outdoor: true, retractable: false, teams: ['patriots', 'new england patriots'] },
  'metlife': { name: 'MetLife Stadium', city: 'East Rutherford', state: 'NJ', latitude: 40.8128, longitude: -74.0742, outdoor: true, retractable: false, teams: ['giants', 'jets', 'new york giants', 'new york jets'] },
  'lincoln': { name: 'Lincoln Financial Field', city: 'Philadelphia', state: 'PA', latitude: 39.9008, longitude: -75.1675, outdoor: true, retractable: false, teams: ['eagles', 'philadelphia eagles'] },
  'fedex': { name: 'FedExField', city: 'Landover', state: 'MD', latitude: 38.9076, longitude: -76.8645, outdoor: true, retractable: false, teams: ['commanders', 'washington commanders'] },
  'mtbank': { name: 'M&T Bank Stadium', city: 'Baltimore', state: 'MD', latitude: 39.2780, longitude: -76.6227, outdoor: true, retractable: false, teams: ['ravens', 'baltimore ravens'] },
  'nissan': { name: 'Nissan Stadium', city: 'Nashville', state: 'TN', latitude: 36.1665, longitude: -86.7713, outdoor: true, retractable: false, teams: ['titans', 'tennessee titans'] },
  'bank_america': { name: 'Bank of America Stadium', city: 'Charlotte', state: 'NC', latitude: 35.2258, longitude: -80.8528, outdoor: true, retractable: false, teams: ['panthers', 'carolina panthers'] },
  'raymond_james': { name: 'Raymond James Stadium', city: 'Tampa', state: 'FL', latitude: 27.9759, longitude: -82.5033, outdoor: true, retractable: false, teams: ['buccaneers', 'tampa bay buccaneers'] },
  'everbank': { name: 'EverBank Stadium', city: 'Jacksonville', state: 'FL', latitude: 30.3239, longitude: -81.6373, outdoor: true, retractable: false, teams: ['jaguars', 'jacksonville jaguars'] },
  'hard_rock': { name: 'Hard Rock Stadium', city: 'Miami Gardens', state: 'FL', latitude: 25.9580, longitude: -80.2389, outdoor: true, retractable: false, teams: ['dolphins', 'miami dolphins'] },
  'lumen': { name: 'Lumen Field', city: 'Seattle', state: 'WA', latitude: 47.5952, longitude: -122.3316, outdoor: true, retractable: false, teams: ['seahawks', 'seattle seahawks'] },
  'levis': { name: "Levi's Stadium", city: 'Santa Clara', state: 'CA', latitude: 37.4033, longitude: -121.9695, outdoor: true, retractable: false, teams: ['49ers', 'san francisco 49ers'] },
  'mile_high': { name: 'Empower Field at Mile High', city: 'Denver', state: 'CO', latitude: 39.7439, longitude: -105.0201, outdoor: true, retractable: false, teams: ['broncos', 'denver broncos'] },
  'allegiant': { name: 'Allegiant Stadium', city: 'Las Vegas', state: 'NV', latitude: 36.0909, longitude: -115.1833, outdoor: false, retractable: false, teams: ['raiders', 'las vegas raiders'] },

  // Retractable roof stadiums
  'sofi': { name: 'SoFi Stadium', city: 'Inglewood', state: 'CA', latitude: 33.9535, longitude: -118.3392, outdoor: false, retractable: true, teams: ['rams', 'chargers', 'la rams', 'la chargers'] },
  'state_farm': { name: 'State Farm Stadium', city: 'Glendale', state: 'AZ', latitude: 33.5276, longitude: -112.2626, outdoor: false, retractable: true, teams: ['cardinals', 'arizona cardinals'] },
  'att': { name: 'AT&T Stadium', city: 'Arlington', state: 'TX', latitude: 32.7473, longitude: -97.0945, outdoor: false, retractable: true, teams: ['cowboys', 'dallas cowboys'] },
  'nrg': { name: 'NRG Stadium', city: 'Houston', state: 'TX', latitude: 29.6847, longitude: -95.4107, outdoor: false, retractable: true, teams: ['texans', 'houston texans'] },
  'mercedes': { name: 'Mercedes-Benz Stadium', city: 'Atlanta', state: 'GA', latitude: 33.7553, longitude: -84.4006, outdoor: false, retractable: true, teams: ['falcons', 'atlanta falcons'] },
  'caesars': { name: 'Caesars Superdome', city: 'New Orleans', state: 'LA', latitude: 29.9511, longitude: -90.0812, outdoor: false, retractable: false, teams: ['saints', 'new orleans saints'] },
  'ford': { name: 'Ford Field', city: 'Detroit', state: 'MI', latitude: 42.3400, longitude: -83.0456, outdoor: false, retractable: false, teams: ['lions', 'detroit lions'] },
  'us_bank': { name: 'U.S. Bank Stadium', city: 'Minneapolis', state: 'MN', latitude: 44.9736, longitude: -93.2575, outdoor: false, retractable: false, teams: ['vikings', 'minnesota vikings'] },
  'lucas': { name: 'Lucas Oil Stadium', city: 'Indianapolis', state: 'IN', latitude: 39.7601, longitude: -86.1639, outdoor: false, retractable: true, teams: ['colts', 'indianapolis colts'] },
};

// MLB Ballparks (most are outdoor)
const MLB_VENUES: Record<string, VenueInfo> = {
  'yankee': { name: 'Yankee Stadium', city: 'Bronx', state: 'NY', latitude: 40.8296, longitude: -73.9262, outdoor: true, retractable: false, teams: ['yankees', 'new york yankees'] },
  'fenway': { name: 'Fenway Park', city: 'Boston', state: 'MA', latitude: 42.3467, longitude: -71.0972, outdoor: true, retractable: false, teams: ['red sox', 'boston red sox'] },
  'wrigley': { name: 'Wrigley Field', city: 'Chicago', state: 'IL', latitude: 41.9484, longitude: -87.6553, outdoor: true, retractable: false, teams: ['cubs', 'chicago cubs'] },
  'dodger': { name: 'Dodger Stadium', city: 'Los Angeles', state: 'CA', latitude: 34.0739, longitude: -118.2400, outdoor: true, retractable: false, teams: ['dodgers', 'los angeles dodgers'] },
  'coors': { name: 'Coors Field', city: 'Denver', state: 'CO', latitude: 39.7559, longitude: -104.9942, outdoor: true, retractable: false, teams: ['rockies', 'colorado rockies'] },
  // Add more as needed...
};

// =============================================================================
// OPEN-METEO API (Free, no key required)
// =============================================================================

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  current?: {
    time: string;
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
  hourly?: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    precipitation_probability: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
  };
}

/**
 * Fetch weather from Open-Meteo
 */
async function fetchOpenMeteoWeather(
  latitude: number,
  longitude: number,
  gameTime?: Date
): Promise<WeatherConditions | null> {
  try {
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'America/New_York',
      forecast_days: '3',
    });

    const response = await fetch(`${OPEN_METEO_URL}?${params}`);

    if (!response.ok) {
      logger.debug(`Open-Meteo failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as OpenMeteoResponse;

    if (!data.current) {
      return null;
    }

    const current = data.current;

    // If game time provided, try to get hourly forecast for that time
    let conditions = {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      windSpeed: Math.round(current.wind_speed_10m),
      windGust: current.wind_gusts_10m ? Math.round(current.wind_gusts_10m) : undefined,
      windDirection: degreesToCompass(current.wind_direction_10m),
      precipitation: 0,  // Current precipitation
      cloudCover: current.cloud_cover,
      visibility: 10,  // Default, Open-Meteo doesn't provide this
      description: weatherCodeToDescription(current.weather_code),
    };

    // Get precipitation probability from hourly data
    if (data.hourly && gameTime) {
      const gameHour = gameTime.getHours();
      const hourIndex = data.hourly.time.findIndex(t => {
        const hour = new Date(t).getHours();
        return hour === gameHour;
      });

      if (hourIndex >= 0) {
        conditions = {
          ...conditions,
          temperature: Math.round(data.hourly.temperature_2m[hourIndex]),
          humidity: data.hourly.relative_humidity_2m[hourIndex],
          precipitation: data.hourly.precipitation_probability[hourIndex],
          windSpeed: Math.round(data.hourly.wind_speed_10m[hourIndex]),
        };
      }
    }

    return conditions;
  } catch (error) {
    logger.debug(`Open-Meteo error: ${error}`);
    return null;
  }
}

/**
 * Convert degrees to compass direction
 */
function degreesToCompass(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Convert weather code to description
 */
function weatherCodeToDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return descriptions[code] ?? 'Unknown';
}

// =============================================================================
// WEATHER IMPACT ANALYSIS
// =============================================================================

/**
 * Calculate weather impact on a football game
 */
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
    alerts.push(`High winds (${conditions.windSpeed} mph) - passing/kicking heavily impacted`);
    overallScore += 35;
  } else if (conditions.windSpeed >= 15) {
    passingImpact += 25;
    kickingImpact += 35;
    alerts.push(`Moderate winds (${conditions.windSpeed} mph)`);
    overallScore += 20;
  } else if (conditions.windSpeed >= 10) {
    passingImpact += 10;
    kickingImpact += 15;
    overallScore += 10;
  }

  // Precipitation impact
  if (conditions.precipitation >= 70) {
    passingImpact += 30;
    runningImpact -= 10;  // Running is relatively better
    alerts.push(`High rain probability (${conditions.precipitation}%) - expect run-heavy game`);
    overallScore += 25;
  } else if (conditions.precipitation >= 40) {
    passingImpact += 15;
    overallScore += 15;
  }

  // Cold weather impact
  if (conditions.temperature <= 32) {
    passingImpact += 20;
    kickingImpact += 15;
    alerts.push(`Freezing conditions (${conditions.temperature}°F) - reduced scoring expected`);
    overallScore += 20;
  } else if (conditions.temperature <= 40) {
    passingImpact += 10;
    kickingImpact += 10;
    overallScore += 10;
  }

  // Heat impact
  if (conditions.temperature >= 90 || conditions.feelsLike >= 95) {
    alerts.push(`Extreme heat (feels like ${conditions.feelsLike}°F) - fatigue factor in 4th quarter`);
    overallScore += 15;
  }

  // Snow
  if (conditions.description.toLowerCase().includes('snow')) {
    passingImpact += 35;
    kickingImpact += 40;
    alerts.push('Snow expected - significant game impact');
    overallScore += 40;
  }

  // Determine scoring impact and favored style
  let scoringImpact: 'higher' | 'lower' | 'neutral' = 'neutral';
  let favoredStyle: 'passing' | 'running' | 'balanced' = 'balanced';

  if (overallScore >= 30) {
    scoringImpact = 'lower';
    favoredStyle = 'running';
  } else if (conditions.temperature >= 70 && conditions.windSpeed < 10 && conditions.precipitation < 20) {
    scoringImpact = 'higher';
    favoredStyle = 'passing';
  }

  if (passingImpact > 30) {
    favoredStyle = 'running';
  }

  return {
    overallScore: Math.min(100, overallScore),
    passingImpact: Math.min(100, passingImpact),
    kickingImpact: Math.min(100, kickingImpact),
    runningImpact: Math.min(100, Math.max(0, runningImpact)),
    scoringImpact,
    favoredStyle,
    alerts,
  };
}

/**
 * Calculate weather impact on a baseball game
 */
function calculateBaseballImpact(conditions: WeatherConditions): WeatherImpact {
  const alerts: string[] = [];
  let overallScore = 0;
  let passingImpact = 0;  // Represents hitting power
  let kickingImpact = 0;   // Represents pitching
  let runningImpact = 0;

  // Wind impact on home runs
  if (conditions.windSpeed >= 15) {
    if (conditions.windDirection.includes('N') || conditions.windDirection.includes('E')) {
      // Wind blowing in
      passingImpact -= 20;  // Fewer home runs
      alerts.push(`Wind blowing in (${conditions.windSpeed} mph ${conditions.windDirection}) - pitcher-friendly`);
    } else {
      // Wind blowing out
      passingImpact += 25;
      alerts.push(`Wind blowing out (${conditions.windSpeed} mph ${conditions.windDirection}) - home run boost`);
    }
    overallScore += 20;
  }

  // Temperature impact (hot = more offense)
  if (conditions.temperature >= 85) {
    passingImpact += 15;
    alerts.push(`Hot conditions (${conditions.temperature}°F) - ball carries well`);
    overallScore += 10;
  } else if (conditions.temperature <= 50) {
    passingImpact -= 15;
    alerts.push(`Cold conditions (${conditions.temperature}°F) - pitcher-friendly`);
    overallScore += 10;
  }

  // Rain impact
  if (conditions.precipitation >= 50) {
    alerts.push(`Rain likely (${conditions.precipitation}%) - possible delay/PPD`);
    overallScore += 30;
  }

  // Humidity at Coors Field type conditions
  if (conditions.humidity < 30) {
    passingImpact += 10;  // Dry air = ball carries
    overallScore += 5;
  }

  return {
    overallScore: Math.min(100, overallScore),
    passingImpact: Math.min(100, Math.max(0, 50 + passingImpact)),  // Centered at 50
    kickingImpact: Math.min(100, Math.max(0, 50 - passingImpact)),
    runningImpact: 0,
    scoringImpact: passingImpact > 10 ? 'higher' : passingImpact < -10 ? 'lower' : 'neutral',
    favoredStyle: 'balanced',
    alerts,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get weather for a specific venue
 */
export async function getVenueWeather(
  teamOrVenue: string,
  sport: 'nfl' | 'mlb' = 'nfl',
  gameTime?: Date
): Promise<FetchResult<GameWeather> | null> {
  const venues = sport === 'nfl' ? NFL_VENUES : MLB_VENUES;

  // Find venue by team name or venue key
  const searchTerm = teamOrVenue.toLowerCase();
  let venue: VenueInfo | undefined;
  let venueKey: string | undefined;

  for (const [key, v] of Object.entries(venues)) {
    if (key.includes(searchTerm) ||
        v.teams.some(t => t.includes(searchTerm)) ||
        v.city.toLowerCase().includes(searchTerm)) {
      venue = v;
      venueKey = key;
      break;
    }
  }

  if (!venue) {
    logger.debug(`Venue not found for: ${teamOrVenue}`);
    return null;
  }

  // Indoor stadiums don't need weather
  if (!venue.outdoor && !venue.retractable) {
    return {
      data: {
        venue: venue.name,
        city: venue.city,
        state: venue.state,
        latitude: venue.latitude,
        longitude: venue.longitude,
        gameTime: gameTime?.toISOString() ?? new Date().toISOString(),
        isOutdoor: false,
        isRetractableRoof: false,
        conditions: {
          temperature: 72,
          feelsLike: 72,
          humidity: 50,
          windSpeed: 0,
          windDirection: 'N/A',
          precipitation: 0,
          cloudCover: 0,
          visibility: 10,
          description: 'Indoor stadium',
        },
        impact: {
          overallScore: 0,
          passingImpact: 0,
          kickingImpact: 0,
          runningImpact: 0,
          scoringImpact: 'neutral',
          favoredStyle: 'balanced',
          alerts: ['Indoor stadium - weather not a factor'],
        },
        source: 'Indoor',
        fetchedAt: new Date().toISOString(),
      },
      source: 'Indoor',
      fromCache: false,
      timestamp: Date.now(),
    };
  }

  // Fetch weather with caching
  return fetchWithFallback<GameWeather>(
    `weather:${venueKey}:${gameTime?.toISOString().split('T')[0] ?? 'now'}`,
    [
      createSource('Open-Meteo', async () => {
        const conditions = await fetchOpenMeteoWeather(venue!.latitude, venue!.longitude, gameTime);
        if (!conditions) return null;

        const impact = sport === 'nfl'
          ? calculateFootballImpact(conditions)
          : calculateBaseballImpact(conditions);

        return {
          venue: venue!.name,
          city: venue!.city,
          state: venue!.state,
          latitude: venue!.latitude,
          longitude: venue!.longitude,
          gameTime: gameTime?.toISOString() ?? new Date().toISOString(),
          isOutdoor: venue!.outdoor,
          isRetractableRoof: venue!.retractable,
          conditions,
          impact,
          source: 'Open-Meteo',
          fetchedAt: new Date().toISOString(),
        };
      }),
    ],
    {
      cacheTTL: 30 * 60 * 1000,  // 30 minutes
      useStaleOnError: true,
      staleTTL: 2 * 60 * 60 * 1000,  // 2 hours
    }
  );
}

/**
 * Get weather for a matchup
 */
export async function getMatchupWeather(
  homeTeam: string,
  awayTeam: string,
  sport: 'nfl' | 'mlb' = 'nfl',
  gameTime?: Date
): Promise<GameWeather | null> {
  // Weather is at the home team's stadium
  const result = await getVenueWeather(homeTeam, sport, gameTime);
  return result?.data ?? null;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format weather for display
 */
export function formatGameWeather(weather: GameWeather): string {
  if (!weather.isOutdoor && !weather.isRetractableRoof) {
    return `🏟️ **${weather.venue}** (Indoor)\nWeather: Not a factor`;
  }

  const lines: string[] = [
    `🏟️ **${weather.venue}**`,
    `📍 ${weather.city}, ${weather.state}`,
    '',
    `🌡️ **${weather.conditions.temperature}°F** (feels like ${weather.conditions.feelsLike}°F)`,
    `💨 Wind: ${weather.conditions.windSpeed} mph ${weather.conditions.windDirection}${weather.conditions.windGust ? ` (gusts ${weather.conditions.windGust})` : ''}`,
    `🌧️ Precip: ${weather.conditions.precipitation}%`,
    `☁️ ${weather.conditions.description}`,
  ];

  if (weather.impact.alerts.length > 0) {
    lines.push('');
    lines.push('**⚠️ Weather Alerts:**');
    for (const alert of weather.impact.alerts) {
      lines.push(`• ${alert}`);
    }
  }

  if (weather.impact.overallScore >= 20) {
    lines.push('');
    lines.push(`**Game Impact:** ${weather.impact.overallScore}/100`);
    lines.push(`📊 Scoring: ${weather.impact.scoringImpact}`);
    lines.push(`🎯 Favors: ${weather.impact.favoredStyle} game`);
  }

  return lines.join('\n');
}
