import type { NFLGame } from './types';

export type NFLGameEnvironment = 'INDOOR' | 'OUTDOOR' | 'UNKNOWN';
export type NFLWeatherSourceStatus = 'AVAILABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface NFLWeatherContext {
  venue: NFLGame['venue'];
  environment: NFLGameEnvironment;
  kickoff: string;
  temperature: { value: number; unit: 'F' } | null;
  wind: { speed: number; unit: 'mph' } | null;
  gusts: { speed: number; unit: 'mph' } | null;
  precipitation: { amount: number; unit: 'in' } | null;
  conditions: string | null;
  severeConditions: string[];
  forecastTimestamp: string | null;
  sourceStatus: NFLWeatherSourceStatus;
  sources: { venue: 'ESPN'; geocode: 'OpenStreetMap Nominatim' | null; forecast: 'Open-Meteo' | null };
  missingFields: string[];
}

interface VenueCoordinates { latitude: number; longitude: number }

interface OpenMeteoForecast {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    precipitation?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
}

const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Light freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

const SEVERE_WMO = new Set([65, 67, 75, 82, 86, 95, 96, 99]);
const geocodeCache = new Map<string, Promise<VenueCoordinates | null>>();
let geocodeQueue: Promise<void> = Promise.resolve();
let lastGeocodeAt = 0;

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchExactVenueCoordinates(game: NFLGame): Promise<VenueCoordinates | null> {
  if (!game.venue) return null;
  const key = [game.venue.name, game.venue.city, game.venue.state, game.venue.country].filter(Boolean).join(', ');
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  const request = geocodeQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastGeocodeAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', key);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '3');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'DeepSide/1.0 NFL venue weather research' },
      next: { revalidate: 30 * 24 * 60 * 60 },
    });
    if (!response.ok) return null;
    const results = await response.json() as Array<{ display_name?: string; lat?: string; lon?: string; type?: string; address?: Record<string, string> }>;
    const venueName = normalized(game.venue!.name);
    const result = results.find((entry) => {
      if (entry.type !== 'stadium') return false;
      const namedPlace = entry.address?.building ?? entry.address?.leisure ?? entry.address?.amenity ?? entry.display_name?.split(',')[0] ?? '';
      return normalized(namedPlace) === venueName;
    });
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  });
  geocodeQueue = request.then(() => undefined, () => undefined);
  geocodeCache.set(key, request);
  return request;
}

async function fetchKickoffForecast(coords: VenueCoordinates, kickoff: string): Promise<OpenMeteoForecast | null> {
  const date = kickoff.slice(0, 10);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coords.latitude));
  url.searchParams.set('longitude', String(coords.longitude));
  url.searchParams.set('hourly', 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  const response = await fetch(url, { headers: { accept: 'application/json' }, next: { revalidate: 15 * 60 } });
  return response.ok ? response.json() as Promise<OpenMeteoForecast> : null;
}

function unknownContext(game: NFLGame, missingFields: string[]): NFLWeatherContext {
  return {
    venue: game.venue ?? null, environment: game.venue?.indoor === false ? 'OUTDOOR' : 'UNKNOWN', kickoff: game.gameTime,
    temperature: null, wind: null, gusts: null, precipitation: null, conditions: null, severeConditions: [],
    forecastTimestamp: null, sourceStatus: 'UNKNOWN', sources: { venue: 'ESPN', geocode: null, forecast: null }, missingFields,
  };
}

export function parseNFLKickoffForecast(game: NFLGame, forecast: OpenMeteoForecast | null): NFLWeatherContext {
  if (!game.venue) return unknownContext(game, ['venue', 'indoor/outdoor status', 'temperature', 'wind', 'gusts', 'precipitation', 'conditions', 'forecast timestamp']);
  if (game.venue.indoor === true) {
    return {
      venue: game.venue, environment: 'INDOOR', kickoff: game.gameTime,
      temperature: null, wind: null, gusts: null, precipitation: null,
      conditions: 'Indoor venue; outdoor weather is not materially applicable.', severeConditions: [], forecastTimestamp: null,
      sourceStatus: 'NOT_APPLICABLE', sources: { venue: 'ESPN', geocode: null, forecast: null }, missingFields: ['roof open/closed status'],
    };
  }
  if (game.venue.indoor !== false) return unknownContext(game, ['indoor/outdoor status', 'temperature', 'wind', 'gusts', 'precipitation', 'conditions', 'forecast timestamp']);
  const times = forecast?.hourly?.time ?? [];
  const kickoffMs = new Date(game.gameTime).getTime();
  let selectedIndex = -1;
  let selectedDistance = Infinity;
  times.forEach((time, index) => {
    const distance = Math.abs(new Date(`${time}Z`).getTime() - kickoffMs);
    if (distance < selectedDistance) { selectedDistance = distance; selectedIndex = index; }
  });
  if (selectedIndex < 0 || selectedDistance > 90 * 60 * 1000) return unknownContext(game, ['kickoff-hour forecast', 'temperature', 'wind', 'gusts', 'precipitation', 'conditions']);
  const value = (values: Array<number | null> | undefined) => values?.[selectedIndex] ?? null;
  const temperature = value(forecast?.hourly?.temperature_2m);
  const wind = value(forecast?.hourly?.wind_speed_10m);
  const gusts = value(forecast?.hourly?.wind_gusts_10m);
  const precipitation = value(forecast?.hourly?.precipitation);
  const weatherCode = value(forecast?.hourly?.weather_code);
  const missingFields: string[] = [];
  if (temperature == null) missingFields.push('temperature');
  if (wind == null) missingFields.push('wind');
  if (gusts == null) missingFields.push('gusts');
  if (precipitation == null) missingFields.push('precipitation');
  if (weatherCode == null || WMO_CONDITIONS[weatherCode] == null) missingFields.push('conditions');
  const conditions = weatherCode == null ? null : WMO_CONDITIONS[weatherCode] ?? null;
  return {
    venue: game.venue, environment: 'OUTDOOR', kickoff: game.gameTime,
    temperature: temperature == null ? null : { value: temperature, unit: 'F' },
    wind: wind == null ? null : { speed: wind, unit: 'mph' },
    gusts: gusts == null ? null : { speed: gusts, unit: 'mph' },
    precipitation: precipitation == null ? null : { amount: precipitation, unit: 'in' },
    conditions,
    severeConditions: weatherCode != null && SEVERE_WMO.has(weatherCode) && conditions ? [conditions] : [],
    forecastTimestamp: `${times[selectedIndex]}Z`,
    sourceStatus: missingFields.length ? 'UNKNOWN' : 'AVAILABLE',
    sources: { venue: 'ESPN', geocode: 'OpenStreetMap Nominatim', forecast: 'Open-Meteo' },
    missingFields,
  };
}

export async function getNFLWeatherContext(game: NFLGame): Promise<NFLWeatherContext> {
  if (game.venue?.indoor === true || game.venue?.indoor == null) return parseNFLKickoffForecast(game, null);
  try {
    const coordinates = await fetchExactVenueCoordinates(game);
    if (!coordinates) return unknownContext(game, ['exact venue coordinates', 'temperature', 'wind', 'gusts', 'precipitation', 'conditions', 'forecast timestamp']);
    return parseNFLKickoffForecast(game, await fetchKickoffForecast(coordinates, game.gameTime));
  } catch {
    return unknownContext(game, ['weather provider unavailable', 'temperature', 'wind', 'gusts', 'precipitation', 'conditions', 'forecast timestamp']);
  }
}