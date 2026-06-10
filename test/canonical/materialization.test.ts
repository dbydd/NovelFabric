import { describe, expect, it } from "vitest";

describe("canonical materialization removal", () => {
  it("keeps semantic resource filling out of deterministic core services", async () => {
    const module = await import("../../src/canonical/materialization.js");
    expect(Object.keys(module)).toEqual([]);
  });
});
