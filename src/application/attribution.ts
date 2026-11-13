// Who a plan speaks as in the fediverse (decisions D39, D42, D43): the poster's actor while its
// profile shares the plan, else the instance actor. Shared by what is sent to remote participants.
import { INSTANCE_ACTOR } from "./following.ts";
import type { PlanDeps } from "./plans.ts";
import type { FederationPublisher } from "./ports.ts";

/**
 * Who a plan is attributed to in the fediverse: its owner's actor once the plan was saved under
 * the fediverse wording and while the profile is active (D35, D37); otherwise none, and the
 * federation adapter names the instance actor.
 */
export async function planActor(
  deps: Pick<PlanDeps, "posterActors" | "plans">,
  plan: { id: string; federatedAt: Date | undefined },
): Promise<string | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true || plan.federatedAt === undefined) return undefined;
  const owner = await deps.plans.ownerOf(plan.id);
  return owner === undefined ? undefined : (await actors.profiles.findActive(owner))?.id;
}

/** The publisher, while federation is on. */
export function activePublisher(
  deps: Pick<PlanDeps, "posterActors">,
): FederationPublisher | undefined {
  const actors = deps.posterActors;
  return actors?.enabled === true ? actors.publisher : undefined;
}

/**
 * Who a plan is attributed to now: the poster's actor while it shares the plan, the instance
 * actor otherwise, also for a plan withdrawn from the fediverse (decisions D39, D42), as its
 * `Event` names it.
 */
export async function attributedActor(
  deps: Pick<PlanDeps, "posterActors" | "plans">,
  plan: { id: string; federatedAt: Date | undefined },
): Promise<string> {
  const state = await deps.posterActors?.publications.find(plan.id);
  if (state?.kind === "published") return state.localActor;
  if (state?.kind === "withdrawn") return INSTANCE_ACTOR;
  return (await planActor(deps, plan)) ?? INSTANCE_ACTOR;
}

/**
 * Who sends for a Note already sent: the actor that sent it, while it can sign (decisions D43,
 * D44: a server ignores a `Delete` from another actor than the `Create`'s); else the instance
 * actor.
 */
export async function senderOf(
  deps: Pick<PlanDeps, "posterActors">,
  note: { localActor: string },
): Promise<string> {
  if (note.localActor === INSTANCE_ACTOR) return INSTANCE_ACTOR;
  const actor = await deps.posterActors?.profiles.findActor(note.localActor);
  return actor?.kind === "active" ? note.localActor : INSTANCE_ACTOR;
}
