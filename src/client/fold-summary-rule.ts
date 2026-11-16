// Pure rules for the creation form's fold summaries (decision D61), testable in Node;
// fold-summaries.ts applies them to the page. The server renders every variant text in the fold's
// data-summaries attribute under these keys: "<join>:<find>" for the who fold ("open" or
// "approval", then "link", "followers" or "public") and "<join>:<none|set>" for the exact fold.

export type Summaries = Readonly<Record<string, string>>;

const joinOf = (join: string | undefined) => (join === "approval" ? "approval" : "open");

/** The who fold's key from the checked join radio and the checked, enabled visibility radio. */
export function whoKey(join: string | undefined, find: string | undefined): string {
  return `${joinOf(join)}:${find === "followers" || find === "public" ? find : "link"}`;
}

/** The exact fold's key: whether a description or coordinates are filled in, per join mode. */
export function exactKey(join: string | undefined, values: readonly string[]): string {
  return `${joinOf(join)}:${values.some((value) => value.trim() !== "") ? "set" : "none"}`;
}

/** The key for a fold of the given kind from the form's current state. */
export function summaryKey(
  kind: string | undefined,
  state: { join: string | undefined; find: string | undefined; exact: readonly string[] },
): string {
  return kind === "who" ? whoKey(state.join, state.find) : exactKey(state.join, state.exact);
}

/** Only an effectively public plan gets the warning style. */
export function isPublicKey(key: string): boolean {
  return key.endsWith(":public");
}

/** The summaries the server rendered; anything unexpected gives none (the text stays as it is). */
export function parseSummaries(json: string | undefined): Summaries {
  if (json === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

interface Openable {
  setAttribute(name: string, value: string): void;
  closest(selector: string): Openable | null;
}

/** Opens every closed details around a control the browser is about to report as invalid. */
export function openClosedDetails(target: Openable): boolean {
  let opened = false;
  // Once opened, a details no longer matches, so the next call finds the closed one around it.
  for (let d = target.closest("details:not([open])"); d !== null;) {
    d.setAttribute("open", "");
    opened = true;
    d = d.closest("details:not([open])");
  }
  return opened;
}
