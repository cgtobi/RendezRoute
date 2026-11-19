import { describe, expect, it } from "vite-plus/test";
import { sizeProblem, trimHidden } from "../../src/client/route-file-rule.ts";

describe("trimHidden (ADR 007)", () => {
  it("hides the trim choice until a file is chosen", () => {
    expect(trimHidden(0)).toBe(true);
    expect(trimHidden(1)).toBe(false);
  });
});

describe("sizeProblem (ADR 007, decision D10)", () => {
  const max = String(5 * 1024 * 1024);
  const message = "The file is larger than 5 MB.";

  it("names the problem for a file over the limit", () => {
    expect(sizeProblem(5 * 1024 * 1024 + 1, max, message)).toBe(message);
  });

  it("accepts a file at or under the limit, and no file", () => {
    expect(sizeProblem(5 * 1024 * 1024, max, message)).toBe("");
    expect(sizeProblem(120, max, message)).toBe("");
    expect(sizeProblem(undefined, max, message)).toBe("");
  });

  it("leaves the check to the server without a usable limit", () => {
    for (const limit of [undefined, "", "abc", "0", "-5"]) {
      expect(sizeProblem(10 * 1024 * 1024, limit, message)).toBe("");
    }
  });

  it("never blocks with an empty message", () => {
    expect(sizeProblem(10 * 1024 * 1024, max, undefined)).toBe("");
  });
});
