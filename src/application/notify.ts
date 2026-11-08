// Queues notifications for the people a plan event concerns (spec 6 feature 3, decision D17):
// one job per channel, in the recipient's stored language, tied to the plan or response so that
// deleting them removes the jobs (spec 3.10).
import type { NotificationKind } from "../domain/notification.ts";
import type { Plan } from "../domain/plan.ts";
import type { ResponseChoice } from "../domain/requests.ts";
import type { PushSubscription } from "../domain/push.ts";
import type { PlanResponse, ResponseKind } from "../domain/response.ts";
import { enqueueNotification } from "./notifications.ts";
import type { PlanDeps } from "./plans.ts";
import type { ChannelOwner, SentReminder } from "./ports.ts";

/** People still in a plan: rejected and removed people get one notice and nothing after (spec 3.5). */
const STILL_IN: ReadonlySet<ResponseKind> = new Set(["interested", "requested", "joined"]);

/** Deletion notices outlive their plan by at most this long (spec 3.10). */
const DELETION_NOTICE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Someone to notify: the owner of the channels, and the language to write in. */
export interface Recipient {
  owner: ChannelOwner;
  language: string;
}

export const hostOf = (plan: Plan): Recipient => ({
  owner: { planId: plan.id },
  language: plan.posterLanguage,
});

export const responderOf = (response: PlanResponse): Recipient => ({
  owner: { responseId: response.id },
  language: response.language,
});

/** Queues the notification for every channel of the recipient; returns how many. */
export async function notify(
  deps: PlanDeps,
  plan: Plan,
  { owner, language }: Recipient,
  kind: NotificationKind,
  options: {
    /** For messages that are useless later, such as a reminder after the start. */
    expiresAt?: Date | undefined;
    /** For a reminder, checked again before it is sent. */
    reminder?: SentReminder | undefined;
  } = {},
): Promise<number> {
  if (deps.notify === undefined) return 0;
  const channels = await deps.notify.channels.listFor(owner);
  for (const channel of channels) {
    await enqueueNotification(
      { jobs: deps.notify.jobs, clock: deps.clock },
      {
        to: { channelId: channel.id },
        notification: { kind, planTitle: plan.title, planPath: `/p/${plan.id}`, language },
        planId: plan.id,
        responseId: "responseId" in owner ? owner.responseId : undefined,
        ...options,
      },
    );
  }
  return channels.length;
}

export function notifyResponse(
  deps: PlanDeps,
  plan: Plan,
  response: PlanResponse,
  kind: NotificationKind,
): Promise<number> {
  return notify(deps, plan, responderOf(response), kind);
}

/** Responses of the plan of the given kinds, by default everyone still in. */
export async function responsesStillIn(
  deps: PlanDeps,
  plan: Plan,
  kinds: ReadonlySet<ResponseKind> = STILL_IN,
): Promise<PlanResponse[]> {
  const all = await deps.responses.listByPlan(plan.id);
  return all.filter((response) => kinds.has(response.kind));
}

export async function notifyResponders(
  deps: PlanDeps,
  plan: Plan,
  kind: NotificationKind,
): Promise<void> {
  if (deps.notify === undefined) return;
  for (const response of await responsesStillIn(deps, plan)) {
    await notifyResponse(deps, plan, response, kind);
  }
}

export function notifyHost(deps: PlanDeps, plan: Plan, kind: NotificationKind): Promise<number> {
  return notify(deps, plan, hostOf(plan), kind);
}

/** Someone requested or joined, by responding or through the manage page. */
export async function notifyHostOfArrival(
  deps: PlanDeps,
  plan: Plan,
  kind: ResponseChoice,
): Promise<void> {
  await notifyHost(deps, plan, kind === "requested" ? "newRequest" : "newResponse");
}

/**
 * Notices for everyone still in that an upcoming plan was deleted (spec 3.10). Collected before
 * the deletion, since the channels go with the plan; the returned function queues them once the
 * plan is gone. The jobs carry the subscriptions themselves and no plan or response, and expire
 * after 24 hours. No link: the plan is gone.
 */
export async function deletionNotices(deps: PlanDeps, plan: Plan): Promise<() => Promise<void>> {
  const notify = deps.notify;
  const now = deps.clock.now();
  if (notify === undefined || plan.status !== "active" || plan.startsAt <= now) {
    return () => Promise.resolve();
  }
  const notices: { subscription: PushSubscription; language: string }[] = [];
  for (const response of await responsesStillIn(deps, plan)) {
    for (const channel of await notify.channels.listFor({ responseId: response.id })) {
      notices.push({ subscription: channel.subscription, language: response.language });
    }
  }
  return async () => {
    const expiresAt = new Date(deps.clock.now().getTime() + DELETION_NOTICE_LIFETIME_MS);
    for (const { subscription, language } of notices) {
      await enqueueNotification(
        { jobs: notify.jobs, clock: deps.clock },
        {
          to: { subscription },
          notification: { kind: "deleted", planTitle: plan.title, language },
          expiresAt,
        },
      );
    }
  };
}
