import { describe, expect, it } from "vitest";

const BASE_URL = "https://elyos-interview-907656039105.europe-west2.run.app";
const API_KEY = process.env["ELYOS_API_KEY"] ?? "";
const noKey = !API_KEY;

// Helper: raw fetch with full control over headers and params
const get = async (
  path: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = { "X-API-Key": API_KEY },
): Promise<{ status: number; body: string; ms: number }> => {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const start = Date.now();
  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  return { status: res.status, body, ms: Date.now() - start };
};

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("authentication", () => {
  it.skipIf(noKey)(
    "weather: missing API key returns non-200 status",
    async () => {
      const { status } = await get("/weather", { location: "London" }, {});
      expect(status).not.toBe(200);
    },
  );

  it.skipIf(noKey)(
    "weather: invalid API key returns non-200 status",
    async () => {
      const { status } = await get(
        "/weather",
        { location: "London" },
        { "X-API-Key": "invalid-key-xyz" },
      );
      expect(status).not.toBe(200);
    },
  );

  it.skipIf(noKey)(
    "research: missing API key returns non-200 status",
    async () => {
      const { status } = await get("/research", { topic: "solar energy" }, {});
      expect(status).not.toBe(200);
    },
    15_000,
  );

  it.skipIf(noKey)(
    "research: invalid API key returns non-200 status",
    async () => {
      const { status } = await get(
        "/research",
        { topic: "solar energy" },
        { "X-API-Key": "invalid-key-xyz" },
      );
      expect(status).not.toBe(200);
    },
    15_000,
  );
});

// ---------------------------------------------------------------------------
// Weather endpoint – happy path
// ---------------------------------------------------------------------------

describe("GET /weather – happy path", () => {
  it.skipIf(noKey)("returns 200 for a valid city", async () => {
    const { status, body } = await get("/weather", { location: "London" });
    expect(status).toBe(200);
    expect(body.trim()).not.toBe("");
  });

  it.skipIf(noKey)("response is not an empty JSON object {}", async () => {
    const { body } = await get("/weather", { location: "London" });
    // cli.ts retries on empty `{}` – confirm it doesn't happen in normal usage
    expect(body.trim()).not.toBe("{}");
  });

  it.skipIf(noKey)("response body can be parsed as JSON", async () => {
    const { body } = await get("/weather", { location: "London" });
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it.skipIf(noKey)(
    "response contains weather-related data for the requested city",
    async () => {
      const { body } = await get("/weather", { location: "London" });
      const lower = body.toLowerCase();
      // Expect at least one of: temperature, weather, humidity, wind, degrees
      const weatherKeywords = [
        "temperature",
        "weather",
        "humidity",
        "wind",
        "celsius",
        "fahrenheit",
        "cloud",
        "rain",
        "sunny",
        "forecast",
        "°",
      ];
      const hasWeatherData = weatherKeywords.some((kw) => lower.includes(kw));
      expect(hasWeatherData).toBe(true);
    },
  );

  it.skipIf(noKey)(
    "response references the requested city (London)",
    async () => {
      const { body } = await get("/weather", { location: "London" });
      expect(body.toLowerCase()).toContain("london");
    },
  );

  it.skipIf(noKey)(
    "city with spaces (New York) returns 200 with data",
    async () => {
      const { status, body } = await get("/weather", {
        location: "New York",
      });
      expect(status).toBe(200);
      expect(body.trim()).not.toBe("");
    },
  );

  it.skipIf(noKey)(
    "response references the multi-word city (New York)",
    async () => {
      const { body } = await get("/weather", { location: "New York" });
      // Expect the response to mention New York, not a different city
      const lower = body.toLowerCase();
      expect(lower).toContain("new york");
    },
  );
});

// ---------------------------------------------------------------------------
// Weather endpoint – case sensitivity
// ---------------------------------------------------------------------------

describe("GET /weather – case sensitivity", () => {
  it.skipIf(noKey)(
    "lowercase and mixed-case city produce the same result",
    async () => {
      const [r1, r2] = await Promise.all([
        get("/weather", { location: "london" }),
        get("/weather", { location: "London" }),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      // Both should be non-empty and contain the same essential data
      expect(r1.body.toLowerCase()).toContain("london");
      expect(r2.body.toLowerCase()).toContain("london");
    },
  );

  it.skipIf(noKey)("all-uppercase city returns 200", async () => {
    const { status } = await get("/weather", { location: "LONDON" });
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Weather endpoint – edge cases / quirks
// ---------------------------------------------------------------------------

describe("GET /weather – edge cases", () => {
  it.skipIf(noKey)(
    "non-existent city returns a clear error or non-200 status (not silent success)",
    async () => {
      const { status, body } = await get("/weather", {
        location: "Qxzplorf99999",
      });
      // Either status should indicate failure, or body should mention error/not found
      const isErrorStatus = status >= 400;
      const isErrorBody = /error|not found|unknown|invalid/i.test(body);
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
  );

  it.skipIf(noKey)(
    "empty location string does not return weather data as if it were valid",
    async () => {
      const { status, body } = await get("/weather", { location: "" });
      const isErrorStatus = status >= 400;
      const isErrorBody =
        /error|not found|unknown|invalid|required|missing/i.test(body);
      // Empty location should result in an error (not a 200 with data)
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
  );

  it.skipIf(noKey)(
    "missing location parameter returns a non-200 status or error body",
    async () => {
      const { status, body } = await get("/weather");
      const isErrorStatus = status >= 400;
      const isErrorBody = /error|missing|required|parameter/i.test(body);
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
  );

  it.skipIf(noKey)(
    "numeric string as location returns an error or empty data (not real weather)",
    async () => {
      const { status, body } = await get("/weather", { location: "12345" });
      // A numeric string is not a valid city name
      const isErrorStatus = status >= 400;
      const isErrorBody = /error|not found|unknown|invalid/i.test(body);
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
  );

  it.skipIf(noKey)(
    "SQL injection attempt in location does not cause server error (500)",
    async () => {
      const { status } = await get("/weather", {
        location: "'; DROP TABLE locations; --",
      });
      expect(status).not.toBe(500);
    },
  );

  it.skipIf(noKey)(
    "consecutive calls for same city return consistent (non-empty) responses",
    async () => {
      const r1 = await get("/weather", { location: "Tokyo" });
      const r2 = await get("/weather", { location: "Tokyo" });
      expect(r1.body.trim()).not.toBe("");
      expect(r2.body.trim()).not.toBe("");
      // Core data (at minimum both should reference the city)
      expect(r1.body.toLowerCase()).toContain("tokyo");
      expect(r2.body.toLowerCase()).toContain("tokyo");
    },
  );

  it.skipIf(noKey)(
    "non-ASCII city name (Zürich) returns 200 or graceful error",
    async () => {
      const { status } = await get("/weather", { location: "Zürich" });
      // Should either work (200) or return a clean 4xx, not a 500
      expect(status).not.toBe(500);
    },
  );
});

// ---------------------------------------------------------------------------
// Research endpoint – happy path
// ---------------------------------------------------------------------------

describe("GET /research – happy path", () => {
  it.skipIf(noKey)(
    "returns 200 for a valid topic",
    async () => {
      const { status, body } = await get("/research", {
        topic: "solar energy",
      });
      expect(status).toBe(200);
      expect(body.trim()).not.toBe("");
    },
    15_000,
  );

  it.skipIf(noKey)(
    "response is not an empty JSON object {}",
    async () => {
      const { body } = await get("/research", { topic: "solar energy" });
      expect(body.trim()).not.toBe("{}");
    },
    15_000,
  );

  it.skipIf(noKey)(
    "response body can be parsed as JSON",
    async () => {
      const { body } = await get("/research", { topic: "climate change" });
      expect(() => JSON.parse(body)).not.toThrow();
    },
    15_000,
  );

  it.skipIf(noKey)(
    "response contains content relevant to the researched topic",
    async () => {
      const { body } = await get("/research", { topic: "solar energy" });
      const lower = body.toLowerCase();
      // Solar energy research should mention relevant keywords
      const relevantKeywords = [
        "solar",
        "energy",
        "sun",
        "panel",
        "photovoltaic",
        "renewable",
        "electricity",
        "power",
      ];
      const hasRelevantContent = relevantKeywords.some((kw) =>
        lower.includes(kw),
      );
      expect(hasRelevantContent).toBe(true);
    },
    15_000,
  );
});

// ---------------------------------------------------------------------------
// Research endpoint – response timing
// ---------------------------------------------------------------------------

describe("GET /research – response timing", () => {
  it.skipIf(noKey)(
    "response time is at least 3 seconds (as documented)",
    async () => {
      const { ms } = await get("/research", { topic: "quantum computing" });
      expect(ms).toBeGreaterThanOrEqual(3_000);
    },
    20_000,
  );

  it.skipIf(noKey)(
    "response time does not exceed 8 seconds (as documented)",
    async () => {
      const { ms } = await get("/research", { topic: "machine learning" });
      // Documented maximum is 8 seconds; allow 2s of network overhead
      expect(ms).toBeLessThanOrEqual(10_000);
    },
    20_000,
  );
});

// ---------------------------------------------------------------------------
// Research endpoint – edge cases / quirks
// ---------------------------------------------------------------------------

describe("GET /research – edge cases", () => {
  it.skipIf(noKey)(
    "empty topic string does not return research data as if valid",
    async () => {
      const { status, body } = await get("/research", { topic: "" });
      const isErrorStatus = status >= 400;
      const isErrorBody = /error|not found|invalid|required|missing/i.test(
        body,
      );
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
    15_000,
  );

  it.skipIf(noKey)(
    "missing topic parameter returns a non-200 status or error body",
    async () => {
      const { status, body } = await get("/research");
      const isErrorStatus = status >= 400;
      const isErrorBody = /error|missing|required|parameter/i.test(body);
      expect(isErrorStatus || isErrorBody).toBe(true);
    },
    15_000,
  );

  it.skipIf(noKey)(
    "two requests for the same topic return consistent (non-empty) responses",
    async () => {
      const [r1, r2] = await Promise.all([
        get("/research", { topic: "solar energy" }),
        get("/research", { topic: "solar energy" }),
      ]);
      expect(r1.body.trim()).not.toBe("");
      expect(r2.body.trim()).not.toBe("");
      // Both results should be about solar energy
      expect(r1.body.toLowerCase()).toMatch(/solar|energy|renewable/);
      expect(r2.body.toLowerCase()).toMatch(/solar|energy|renewable/);
    },
    20_000,
  );

  it.skipIf(noKey)(
    "different topics return different content",
    async () => {
      const [r1, r2] = await Promise.all([
        get("/research", { topic: "solar energy" }),
        get("/research", { topic: "ocean biology" }),
      ]);
      // Responses should not be identical for unrelated topics
      expect(r1.body).not.toBe(r2.body);
    },
    20_000,
  );

  it.skipIf(noKey)(
    "research on an obscure topic returns a meaningful (non-empty) response",
    async () => {
      const { status, body } = await get("/research", {
        topic: "knot theory in topology",
      });
      expect(status).toBe(200);
      expect(body.trim().length).toBeGreaterThan(50);
    },
    15_000,
  );

  it.skipIf(noKey)(
    "SQL injection attempt in topic does not cause server error (500)",
    async () => {
      const { status } = await get("/research", {
        topic: "'; DROP TABLE research; --",
      });
      expect(status).not.toBe(500);
    },
    15_000,
  );
});
