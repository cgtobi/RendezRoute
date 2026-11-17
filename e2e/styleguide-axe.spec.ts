// Accessibility audit of the dev-only style guide with axe-core (decision D72, plan I98 step
// 13c2). The page renders every real view with every fold opened, at 390 px in light and dark, in
// Chromium and in the WebKit iPhone project. Axe passing does not replace a screen reader pass on
// a phone (docs/release-checklist.md).
//
// The violation list must be empty bar the allowlist below: one entry per rule id and selector,
// each with the reason. Only dev-only page artefacts belong there, never a real app bug.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { person } from "./helpers.ts";

const SCHEMES = ["light", "dark"] as const;

/** The rule set: WCAG 2.0, 2.1 and 2.2 levels A and AA, plus axe's best-practice rules (clean today, so they stay on). */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

type Allowed = { rule: string; selector: string; reason: string };

/** Known findings that are artefacts of the catalogue page. Empty: add nothing without a reason. */
const ALLOWED: readonly Allowed[] = [];

for (const scheme of SCHEMES) {
  test(`The style guide has no axe violations at 390 px in ${scheme} mode`, async ({
    browser,
    baseURL,
  }) => {
    const problems: string[] = [];
    const { context, page } = await person(browser, baseURL ?? "", problems, {
      context: { colorScheme: scheme, viewport: { width: 390, height: 800 } },
    });
    await page.goto("/styleguide");
    await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; });`);

    const { violations, passes } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    // Guards against an audit that silently ran nothing (for example blocked by the CSP).
    expect(passes.length, "axe rules that passed").toBeGreaterThan(20);
    const unexpected = violations.flatMap((violation) =>
      violation.nodes
        .filter(
          (node) =>
            !ALLOWED.some(
              (allowed) =>
                allowed.rule === violation.id && node.target.join(" ").includes(allowed.selector),
            ),
        )
        .map(
          (node) =>
            `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n  ${violation.helpUrl}\n  target: ${node.target.join(" ")}\n  ${node.failureSummary?.replaceAll("\n", "\n  ") ?? ""}`,
        ),
    );
    expect(unexpected, "axe violations").toEqual([]);
    await context.close();
  });
}
