// "My data on this device" (spec 3.2, 3.7, decision I45): what a device is linked to, export as
// data the adapter packs into a ZIP, and deleting all of it with the device itself.
import type { IdentityProviderKind } from "../domain/identity.ts";
import type { Plan, PlanStatus } from "../domain/plan.ts";
import type { ResponseKind } from "../domain/response.ts";
import type { Route } from "../domain/route.ts";
import type { PlanTemplate } from "../domain/template.ts";
import { type CalendarEntry, entryOf } from "./calendar.ts";
import { lookupDevice, resolveDevice } from "./devices.ts";
import { deletionNotices } from "./notify.ts";
import type {
  ContributionView,
  PlanViewForParticipant,
  PlanViewForPoster,
  PlanViewForResponder,
  RatingResultView,
  RatingView,
} from "./plan-views.ts";
import { type PlanDeps, viewPlan } from "./plans.ts";
import type { AccessScope, LinkedPlan } from "./ports.ts";
import { withdrawResponse } from "./responses.ts";
import { exportedEmail } from "./email.ts";
import { exportedTelegramChat } from "./telegram.ts";

export interface MyDataItem {
  planId: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  status: PlanStatus;
}

export interface MyData {
  hosted: MyDataItem[];
  responses: (MyDataItem & { responseKind: ResponseKind })[];
  templates: Pick<PlanTemplate, "id" | "title" | "expiresAt" | "timeZone">[];
  calendarFeed: boolean;
  /** Since when an invite link lets the device itself create plans (spec 7 Moderation); not its account's. */
  mayPostSince: Date | undefined;
  /** Logged in to an account, which deleting the device's data keeps (spec 7 Identity). */
  loggedIn: boolean;
}

const EMPTY: MyData = {
  loggedIn: false,
  hosted: [],
  responses: [],
  templates: [],
  calendarFeed: false,
  mayPostSince: undefined,
};

export const itemOf = (plan: Plan): MyDataItem => ({
  planId: plan.id,
  title: plan.title,
  startsAt: plan.startsAt,
  timeZone: plan.timeZone,
  status: plan.status,
});

/** Everything linked to the device. Never changes state, so the page can be a GET. */
export async function viewMyData(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<MyData> {
  const device = await lookupDevice(deps, request.deviceToken);
  if (device === undefined) return EMPTY;
  const linked = await deps.plans.findLinkedToDevice(device.id, "device");
  return {
    hosted: linked.flatMap((entry) => (entry.role === "host" ? [itemOf(entry.plan)] : [])),
    responses: linked.flatMap((entry) =>
      entry.role === "manage" ? [{ ...itemOf(entry.plan), responseKind: entry.responseKind }] : [],
    ),
    templates: (await deps.templates.listForDevice(device.id, "device")).map(
      ({ id, title, expiresAt, timeZone }) => ({ id, title, expiresAt, timeZone }),
    ),
    calendarFeed: (await deps.calendarFeeds.findForDevice(device.id)) !== undefined,
    mayPostSince: await deps.permissions.deviceMayPostSince(device.id),
    loggedIn: device.identityId !== undefined,
  };
}

/** One's own recap contribution, without anyone else's (user decision 2026-11-09). */
export type ExportedContribution = Pick<ContributionView, "body" | "linkUrl" | "hidden">;

/**
 * A plan as the device sees it (spec 3.6), from the same read model as its page, so an export never
 * holds more than the page shows; other people appear only by display name (spec 3.7).
 */
export interface ExportedPlan {
  role: "host" | "response";
  view:
    | Omit<PlanViewForPoster, "recap">
    | Omit<PlanViewForParticipant, "recap">
    | PlanViewForResponder;
  /** One's own request note while it waits for a decision. */
  requestNote: string | undefined;
  /** The address for this plan's or response's emails (decision D31). */
  email: { address: string; confirmed: boolean } | undefined;
  /** The Telegram chat this plan's or response's notifications go to, once linked (D34). */
  telegramChat: string | undefined;
  ownContributions: ExportedContribution[];
  /** Only where the page offers it: the host and accepted participants. */
  route: Route | undefined;
  calendar: CalendarEntry;
  /** A participant's own rating (spec 6a); nobody else's. */
  ownRating: RatingView["own"];
  /** The host's result, once it shows on the host page (spec 6a). */
  ratingResult: RatingResultView | undefined;
}

export interface ExportedTemplate {
  template: PlanTemplate;
  route: Route | undefined;
}

export interface ExportData {
  exportedAt: Date;
  plans: ExportedPlan[];
  templates: ExportedTemplate[];
  /** Whether the device has a calendar feed; its link is a secret and not exported. */
  calendarFeed: boolean;
  /** Device exports only: since when an invite link lets the device create plans. */
  mayPostSince: Date | undefined;
  /** Account exports only: the account itself (spec 3.7), never its provider identifier's hash. */
  account?: ExportedAccount | undefined;
}

export interface ExportedAccount {
  provider: IdentityProviderKind;
  /** The provider's identifier for the account, as stored. */
  subject: string;
  handle: string | undefined;
  displayName: string | undefined;
  createdAt: Date;
  lastActiveAt: Date;
  /** The account's own address (decision D31). */
  email: { address: string; confirmed: boolean } | undefined;
  /** The account's linked Telegram chat (decision D34). */
  telegramChat: string | undefined;
}

/** Everything linked to the device, one plan it hosts, one's own response, or one template. */
export type ExportScope =
  | { kind: "device" }
  | { kind: "hosted"; planId: string }
  | { kind: "response"; planId: string }
  | { kind: "template"; templateId: string };

/** The plan as this device sees it, read once: if it hosts the plan or has a response to it. */
export async function exportedPlan(
  deps: PlanDeps,
  planId: string,
  device: { id: string; token: string | undefined },
  /** Whose eyes: a browser export reads as the browser, an account export as the account. */
  scope: AccessScope = "device_and_account",
): Promise<ExportedPlan | undefined> {
  const result = await viewPlan(deps, {
    planId,
    deviceToken: device.token,
    withRatingResult: true,
    scope,
  });
  if (result.kind === "not_found" || result.kind === "viewer") return undefined;
  const hosting = result.kind === "poster";
  const insider = hosting || result.kind === "participant";
  const exactStart = insider ? result.view.exactStart : undefined;
  const calendar = entryOf(result.view, { hosting, exactStart });
  const response = hosting
    ? undefined
    : await deps.responses.findForDevice(planId, device.id, scope);
  const requestNote = response?.requestNote;
  const channelOwner = hosting
    ? { planId }
    : response === undefined
      ? undefined
      : { responseId: response.id };
  const email = channelOwner === undefined ? undefined : await exportedEmail(deps, channelOwner);
  const telegramChat =
    channelOwner === undefined ? undefined : await exportedTelegramChat(deps, channelOwner);
  if (result.kind === "responder") {
    return {
      role: "response",
      view: result.view,
      requestNote,
      email,
      telegramChat,
      ownContributions: [],
      route: undefined,
      calendar,
      ownRating: undefined,
      ratingResult: undefined,
    };
  }
  const { recap, ...view } = result.view;
  // Per audience (spec 6a): the host's result for the host, one's own rating for a participant.
  const ownRating = result.kind === "participant" ? result.view.rating?.own : undefined;
  const ratingResult = result.kind === "poster" ? result.view.ratingResult : undefined;
  return {
    role: hosting ? "host" : "response",
    view,
    requestNote,
    email,
    telegramChat,
    ownContributions: (recap?.contributions ?? [])
      .filter((c) => c.own)
      .map(({ body, linkUrl, hidden }) => ({ body, linkUrl, hidden })),
    route: view.hasRoute ? await deps.plans.findRoute(planId) : undefined,
    calendar,
    ownRating,
    ratingResult,
  };
}

export async function exportedTemplate(
  deps: PlanDeps,
  template: PlanTemplate,
): Promise<ExportedTemplate> {
  const route = template.hasRoute ? await deps.templates.findRoute(template.id) : undefined;
  return { template, route };
}

/** The export for a scope; reading the plans marks the device as seen today, like their pages. */
export async function exportMyData(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; scope: ExportScope },
): Promise<{ kind: "found"; data: ExportData } | { kind: "not_found" }> {
  const { scope } = request;
  const lookedUp = await lookupDevice(deps, request.deviceToken);
  if (lookedUp === undefined) return { kind: "not_found" };
  const device = { id: lookedUp.id, token: request.deviceToken };
  const data = (parts: Partial<ExportData>): { kind: "found"; data: ExportData } => ({
    kind: "found",
    data: {
      exportedAt: deps.clock.now(),
      plans: [],
      templates: [],
      calendarFeed: false,
      mayPostSince: undefined,
      ...parts,
    },
  });

  switch (scope.kind) {
    case "hosted":
    case "response": {
      const plan = await exportedPlan(deps, scope.planId, device);
      const wanted = scope.kind === "hosted" ? "host" : "response";
      return plan?.role === wanted ? data({ plans: [plan] }) : { kind: "not_found" };
    }
    case "template": {
      const template = await deps.templates.findById(scope.templateId);
      const linked =
        template !== undefined &&
        (await deps.devices.hasLink(device.id, { role: "template", templateId: template.id }));
      return linked
        ? data({ templates: [await exportedTemplate(deps, template)] })
        : { kind: "not_found" };
    }
    case "device": {
      const plans: ExportedPlan[] = [];
      for (const entry of await deps.plans.findLinkedToDevice(device.id, "device")) {
        // As this browser itself, never its account (I52).
        const plan = await exportedPlan(deps, entry.plan.id, device, "device");
        if (plan !== undefined) plans.push(plan);
      }
      const templates: ExportedTemplate[] = [];
      for (const template of await deps.templates.listForDevice(device.id, "device")) {
        templates.push(await exportedTemplate(deps, template));
      }
      const calendarFeed = (await deps.calendarFeeds.findForDevice(device.id)) !== undefined;
      const mayPostSince = await deps.permissions.deviceMayPostSince(device.id);
      return data({ plans, templates, calendarFeed, mayPostSince });
    }
  }
}

/**
 * Removes what was listed, as its owner (spec 3.7, 3.10): hosted plans are deleted for everyone,
 * telling those still in first if they are upcoming, and never keep a template; responses are
 * withdrawn; templates are deleted. Shared by "Delete my data" and account deletion.
 */
export async function removeOwnData(
  deps: PlanDeps,
  linked: readonly LinkedPlan[],
  templates: readonly PlanTemplate[],
): Promise<void> {
  const hosted = linked.flatMap((entry) => (entry.role === "host" ? [entry.plan] : []));
  for (const entry of linked) {
    if (entry.role !== "manage" || hosted.some((plan) => plan.id === entry.plan.id)) continue;
    // Exactly the listed response: a browser's own, never its account's (step 5a).
    const response = await deps.responses.findById(entry.responseId);
    if (response !== undefined) await withdrawResponse(deps, entry.plan, response);
  }
  // Notices are collected while the channels still exist, and queued once the plans are gone.
  const notices = await Promise.all(hosted.map((plan) => deletionNotices(deps, plan)));
  await deps.plans.deleteMany(hosted.map((plan) => plan.id));
  for (const send of notices) await send();
  for (const template of templates) await deps.templates.delete(template.id);
}

/**
 * "Delete my data": everything this browser holds itself, as removeOwnData does, then the
 * calendar feed and the device itself (spec 3.7, 3.10; user decision 2026-11-09). Its account,
 * if logged in, stays (decision D25).
 */
export async function deleteMyData(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "deleted" } | { kind: "not_found" }> {
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined) return { kind: "not_found" };
  await removeOwnData(
    deps,
    await deps.plans.findLinkedToDevice(device.id, "device"),
    await deps.templates.listForDevice(device.id, "device"),
  );
  // Its links, calendar feed and permissions go with it.
  await deps.devices.delete(device.id);
  return { kind: "deleted" };
}
