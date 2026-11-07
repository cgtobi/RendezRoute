import { describe, expect, it } from "vite-plus/test";
import { negotiateLanguage, pickLanguage, translator } from "../../../src/adapters/i18n/i18n.ts";

describe("pickLanguage (decision P7)", () => {
  const supported = ["en", "de"] as const;
  const pick = (header: string | undefined) => pickLanguage(header, supported, "en");

  it("picks the supported language with the highest quality", () => {
    expect(pick("fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7")).toBe("de");
    expect(pick("en;q=0.5,de;q=0.4")).toBe("en");
  });

  it("matches region tags by their primary language", () => {
    expect(pick("de-AT")).toBe("de");
  });

  it("ignores languages with q=0", () => {
    expect(pick("de;q=0,en;q=0.1")).toBe("en");
  });

  it("falls back to English", () => {
    expect(pick(undefined)).toBe("en");
    expect(pick("")).toBe("en");
    expect(pick("fr,it;q=0.5")).toBe("en");
    expect(pick("garbage;;;q=x")).toBe("en");
  });
});

describe("negotiateLanguage", () => {
  it("picks among the app's supported languages", () => {
    expect(negotiateLanguage("en-GB")).toBe("en");
    expect(negotiateLanguage("de")).toBe("en");
  });
});

describe("translator", () => {
  it("returns strings by key and fills placeholders", () => {
    const t = translator("en");
    expect(t("layout.poweredBy", { name: "RendezRoute" })).toBe("Powered by RendezRoute");
  });
});
