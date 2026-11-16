import { describe, expect, it } from "vite-plus/test";
import { waitsForConfirmation } from "../../src/client/auto-submit-rule.ts";

describe("waitsForConfirmation (decisions D64, I82)", () => {
  it("waits for Enter or blur after the keys that step through a closed select", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(waitsForConfirmation(key)).toBe(true);
    }
  });

  it("submits at once after a pointer pick or any other key", () => {
    expect(waitsForConfirmation(undefined)).toBe(false);
    expect(waitsForConfirmation("Enter")).toBe(false);
    expect(waitsForConfirmation("a")).toBe(false);
  });
});
