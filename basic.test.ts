import { describe, expect, it } from "vitest";
import { tools } from "./tools";

describe("tools", () => {
  it("exports two function tools", () => {
    expect(tools).toHaveLength(2);
    expect(tools.every((t) => t.type === "function")).toBe(true);
  });
});
