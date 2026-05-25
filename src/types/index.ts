// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

export interface GeolocationData {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  continent: string | null;
  latitude: string | null;
  longitude: string | null;
}

export interface MiddlewareConfig {
  allowedCountries: string[];
  blockedCountries: string[];
}

export interface Env {
  ALLOWED_COUNTRIES?: string;
  BLOCKED_COUNTRIES?: string;
  SIGNING_SECRET?: string;
}

export interface GeoHeaders {
  "X-Edge-Geo-Country": string;
  "X-Edge-Geo-Region": string;
  "X-Edge-Geo-City": string;
  "X-Edge-Geo-Timezone": string;
  "X-Edge-Geo-Continent": string;
  "X-Edge-Geo-Latitude": string;
  "X-Edge-Geo-Longitude": string;
  "X-Edge-Geo-Signature": string;
}
