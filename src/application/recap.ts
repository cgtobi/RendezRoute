// The recap's private layer (spec 6 features 5–7, decision I42): participants and the host add
// comments and links while it is open, edit and delete their own at any time; the host hides any
// and can delete the whole recap.
import {
  CONTRIBUTION_LIMITS,
  type ContributionError,
  isRecapOpen,
  type RecapAuthor,
  type RecapContribution,
  validateContribution,
} from "../domain/recap.ts";
import type { Plan } from "../domain/plan.ts";
import { audienceFor, canSee } from "../domain/visibility.ts";
import { resolveDevice } from "./devices.ts";
import { asHost, type Denied, isDenied } from "./host.ts";
import {
  publishContribution,
  syncContributionNotes,
  withdrawNotesOfContribution,
  withdrawNotesOfPlanContributions,
} from "./contribution-notes.ts";
import { notifyResponse, responsesStillIn } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";

/** The plan and the requesting device's role in its recap, if it has one. */
async function authorOf(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<{ plan: Plan; author: RecapAuthor } | Denied> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined) return { kind: "forbidden" };
  if (await deps.devices.hasLink(device.id, { role: "host", planId: plan.id })) {
    return { plan, author: { kind: "host" } };
  }
  const response = await deps.responses.findForDevice(plan.id, device.id);
  // Only those who may see the contributions write them (spec 3.6).
  if (response === undefined || !canSee(audienceFor(response), "recapContributions")) {
    return { kind: "forbidden" };
  }
  return { plan, author: { kind: "participant", responseId: response.id } };
}

const responseIdOf = (author: RecapAuthor) =>
  author.kind === "participant" ? author.responseId : undefined;

type ContributionInput = { body: string; linkUrl: string };

export type AddContributionResult =
  | { kind: "added" }
  | { kind: "invalid"; errors: ContributionError[] }
  /** Before the start, after the recap closed, or a cancelled plan. */
  | { kind: "closed" }
  | { kind: "limit_reached" }
  | Denied;

export async function addContribution(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined } & ContributionInput,
): Promise<AddContributionResult> {
  const found = await authorOf(deps, request);
  if (isDenied(found)) return found;
  const { plan, author } = found;
  const now = deps.clock.now();
  if (!isRecapOpen(plan, now)) return { kind: "closed" };
  const responseId = responseIdOf(author);
  if ((await deps.recap.countByAuthor(plan.id, responseId)) >= CONTRIBUTION_LIMITS.perPerson) {
    return { kind: "limit_reached" };
  }
  const checked = validateContribution(request);
  if (!checked.ok) return { kind: "invalid", errors: checked.errors };
  const id = deps.ids.rowId();
  await deps.recap.create({
    id,
    planId: plan.id,
    responseId,
    ...checked.value,
    hiddenByHost: false,
    createdAt: now,
    updatedAt: now,
  });
  // Last: remote participants get it once it is stored (decision D44).
  await publishContribution(deps, plan, id);
  return { kind: "added" };
}

/** The requesting device's own contribution, for editing (spec 6 feature 5: at any time). */
async function ownContribution(
  deps: PlanDeps,
  request: { planId: string; contributionId: string; deviceToken: string | undefined },
): Promise<{ plan: Plan; contribution: RecapContribution } | Denied> {
  const found = await authorOf(deps, request);
  if (isDenied(found)) return found;
  const contribution = await deps.recap.findById(request.contributionId);
  if (contribution === undefined || contribution.planId !== found.plan.id) {
    return { kind: "not_found" };
  }
  if (contribution.responseId !== responseIdOf(found.author)) return { kind: "forbidden" };
  return { plan: found.plan, contribution };
}

export async function viewOwnContribution(
  deps: PlanDeps,
  request: { planId: string; contributionId: string; deviceToken: string | undefined },
): Promise<{ kind: "found"; body: string; linkUrl: string } | Denied> {
  const found = await ownContribution(deps, request);
  if (isDenied(found)) return found;
  const { body, linkUrl } = found.contribution;
  return { kind: "found", body: body ?? "", linkUrl: linkUrl ?? "" };
}

export async function editContribution(
  deps: PlanDeps,
  request: {
    planId: string;
    contributionId: string;
    deviceToken: string | undefined;
  } & ContributionInput,
): Promise<{ kind: "updated" } | { kind: "invalid"; errors: ContributionError[] } | Denied> {
  const found = await ownContribution(deps, request);
  if (isDenied(found)) return found;
  const checked = validateContribution(request);
  if (!checked.ok) return { kind: "invalid", errors: checked.errors };
  await deps.recap.update({
    ...found.contribution,
    ...checked.value,
    updatedAt: deps.clock.now(),
  });
  // An `Update` of the Notes, only where what they show changed (decision D44).
  await syncContributionNotes(deps, found.plan);
  return { kind: "updated" };
}

export async function deleteContribution(
  deps: PlanDeps,
  request: { planId: string; contributionId: string; deviceToken: string | undefined },
): Promise<{ kind: "deleted" } | Denied> {
  const found = await ownContribution(deps, request);
  if (isDenied(found)) return found;
  // The Notes' `Delete` is queued before the contribution and its rows go (decision D44).
  await withdrawNotesOfContribution(deps, found.contribution.id);
  await deps.recap.delete(found.contribution.id);
  return { kind: "deleted" };
}

/** The host hides or shows any contribution (spec 6 feature 5). */
export async function setContributionHidden(
  deps: PlanDeps,
  request: {
    planId: string;
    contributionId: string;
    deviceToken: string | undefined;
    hidden: boolean;
  },
): Promise<{ kind: "updated" } | Denied> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const contribution = await deps.recap.findById(request.contributionId);
  if (contribution === undefined || contribution.planId !== plan.id) {
    return { kind: "not_found" };
  }
  // The flag first, so a publish in between finds it and sends nothing; then, hidden, the
  // contribution is withdrawn from remote participants, as the web hides it from the others.
  await deps.recap.update({ ...contribution, hiddenByHost: request.hidden });
  if (request.hidden) await withdrawNotesOfContribution(deps, contribution.id);
  // Shown again: a new Note, last (decision D45).
  if (!request.hidden) await publishContribution(deps, plan, contribution.id);
  return { kind: "updated" };
}

/** "Delete recap": all contributions go; participants with a channel are told (spec 6 feature 7). */
export async function deleteRecap(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<{ kind: "deleted"; count: number } | Denied> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  await withdrawNotesOfPlanContributions(deps, plan);
  const count = await deps.recap.deleteForPlan(plan.id);
  if (count > 0) {
    for (const response of await responsesStillIn(deps, plan, new Set(["joined"]))) {
      await notifyResponse(deps, plan, response, "recapDeleted");
    }
  }
  return { kind: "deleted", count };
}
