// Queues notifications for the people a plan event concerns (spec 6 feature 3, decision D17):
// one job per channel, in the recipient's stored language, tied to the plan or response so that
// deleting them removes the jobs (spec 3.10).
import type { NotificationKind } from "../domain/notification.ts";
import type { Plan } from "../domain/plan.ts";
import type { ResponseChoice } from "../domain/requests.ts";
import type { PlanResponse } from "../domain/response.ts";
import { enqueueNotification } from "./notifications.ts";
import type { PlanDeps } from "./plans.ts";
import type { ChannelOwner } from "./ports.ts";

/** People still in a plan: rejected and removed people get one notice and nothing after (spec 3.5). */
const STILL_IN = new Set(["interested", "requested", "joined"]);

async function notify(
  deps: PlanDeps,
  owner: ChannelOwner,
  { kind, plan, language }: { kind: NotificationKind; plan: Plan; language: string },
): Promise<void> {
  if (deps.notify === undefined) return;
  for (const channel of await deps.notify.channels.listFor(owner)) {
    await enqueueNotification(
      { jobs: deps.notify.jobs, clock: deps.clock },
      {
        channelId: channel.id,
        notification: { kind, planTitle: plan.title, planPath: `/p/${plan.id}`, language },
        planId: plan.id,
        responseId: "responseId" in owner ? owner.responseId : undefined,
      },
    );
  }
}

export function notifyResponse(
  deps: PlanDeps,
  plan: Plan,
  response: PlanResponse,
  kind: NotificationKind,
): Promise<void> {
  return notify(deps, { responseId: response.id }, { kind, plan, language: response.language });
}

export async function notifyResponders(
  deps: PlanDeps,
  plan: Plan,
  kind: NotificationKind,
): Promise<void> {
  if (deps.notify === undefined) return;
  for (const response of await deps.responses.listByPlan(plan.id)) {
    if (STILL_IN.has(response.kind)) await notifyResponse(deps, plan, response, kind);
  }
}

export function notifyHost(deps: PlanDeps, plan: Plan, kind: NotificationKind): Promise<void> {
  return notify(deps, { planId: plan.id }, { kind, plan, language: plan.posterLanguage });
}

/** Someone requested or joined, by responding or through the manage page. */
export function notifyHostOfArrival(
  deps: PlanDeps,
  plan: Plan,
  kind: ResponseChoice,
): Promise<void> {
  return notifyHost(deps, plan, kind === "requested" ? "newRequest" : "newResponse");
}
