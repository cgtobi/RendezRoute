// The route file field's rules (ADR 007), apart from the DOM so they can be tested.

/** The trim choice only matters for a chosen file, so it hides while there is none. */
export function trimHidden(fileCount: number): boolean {
  return fileCount === 0;
}

/**
 * The browser's message for a chosen file over the server's limit, or "" when it is fine. The
 * limit and the message come from the field's data attributes; without a usable limit nothing is
 * checked and the server decides.
 */
export function sizeProblem(
  size: number | undefined,
  maxBytes: string | undefined,
  message: string | undefined,
): string {
  const limit = Number(maxBytes);
  if (size === undefined || maxBytes === undefined || maxBytes === "" || !(limit > 0)) return "";
  return size > limit ? (message ?? "") : "";
}
