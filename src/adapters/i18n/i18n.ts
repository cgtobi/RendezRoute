import { en, type MessageKey, type Messages } from "./messages/en.ts";

export const SUPPORTED_LANGUAGES = ["en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "en";

const catalogs: Readonly<Record<Language, Messages>> = { en };

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

export type Translate = (
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

export function translator(language: Language): Translate {
  const messages = catalogs[language];
  return (key, params = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in params ? String(params[name]) : placeholder,
    );
}
