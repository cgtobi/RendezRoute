// Shape of catalog entries (decision I31).

/**
 * Forms chosen by `Intl.PluralRules` for the `{count}` parameter. The optional `zero` form is used
 * for exactly 0 in every language, e.g. to leave out "all 0 responses".
 */
export interface Plural {
  zero?: string;
  one: string;
  other: string;
}

export type Message = string | Plural;
