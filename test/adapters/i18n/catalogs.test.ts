// Checks the German and French catalogs against English (decisions D15, I31). Key sets are also
// enforced by the `Messages` type; these tests cover what types cannot: placeholders, empty or
// copied strings, and typography.
import { describe, expect, it } from "vite-plus/test";
import { catalogs, SUPPORTED_LANGUAGES } from "../../../src/adapters/i18n/i18n.ts";

type Message = string | { zero?: string; one: string; other: string };

/** All forms, the "other" form last. */
const forms = (message: Message): string[] =>
  typeof message === "string"
    ? [message]
    : [...(message.zero === undefined ? [] : [message.zero]), message.one, message.other];

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort((a, b) => a.localeCompare(b));

const UNITS = [
  "unit.minPerKm",
  "unit.kmh",
  "unit.km",
  "unit.m",
  "unit.minPerMi",
  "unit.mph",
  "unit.mi",
  "unit.ft",
];

/** Strings that are the same in every language. */
const SAME_AS_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  de: [...UNITS, "plan.pace", "plan.route", "host.route", "privacy.cookiesHeading"],
  fr: [
    ...UNITS,
    "form.date",
    "form.latitude",
    "form.longitude",
    "plan.distance",
    "privacy.cookiesHeading",
  ],
};

const english = catalogs.en as Readonly<Record<string, Message>>;

describe.each(SUPPORTED_LANGUAGES.filter((language) => language !== "en"))(
  "%s catalog",
  (language) => {
    const catalog = catalogs[language] as Readonly<Record<string, Message>>;
    const entries = Object.entries(catalog);

    it("has exactly the English keys", () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
    });

    it("uses the same placeholders and plural shape as English", () => {
      const mismatches = entries.flatMap(([key, message]) => {
        const source = english[key] ?? "";
        const shape = (m: Message) =>
          typeof m === "string" ? "string" : Object.keys(m).sort().join();
        if (shape(source) !== shape(message)) return [`${key}: plural shape`];
        // The last form (the whole string, or a plural's "other") must keep every placeholder;
        // a plural's "one" form may leave some out, e.g. "a day" without {count}.
        const expected = placeholders(forms(source).at(-1) ?? "");
        const [other = "", ...rest] = forms(message).reverse();
        const extra = rest.flatMap(placeholders).filter((name) => !expected.includes(name));
        return placeholders(other).join() === expected.join() && extra.length === 0
          ? []
          : [`${key}: ${forms(message).join(" | ")}`];
      });
      expect(mismatches).toEqual([]);
    });

    it("has no empty, padded or untranslated strings", () => {
      const allowed = SAME_AS_ENGLISH[language] ?? [];
      const problems = entries.flatMap(([key, message]) =>
        forms(message).flatMap((text) => {
          if (text.trim() === "") return [`${key}: empty`];
          if (text !== text.trim()) return [`${key}: padded`];
          return [];
        }),
      );
      const copied = entries
        .filter(([key, message]) => JSON.stringify(message) === JSON.stringify(english[key]))
        .map(([key]) => key)
        .filter((key) => !allowed.includes(key));
      expect({ problems, copied }).toEqual({ problems: [], copied: [] });
    });

    it("uses typographic apostrophes", () => {
      const straight = entries.filter(([, message]) => forms(message).some((t) => t.includes("'")));
      expect(straight.map(([key]) => key)).toEqual([]);
    });
  },
);

describe("German typography (decision I31)", () => {
  const texts = Object.entries(catalogs.de as Readonly<Record<string, Message>>).flatMap(
    ([key, message]) => forms(message).map((text) => [key, text] as const),
  );

  it("quotes with „…“ only", () => {
    const wrong = texts.filter(
      ([, text]) => /[”«»"]/.test(text) || text.split("„").length !== text.split("“").length,
    );
    expect(wrong.map(([key]) => key)).toEqual([]);
  });
});

describe("French typography (decision I31)", () => {
  const texts = Object.entries(catalogs.fr as Readonly<Record<string, Message>>).flatMap(
    ([key, message]) => forms(message).map((text) => [key, text] as const),
  );

  it("puts a narrow no-break space before ; : ! ? (but not in times like 5:30)", () => {
    const wrong = texts.filter(([, text]) => /(?<![ \d])[;:!?]/.test(text));
    expect(wrong.map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });

  it("quotes with « … » and no-break spaces inside", () => {
    const wrong = texts.filter(([, text]) => /[“”„"]/.test(text) || /«(?! )|(?<! )»/.test(text));
    expect(wrong.map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });
});
