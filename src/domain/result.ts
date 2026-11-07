/** Outcome of a domain rule. Errors are stable codes; adapters translate them for people. */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E extends string>(error: E): { ok: false; error: E } => ({ ok: false, error });
