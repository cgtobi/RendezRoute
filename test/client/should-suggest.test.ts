import { describe, expect, it } from "vite-plus/test";
import { shouldSuggest } from "../../src/client/geo.ts";

describe("shouldSuggest (decision D70)", () => {
  it("suggests into an empty field, also one with only spaces", () => {
    expect(shouldSuggest("", undefined)).toBe(true);
    expect(shouldSuggest("   ", undefined)).toBe(true);
    expect(shouldSuggest("\t\n", "Sendling, München")).toBe(true);
  });

  it("replaces our own suggestion while it is unchanged", () => {
    expect(shouldSuggest("Sendling, München", "Sendling, München")).toBe(true);
  });

  it("leaves the host's own text alone", () => {
    expect(shouldSuggest("Englischer Garten", undefined)).toBe(false);
    expect(shouldSuggest("Englischer Garten", "Sendling, München")).toBe(false);
    // Any edit makes it theirs, even a small one.
    expect(shouldSuggest("Sendling, Münchenx", "Sendling, München")).toBe(false);
    expect(shouldSuggest("sendling, münchen", "Sendling, München")).toBe(false);
    expect(shouldSuggest(" Sendling, München", "Sendling, München")).toBe(false);
  });
});
