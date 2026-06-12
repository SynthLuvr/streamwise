/**
 * Experiments to assess whether the /research endpoint:
 *   (A) is being called incorrectly, or
 *   (B) simply does not return topic-relevant content.
 *
 * Run with: npx tsx research.experiment.ts
 * Requires ELYOS_API_KEY to be set.
 */

import ky from "ky";
import { describe, expect, it } from "vitest";

const BASE_URL = "https://elyos-interview-907656039105.europe-west2.run.app";

const TOPIC_KEYWORDS: Record<string, string[]> = {
  "solar energy": [
    "solar",
    "energy",
    "sun",
    "panel",
    "photovoltaic",
    "renewable",
    "electricity",
    "power",
  ],
  "quantum computing": [
    "quantum",
    "qubit",
    "computing",
    "superposition",
    "entanglement",
  ],
  "ocean ecology": ["ocean", "marine", "sea", "coral", "fish", "ecosystem"],
};

const apiKey = process.env["ELYOS_API_KEY"] ?? "";

const api = ky.create({
  baseUrl: BASE_URL,
  headers: { "X-API-Key": apiKey },
  timeout: 30_000,
});

const research = (topic: string) =>
  api.get("research", { searchParams: { topic } }).text();

const containsKeyword = (text: string, keywords: string[]) =>
  keywords.some((kw) => text.toLowerCase().includes(kw.toLowerCase()));

describe("/research endpoint experiments", () => {
  it("has ELYOS_API_KEY available", () => {
    expect(apiKey.length, "ELYOS_API_KEY must be set").toBeGreaterThan(0);
  });

  /**
   * Experiment 1 – Consistency
   * Call the same topic 5 times. Do we get the same (or similar) response
   * each time, or does the content vary unpredictably?
   */
  it("experiment 1: same topic returns consistent responses", async () => {
    const topic = "solar energy";
    const responses: string[] = [];

    for (let i = 0; i < 5; i++) {
      responses.push(await research(topic));
    }

    console.log("\n--- Experiment 1: Consistency (topic: solar energy) ---");
    for (const [i, r] of responses.entries()) {
      const relevant = containsKeyword(r, TOPIC_KEYWORDS[topic]!);
      console.log(
        `  Run ${i + 1}: ${r.length} chars | topic-relevant: ${relevant} | preview: ${r.slice(0, 120).replace(/\n/g, " ")}`,
      );
    }

    const relevantCount = responses.filter((r) =>
      containsKeyword(r, TOPIC_KEYWORDS[topic]!),
    ).length;

    console.log(
      `  Topic-relevant responses: ${relevantCount}/${responses.length}`,
    );

    // This assertion intentionally documents the observed behavior.
    // If the endpoint works correctly all 5 should be relevant.
    expect(
      relevantCount,
      "At least one response should be topic-relevant",
    ).toBeGreaterThan(0);
  });

  /**
   * Experiment 2 – Specificity
   * Call three distinct topics. Do the responses differ per topic,
   * or does the endpoint return identical (cached / generic) content?
   */
  it("experiment 2: different topics return different responses", async () => {
    const topics = Object.keys(TOPIC_KEYWORDS);
    const responses: Record<string, string> = {};

    for (const topic of topics) {
      responses[topic] = await research(topic);
    }

    console.log("\n--- Experiment 2: Specificity ---");
    for (const topic of topics) {
      const r = responses[topic]!;
      const relevant = containsKeyword(r, TOPIC_KEYWORDS[topic]!);
      console.log(
        `  topic: "${topic}" | relevant: ${relevant} | preview: ${r.slice(0, 120).replace(/\n/g, " ")}`,
      );
    }

    // Check whether all three responses are identical (sign of caching / topic-blindness)
    const unique = new Set(Object.values(responses)).size;
    console.log(`  Unique responses: ${unique}/${topics.length}`);

    expect(
      unique,
      "Different topics should yield different responses",
    ).toBeGreaterThan(1);
  });

  /**
   * Experiment 3 – Topic-relevance check
   * Verify that the response for "solar energy" contains at least one
   * expected keyword, confirming the endpoint honours the topic param.
   */
  it("experiment 3: solar energy response contains topic keywords", async () => {
    const topic = "solar energy";
    const keywords = TOPIC_KEYWORDS[topic]!;
    const response = await research(topic);

    const foundKeywords = keywords.filter((kw) =>
      response.toLowerCase().includes(kw.toLowerCase()),
    );

    console.log("\n--- Experiment 3: Keyword check (solar energy) ---");
    console.log(`  Response length: ${response.length} chars`);
    console.log(`  Full response:\n${response}\n`);
    console.log(`  Expected keywords: ${keywords.join(", ")}`);
    console.log(
      `  Found keywords: ${foundKeywords.length > 0 ? foundKeywords.join(", ") : "(none)"}`,
    );

    expect(
      foundKeywords.length,
      `Response should contain at least one of: ${keywords.join(", ")}`,
    ).toBeGreaterThan(0);
  });

  /**
   * Experiment 4 – Empty response handling
   * How often does the endpoint return an empty or trivially short response?
   * Calls the endpoint 5 times and counts empty/near-empty responses.
   */
  it("experiment 4: measure empty response rate", async () => {
    const topic = "solar energy";
    const results: { length: number; empty: boolean }[] = [];

    for (let i = 0; i < 5; i++) {
      const r = await research(topic);
      results.push({ length: r.length, empty: r.length < 10 });
    }

    const emptyCount = results.filter((r) => r.empty).length;

    console.log("\n--- Experiment 4: Empty response rate ---");
    for (const [i, r] of results.entries()) {
      console.log(`  Run ${i + 1}: ${r.length} chars | empty: ${r.empty}`);
    }
    console.log(`  Empty responses: ${emptyCount}/${results.length}`);
  });
});
