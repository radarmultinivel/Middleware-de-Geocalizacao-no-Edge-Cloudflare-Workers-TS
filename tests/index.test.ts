// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Env } from "../src/types";

let worker: { fetch: (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } })),
  ));
  worker = (await import("../src/index")).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockRequest(cf: Record<string, unknown> | null): Request {
  const req = new Request("https://example.com/api/data");
  Object.defineProperty(req, "cf", { value: cf, writable: false });
  return req;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_COUNTRIES: "",
    BLOCKED_COUNTRIES: "CU,IR,KP,SY",
    SIGNING_SECRET: "",
    ...overrides,
  };
}

const ctx: ExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };

describe("Edge Geolocation Middleware", () => {
  describe("Geofencing — bloqueio por país", () => {
    it("deve bloquear requisição de país na blocklist (KP)", async () => {
      const req = mockRequest({ country: "KP", region: "Pyongyang", city: "Pyongyang", timezone: "Asia/Pyongyang", continent: "AS", latitude: 39.039, longitude: 125.762 });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("code", "GEO_BLOCKED");
    });

    it("deve bloquear requisição de país na blocklist (CU)", async () => {
      const req = mockRequest({ country: "CU", region: "Havana", city: "Havana", timezone: "America/Havana", continent: "NA", latitude: 23.113, longitude: -82.366 });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(403);
    });

    it("deve permitir requisição de país fora da blocklist (BR)", async () => {
      const req = mockRequest({ country: "BR", region: "SP", city: "São Paulo", timezone: "America/Sao_Paulo", continent: "SA", latitude: -23.55, longitude: -46.633 });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).not.toBe(403);
    });

    it("deve bloquear país não incluído na allowlist quando configurada", async () => {
      const req = mockRequest({ country: "CN", region: "Beijing", city: "Beijing", timezone: "Asia/Shanghai", continent: "AS", latitude: 39.904, longitude: 116.407 });
      const res = await worker.fetch(req, env({ ALLOWED_COUNTRIES: "US,BR,FR", BLOCKED_COUNTRIES: "" }), ctx);
      expect(res.status).toBe(403);
    });

    it("deve permitir país incluído na allowlist", async () => {
      const req = mockRequest({ country: "BR", region: "RJ", city: "Rio de Janeiro", timezone: "America/Sao_Paulo", continent: "SA", latitude: -22.906, longitude: -43.172 });
      const res = await worker.fetch(req, env({ ALLOWED_COUNTRIES: "US,BR,FR", BLOCKED_COUNTRIES: "" }), ctx);
      expect(res.status).not.toBe(403);
    });
  });

  describe("Injeção de headers geográficos", () => {
    it("deve injetar cabeçalhos X-Edge-Geo-* na resposta para país permitido", async () => {
      const req = mockRequest({ country: "FR", region: "IDF", city: "Paris", timezone: "Europe/Paris", continent: "EU", latitude: 48.856, longitude: 2.352 });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Edge-Geo-Country")).toBe("FR");
      expect(res.headers.get("X-Edge-Geo-Region")).toBe("IDF");
      expect(res.headers.get("X-Edge-Geo-City")).toBe("Paris");
      expect(res.headers.get("X-Edge-Geo-Timezone")).toBe("Europe/Paris");
      expect(res.headers.get("X-Edge-Geo-Continent")).toBe("EU");
    });

    it("deve truncar latitude e longitude para 1 decimal", async () => {
      const req = mockRequest({ country: "US", region: "CA", city: "San Francisco", timezone: "America/Los_Angeles", continent: "NA", latitude: 37.7749, longitude: -122.4194 });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.headers.get("X-Edge-Geo-Latitude")).toBe("37.8");
      expect(res.headers.get("X-Edge-Geo-Longitude")).toBe("-122.4");
    });

    it("deve incluir assinatura HMAC quando SIGNING_SECRET está configurada", async () => {
      const req = mockRequest({ country: "DE", region: "BE", city: "Berlin", timezone: "Europe/Berlin", continent: "EU" });
      const res = await worker.fetch(req, env({ SIGNING_SECRET: "test-secret" }), ctx);
      const sig = res.headers.get("X-Edge-Geo-Signature");
      expect(sig).toBeTruthy();
      expect(sig).not.toBe("unsigned");
      expect(sig!.length).toBe(64);
    });

    it("deve marcar assinatura como 'unsigned' quando não há segredo", async () => {
      const req = mockRequest({ country: "JP", region: "13", city: "Tokyo", timezone: "Asia/Tokyo", continent: "AS" });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.headers.get("X-Edge-Geo-Signature")).toBe("unsigned");
    });
  });

  describe("Fallback — request.cf nulo ou indefinido", () => {
    it("não deve quebrar quando request.cf é null", async () => {
      const req = mockRequest(null);
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Edge-Geo-Country")).toBe("XX");
    });

    it("não deve quebrar quando request.cf é undefined", async () => {
      const req = mockRequest(undefined as unknown as Record<string, unknown>);
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Edge-Geo-Country")).toBe("XX");
    });

    it("não deve quebrar quando cf tem campos parciais", async () => {
      const req = mockRequest({ country: "BR" });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Edge-Geo-Country")).toBe("BR");
      expect(res.headers.get("X-Edge-Geo-Region")).toBe("unknown");
      expect(res.headers.get("X-Edge-Geo-City")).toBe("unknown");
    });
  });

  describe("Tratamento de erros", () => {
    it("deve retornar 500 para erro interno não tratado", async () => {
      const req = new Request("https://example.com");
      Object.defineProperty(req, "cf", {
        get: () => { throw new Error("cf mock error"); },
      });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty("code", "INTERNAL_ERROR");
    });
  });

  describe("Headers também injetados na requisição upstream", () => {
    it("deve injetar headers na requisição de fetch upstream", async () => {
      const req = mockRequest({ country: "US", region: "NY", city: "New York", timezone: "America/New_York", continent: "NA" });
      const res = await worker.fetch(req, env(), ctx);
      expect(res.headers.get("X-Edge-Geo-Country")).toBe("US");
      expect(res.headers.get("X-Edge-Geo-Region")).toBe("NY");
    });
  });
});
