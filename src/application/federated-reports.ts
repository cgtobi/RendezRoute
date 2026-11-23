// Reports from the fediverse (spec 7 Moderation, "Fediverse reports"; decisions D22, D44, D45,
// D46; 0.9 step 12b): a `Flag` names a plan's `Event`, or one of our contribution Notes, and
// becomes one report to the instance admin, like a web one. Nothing is fetched: what is named is
// looked up in our own tables, and anything that is not ours is passed over. The reporter is
// recorded nowhere (D22): its server is looked at only to see that a named Note was sent to
// someone on it, and is the caller's key for the quota, in memory.
import {
  copyOfPost,
  type AttachedContribution,
  REPORT_LIMITS,
  validateReport,
} from "../domain/report.ts";
import { stripBidiControls } from "../domain/text.ts";
import { queueReportAlert } from "./email.ts";
import { type PlanDeps, viewPlan } from "./plans.ts";

/** Something a `Flag` names that is ours, by the identifier in its address. */
export type FlagObject = { kind: "plan"; planId: string } | { kind: "note"; noteId: string };

/** How many of a `Flag`'s objects are looked at: the rest are not read. */
export const MAX_FLAG_OBJECTS = 10;

/** Plain text beyond this is not worked through; no report could hold it. */
const MAX_TEXT = 20_000;

export type FederatedReportResult = "reported" | "ignored" | "limited";

/** The origin of an address, or undefined when it is none. */
const originOf = (address: string): string | undefined => {
  const origin = URL.parse(address)?.origin;
  // Opaque origins ("null", for schemes that are not http or https) are no server: never equal.
  return origin === undefined || origin === "null" ? undefined : origin;
};

/** What one object resolves to: a plan and, for a Note, the contribution it carries. */
interface Resolved {
  planId: string;
  contributionId: string | undefined;
}

/**
 * The plan a named object stands for. A Note counts only if it is a contribution Note sent to
 * someone on the reporter's own server (any account of it: moderators report for their users),
 * so a server cannot report what was never sent to it; the exact-start Note is private to its
 * recipient and never counts.
 */
async function resolve(
  deps: PlanDeps,
  object: FlagObject,
  reporterOrigin: string,
): Promise<Resolved | undefined> {
  if (object.kind === "plan") return { planId: object.planId, contributionId: undefined };
  const note = await deps.posterActors?.contributionNotes.findByNoteId(object.noteId);
  if (note === undefined) return undefined;
  const recipient = await deps.responses.remoteOf(note.responseId);
  const theirs = originOf(recipient?.actor.id ?? "");
  if (theirs === undefined || theirs !== originOf(reporterOrigin)) return undefined;
  return { planId: note.planId, contributionId: note.contributionId };
}

/** The details of a report: the text without what reorders it, cut, then cleaned. */
function detailsOf(text: string): string | undefined {
  const plain = stripBidiControls(text.slice(0, MAX_TEXT).normalize("NFC")).replace(
    /[^\P{Cc}\n]/gu,
    " ",
  );
  const cut = Array.from(plain).slice(0, REPORT_LIMITS.details).join("");
  const checked = validateReport({ reason: "other", details: cut });
  return checked.ok ? checked.value.details : undefined;
}

/**
 * Stores a report for the first named object that resolves to a plan the web shows to a
 * stranger, with a copy of the contribution (text and link, no author) when a named Note of the
 * same plan carries one. Ignored when nothing resolves. `admit` takes the quotas, once, for a
 * plan that could be reported, and says no when they are used up: then nothing is stored and the
 * result is `limited`.
 */
export async function reportFromFederation(
  deps: PlanDeps,
  request: {
    objects: readonly FlagObject[];
    /** The origin of the actor that sent the `Flag`; used only to match a named Note. */
    reporterOrigin: string;
    /** The `Flag`'s text, already plain. */
    text: string;
    admit: (planId: string) => boolean;
  },
): Promise<FederatedReportResult> {
  const found: Resolved[] = [];
  for (const object of request.objects.slice(0, MAX_FLAG_OBJECTS)) {
    const resolved = await resolve(deps, object, request.reporterOrigin);
    if (resolved !== undefined) found.push(resolved);
  }
  // The first plan the web would show to a stranger, as the Event's address does.
  let chosen: Resolved | undefined;
  for (const candidate of found) {
    if (
      (await viewPlan(deps, { planId: candidate.planId, deviceToken: undefined })).kind === "viewer"
    ) {
      chosen = candidate;
      break;
    }
  }
  if (chosen === undefined) return "ignored";
  const planId = chosen.planId;
  const copied = found.find((r) => r.planId === planId && r.contributionId !== undefined);
  const contribution =
    copied?.contributionId === undefined
      ? undefined
      : await deps.recap.findById(copied.contributionId);
  const attached: AttachedContribution[] =
    contribution === undefined || contribution.planId !== planId || contribution.hiddenByHost
      ? []
      : [copyOfPost(contribution)];
  // Plausible: the one place the quotas are spent.
  if (!request.admit(planId)) return "limited";
  await deps.reports.create({
    id: deps.ids.rowId(),
    planId,
    reason: "other",
    details: detailsOf(request.text),
    attached,
    createdAt: deps.clock.now(),
    resolvedAt: undefined,
  });
  await queueReportAlert(deps);
  return "reported";
}
