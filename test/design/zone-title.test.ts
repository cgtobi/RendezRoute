// The time zone line's title (decision D80): muted like the line, the zone name in the text
// colour, and the title gone while the line is open. The pixels are checked by e2e/field-style.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const CSS = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

describe("the time zone line title", () => {
  it("gives the zone name the text colour and leaves the title the line's muted one", () => {
    expect(CSS).toMatch(/\.zone-line \[data-zone-name\] \{ color: var\(--fg\); \}/);
    expect(CSS).toMatch(/\.zone-line,[^{]*\{[^}]*color: var\(--muted\)/);
    expect(CSS).not.toMatch(/\.zone-title \{[^}]*color/);
  });

  it("hides the title while the line is open, which also takes it out of the accessible name", () => {
    expect(CSS).toMatch(/details\[open\] > summary \.zone-title \{ display: none; \}/);
  });
});
