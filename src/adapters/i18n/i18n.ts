// UI languages (spec section 2, decisions P7, D15, I31).
import { de } from "./messages/de.ts";
import { en, type MessageKey, type Messages } from "./messages/en.ts";
import { fr } from "./messages/fr.ts";
import type { Message } from "./messages/message.ts";

export const SUPPORTED_LANGUAGES = ["en", "de", "fr"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "en";

/** Each language's name in itself, for the language switcher. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

export const catalogs: Readonly<Record<Language, Messages>> = { en, de, fr };

/** Formatting locale per language; English uses day-month order and a 24-hour clock. */
const LOCALES: Readonly<Record<Language, string>> = { en: "en-GB", de: "de-DE", fr: "fr-FR" };

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value);
}

/** The Intl locale for a language; unknown tags are passed through. */
export function localeOf(language: string): string {
  return isLanguage(language) ? LOCALES[language] : language;
}

/**
 * Best language from an Accept-Language header among `supported` (decision P7).
 * Region tags match by primary subtag; unknown or malformed input yields `fallback`.
 */
export function pickLanguage<L extends string>(
  header: string | undefined,
  supported: readonly L[],
  fallback: L,
): L {
  if (!header) return fallback;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { primary: tag.trim().toLowerCase().split("-")[0] ?? "", q, index };
    })
    .filter((entry) => entry.primary !== "" && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { primary } of ranked) {
    const match = supported.find((language) => language === primary);
    if (match !== undefined) return match;
  }
  return fallback;
}

export function negotiateLanguage(header: string | undefined): Language {
  return pickLanguage(header, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE);
}

/** The switcher's cookie if it holds a supported language, else the browser's (decision D15). */
export function resolveLanguage(request: {
  cookie: string | undefined;
  acceptLanguage: string | undefined;
}): Language {
  return isLanguage(request.cookie) ? request.cookie : negotiateLanguage(request.acceptLanguage);
}

export type Translate = (
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** Fills `{name}` placeholders; numbers are formatted for the language, plurals chosen by `{count}`. */
export function translator(language: Language): Translate {
  const messages: Readonly<Record<MessageKey, Message>> = catalogs[language];
  const plurals = new Intl.PluralRules(LOCALES[language]);
  const numbers = new Intl.NumberFormat(LOCALES[language]);
  return (key, params = {}) => {
    const message = messages[key];
    const count = Number(params.count);
    const text =
      typeof message === "string"
        ? message
        : count === 0 && message.zero !== undefined
          ? message.zero
          : plurals.select(count) === "one"
            ? message.one
            : message.other;
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      if (value === undefined) return placeholder;
      return typeof value === "number" ? numbers.format(value) : value;
    });
  };
}
