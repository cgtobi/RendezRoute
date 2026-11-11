import { describe, expect, it } from "vite-plus/test";
import { maskEmailAddress, parseEmailAddress } from "../../src/domain/email.ts";

describe("email addresses (spec 7 Optional notification channels)", () => {
  it("accepts an address, trimmed, with the domain in lower case", () => {
    expect(parseEmailAddress("  Anna.Berg+runs@Example.ORG ")).toEqual({
      ok: true,
      value: "Anna.Berg+runs@example.org",
    });
    expect(parseEmailAddress("ben@münchen.de")).toEqual({ ok: true, value: "ben@münchen.de" });
  });

  it("asks for an address when the field is empty", () => {
    expect(parseEmailAddress("   ")).toEqual({ ok: false, error: "required" });
  });

  it.each([
    "anna",
    "anna@",
    "@example.org",
    "anna@example",
    "anna@@example.org",
    "anna@exa mple.org",
    "an na@example.org",
    // Anything that could add a recipient or a header line.
    "anna@example.org, eve@example.org",
    "anna@example.org;eve@example.org",
    "Anna <anna@example.org>",
    '"anna"@example.org',
    "anna@example.org\r\nBcc: eve@example.org",
    "anna\n@example.org",
    "anna@-example.org",
    "anna@example..org",
    `${"a".repeat(65)}@example.org`,
    `anna@${"a".repeat(250)}.org`,
  ])("refuses %j", (input) => {
    expect(parseEmailAddress(input)).toEqual({ ok: false, error: "email_invalid" });
  });

  it("shows only the first character of the name part", () => {
    expect(maskEmailAddress("anna.berg@example.org")).toBe("a…@example.org");
    expect(maskEmailAddress("ü@example.org")).toBe("ü…@example.org");
  });
});
