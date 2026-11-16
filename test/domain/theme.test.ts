import { describe, expect, it } from "vite-plus/test";
import { isTheme, THEMES } from "../../src/domain/theme.ts";

describe("theme (decision D64)", () => {
  it("lists system, light and dark", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
  });

  it("accepts only the known themes", () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
    for (const value of ["", "Dark", "auto", undefined, null, 1]) {
      expect(isTheme(value)).toBe(false);
    }
  });
});
