// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import { signGeoPayload } from "./utils/crypto";
import type { Env, GeolocationData, GeoHeaders, MiddlewareConfig } from "./types";

function parseCommaList(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) return [];
  return value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function buildConfig(env: Env): MiddlewareConfig {
  return {
    allowedCountries: parseCommaList(env.ALLOWED_COUNTRIES),
    blockedCountries: parseCommaList(env.BLOCKED_COUNTRIES),
  };
}

function extractGeo(request: Request): GeolocationData {
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;

  if (!cf || typeof cf !== "object") {
    return {
      country: null,
      region: null,
      city: null,
      timezone: null,
      continent: null,
      latitude: null,
      longitude: null,
    };
  }

  const truncate = (val: unknown, decimals = 1): string | null => {
    if (typeof val !== "number" && typeof val !== "string") return null;
    const num = typeof val === "string" ? Number.parseFloat(val) : val;
    if (Number.isNaN(num)) return null;
    return num.toFixed(decimals);
  };

  return {
    country: typeof cf.country === "string" ? cf.country.toUpperCase() : null,
    region: typeof cf.region === "string" ? cf.region : null,
    city: typeof cf.city === "string" ? cf.city : null,
    timezone: typeof cf.timezone === "string" ? cf.timezone : null,
    continent: typeof cf.continent === "string" ? cf.continent : null,
    latitude: truncate(cf.latitude),
    longitude: truncate(cf.longitude),
  };
}

function isBlocked(geo: GeolocationData, config: MiddlewareConfig): boolean {
  const { allowedCountries, blockedCountries } = config;

  if (blockedCountries.length > 0 && geo.country && blockedCountries.includes(geo.country)) {
    return true;
  }

  if (allowedCountries.length > 0 && geo.country && !allowedCountries.includes(geo.country)) {
    return true;
  }

  return false;
}

function buildGeoHeaders(geo: GeolocationData, signature: string): GeoHeaders {
  return {
    "X-Edge-Geo-Country": geo.country ?? "XX",
    "X-Edge-Geo-Region": geo.region ?? "unknown",
    "X-Edge-Geo-City": geo.city ?? "unknown",
    "X-Edge-Geo-Timezone": geo.timezone ?? "unknown",
    "X-Edge-Geo-Continent": geo.continent ?? "unknown",
    "X-Edge-Geo-Latitude": geo.latitude ?? "unknown",
    "X-Edge-Geo-Longitude": geo.longitude ?? "unknown",
    "X-Edge-Geo-Signature": signature,
  };
}

async function buildSignedPayload(geo: GeolocationData): Promise<string> {
  return [
    geo.country ?? "XX",
    geo.region ?? "unknown",
    geo.city ?? "unknown",
    geo.timezone ?? "unknown",
    geo.continent ?? "unknown",
  ].join("|");
}

function buildBlockResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "Acesso bloqueado pela política de geolocalização da borda.",
      code: "GEO_BLOCKED",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "X-Edge-Geo-Blocked": "true",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const config = buildConfig(env);
      const geo = extractGeo(request);

      if (isBlocked(geo, config)) {
        return buildBlockResponse();
      }

      const payload = await buildSignedPayload(geo);
      const signature = await signGeoPayload(payload, env.SIGNING_SECRET);
      const geoHeaders = buildGeoHeaders(geo, signature);

      const requestWithGeo = new Request(request);

      for (const [key, value] of Object.entries(geoHeaders)) {
        requestWithGeo.headers.set(key, value);
      }

      const response = await fetch(requestWithGeo);

      const enrichedResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(geoHeaders)) {
        enrichedResponse.headers.set(key, value);
      }

      return enrichedResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro interno desconhecido";
      return new Response(JSON.stringify({ error: message, code: "INTERNAL_ERROR" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
