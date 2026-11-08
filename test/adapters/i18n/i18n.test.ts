import { describe, expect, it } from "vite-plus/test";
import {
  isLanguage,
  localeOf,
  negotiateLanguage,
  pickLanguage,
  resolveLanguage,
  translator,
} from "../../../src/adapters/i18n/i18n.ts";

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

describe("negotiateLanguage (decision D15)", () => {
  it("picks among English, German and French", () => {
    expect(negotiateLanguage("en-GB")).toBe("en");
    expect(negotiateLanguage("de-CH,de;q=0.9")).toBe("de");
    expect(negotiateLanguage("fr-BE")).toBe("fr");
    expect(negotiateLanguage("it,fr;q=0.5")).toBe("fr");
    expect(negotiateLanguage("it")).toBe("en");
  });
});

describe("resolveLanguage (decision D15)", () => {
  it("prefers the language cookie over the browser's languages", () => {
    expect(resolveLanguage({ cookie: "fr", acceptLanguage: "de" })).toBe("fr");
  });

  it("ignores an unsupported or malformed cookie", () => {
    expect(resolveLanguage({ cookie: "it", acceptLanguage: "de" })).toBe("de");
    expect(resolveLanguage({ cookie: "", acceptLanguage: undefined })).toBe("en");
    expect(resolveLanguage({ cookie: undefined, acceptLanguage: undefined })).toBe("en");
  });
});

describe("isLanguage", () => {
  it("accepts only supported language tags", () => {
    expect(["en", "de", "fr"].every(isLanguage)).toBe(true);
    expect(["EN", "de-DE", "it", "", undefined, 1].some(isLanguage)).toBe(false);
  });
});

describe("localeOf", () => {
  it("maps each language to its formatting locale", () => {
    expect(localeOf("en")).toBe("en-GB");
    expect(localeOf("de")).toBe("de-DE");
    expect(localeOf("fr")).toBe("fr-FR");
  });
});

describe("translator", () => {
  it("returns strings by key and fills placeholders", () => {
    const t = translator("en");
    expect(t("layout.poweredBy", { name: "RendezRoute" })).toBe("Powered by RendezRoute");
  });

  it("speaks the requested language", () => {
    expect(translator("de")("layout.poweredBy", { name: "X" })).toBe("Betrieben mit X");
    expect(translator("fr")("layout.poweredBy", { name: "X" })).toBe("Propulsé par X");
  });

  it("picks the plural form by the language's rules", () => {
    const en = translator("en");
    expect(en("form.retentionDays", { count: 1 })).toBe("1 day after the run");
    expect(en("form.retentionDays", { count: 7 })).toBe("7 days after the run");
    const fr = translator("fr");
    // French uses the singular for 0 and 1.
    expect(fr("form.retentionDays", { count: 1 })).toContain("1 jour ");
    expect(fr("form.retentionDays", { count: 2 })).toContain("2 jours ");
    expect(fr("form.retentionDays", { count: 0 })).toContain("0 jour ");
    expect(translator("de")("form.retentionDays", { count: 1 })).toContain("1 Tag ");
  });

  it("uses a zero form where one is given, in every language", () => {
    for (const language of ["en", "de", "fr"] as const) {
      const text = translator(language)("host.deleteExplain", { count: 0 });
      expect({ language, text }).not.toMatchObject({ text: expect.stringMatching(/\b0\b/) });
    }
  });

  it("formats numbers for the language", () => {
    expect(translator("en")("host.deleteExplain", { count: 1200 })).toContain("1,200");
    expect(translator("de")("host.deleteExplain", { count: 1200 })).toContain("1.200");
    expect(translator("fr")("host.deleteExplain", { count: 1200 })).toContain("1 200");
  });
});
