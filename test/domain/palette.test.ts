import { describe, expect, it } from "vite-plus/test";
import { isPalette, PALETTES } from "../../src/domain/palette.ts";
import { SITE_PALETTE } from "../../src/adapters/in/http/routes/preferences.ts";

describe("palette (decision 004)", () => {
  it("lists default, mono and bold", () => {
    expect(PALETTES).toEqual(["default", "mono", "bold"]);
  });

  it("keeps the route's site choice from colliding with a palette", () => {
    expect(isPalette(SITE_PALETTE)).toBe(false);
  });

  it("accepts only the known palettes", () => {
    for (const palette of PALETTES) expect(isPalette(palette)).toBe(true);
    for (const value of ["", "Bold", "neon", "light", undefined, null, 1]) {
      expect(isPalette(value)).toBe(false);
    }
  });
});
