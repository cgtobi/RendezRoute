import { describe, expect, it } from "vite-plus/test";
import { negotiateLanguage, translator } from "../../../src/adapters/i18n/i18n.ts";

describe("negotiateLanguage (decision P7)", () => {
  const supported = ["en", "de"] as const;

  it("picks the supported language with the highest quality", () => {
    expect(negotiateLanguage("fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7", supported)).toBe("de");
    expect(negotiateLanguage("en;q=0.5,de;q=0.4", supported)).toBe("en");
  });

  it("matches region tags by their primary language", () => {
    expect(negotiateLanguage("de-AT", supported)).toBe("de");
  });

  it("ignores languages with q=0", () => {
    expect(negotiateLanguage("de;q=0,en;q=0.1", supported)).toBe("en");
  });

  it("falls back to English", () => {
    expect(negotiateLanguage(undefined, supported)).toBe("en");
    expect(negotiateLanguage("", supported)).toBe("en");
    expect(negotiateLanguage("fr,it;q=0.5", supported)).toBe("en");
    expect(negotiateLanguage("garbage;;;q=x", supported)).toBe("en");
  });

  it("uses the app's supported languages by default", () => {
    expect(negotiateLanguage("en-GB")).toBe("en");
  });
});

describe("translator", () => {
  it("returns strings by key and fills placeholders", () => {
    const t = translator("en");
    expect(t("layout.poweredBy", { name: "RendezRoute" })).toBe("Powered by RendezRoute");
  });
});
