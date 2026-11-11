// The export ZIP (spec 3.7, decision I45): a versioned data.json, and per plan its calendar file,
// its route as GPX where the device may see it, and one's own recap contributions as Markdown.
// Built in memory on demand and never stored.
import type { Context } from "hono";
import { strToU8, zipSync } from "fflate";
import type { ExportData, ExportedPlan } from "../../../application/my-data.ts";
import type { ExactStart, GeoPoint } from "../../../domain/geo.ts";
import type { PaceBand } from "../../../domain/pace.ts";
import type { PlanTemplate } from "../../../domain/template.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { toGpx } from "../../out/gpx/write-gpx.ts";
import { fileName } from "./file-names.ts";
import { writeCalendar } from "./ics.ts";
import { calendarEvents } from "./views/calendar-events.ts";

/**
 * Changes whenever data.json changes shape, so importers can tell versions apart (2: ratings;
 * 3: mayPostSince, set in device exports when an invite link lets the device create plans;
 * 4: account, set in account exports; 5: notificationEmail per plan, decision D31).
 */
export const EXPORT_VERSION = 5;

const orNull = <T>(value: T | undefined): T | null => value ?? null;
const pointJson = (point: GeoPoint | undefined) =>
  point === undefined ? null : { lat: point.lat, lng: point.lng };
const exactStartJson = (exact: ExactStart | undefined) =>
  exact === undefined
    ? null
    : { point: pointJson(exact.point), description: orNull(exact.description) };
const paceJson = (pace: PaceBand | undefined) =>
  pace === undefined
    ? null
    : { fastestSecondsPerKm: pace.fastest, slowestSecondsPerKm: pace.slowest };
const names = (people: readonly { name: string }[] | undefined) =>
  people === undefined ? null : people.map((person) => person.name);

/**
 * A plan in data.json, field by field, so the file only changes shape with EXPORT_VERSION.
 * Fields this audience does not see are null.
 */
function planJson(plan: ExportedPlan) {
  const { view } = plan;
  return {
    id: view.id,
    title: view.title,
    activity: view.activity,
    host: view.posterName,
    startsAt: view.startsAt,
    timeZone: view.timeZone,
    area: { label: view.area.label, point: pointJson(view.area.point) },
    exactStart: "exactStart" in view ? exactStartJson(view.exactStart) : null,
    distanceMeters: orNull(view.distanceMeters),
    elevationGainMeters: orNull(view.elevationGainMeters),
    pace: paceJson(view.pace),
    dropPolicy: view.dropPolicy,
    joinMode: view.joinMode,
    note: orNull(view.note),
    status: view.status,
    deleteAt: view.deleteAt,
    participants: "participants" in view ? names(view.participants) : null,
    interested: "interested" in view ? names(view.interested) : null,
    pendingRequests: "pendingRequests" in view ? view.pendingRequests : null,
  };
}

function ownResponseJson(plan: ExportedPlan) {
  if (!("ownResponse" in plan.view)) return null;
  const own = plan.view.ownResponse;
  return {
    kind: own.kind,
    displayName: own.displayName,
    notAnswered: own.notAnswered,
    requestNote: orNull(plan.requestNote),
  };
}

function templateJson(template: PlanTemplate) {
  return {
    id: template.id,
    title: template.title,
    activity: template.activity,
    host: template.posterName,
    startTime: template.startTime,
    timeZone: template.timeZone,
    area: { label: template.area.label, point: pointJson(template.area.point) },
    exactStart: exactStartJson(template.exactStart),
    distanceMeters: orNull(template.distanceMeters),
    elevationGainMeters: orNull(template.elevationGainMeters),
    pace: paceJson(template.pace),
    dropPolicy: template.dropPolicy,
    joinMode: template.joinMode,
    note: orNull(template.note),
    retentionDays: template.retentionDays,
    recapWindow: template.recapWindow,
    expiresAt: template.expiresAt,
  };
}

function recapMarkdown(plan: ExportedPlan, t: Translate): string {
  const parts = [`# ${t("export.recapHeading", { title: plan.view.title })}`, ""];
  for (const contribution of plan.ownContributions) {
    if (contribution.body !== undefined) parts.push(contribution.body, "");
    if (contribution.linkUrl !== undefined) parts.push(`<${contribution.linkUrl}>`, "");
    if (contribution.hidden) parts.push(`_${t("export.hiddenByHost")}_`, "");
    parts.push("---", "");
  }
  return parts.join("\n");
}

export function exportZip(
  data: ExportData,
  options: { t: Translate; language: string; baseUrl: URL },
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, content: string) => {
    files[path] = strToU8(content);
    return path;
  };

  const plans = data.plans.map((plan, index) => {
    const folder = `plans/${index + 1}-${fileName(plan.view.title, "plan")}`;
    const calendar = add(
      `${folder}/plan.ics`,
      writeCalendar({
        now: data.exportedAt,
        events: calendarEvents([plan.calendar], { ...options, deletionEntries: false }),
      }),
    );
    const route =
      plan.route === undefined
        ? undefined
        : add(`${folder}/route.gpx`, toGpx(plan.route, plan.view.title));
    const recap =
      plan.ownContributions.length === 0
        ? undefined
        : add(`${folder}/recap.md`, recapMarkdown(plan, options.t));
    return {
      role: plan.role,
      plan: planJson(plan),
      ownResponse: ownResponseJson(plan),
      notificationEmail:
        plan.email === undefined
          ? null
          : { address: plan.email.address, confirmed: plan.email.confirmed },
      ownContributions: plan.ownContributions.map((c) => ({
        body: orNull(c.body),
        link: orNull(c.linkUrl),
        hiddenByHost: c.hidden,
      })),
      ownRating:
        plan.ownRating === undefined
          ? null
          : { value: plan.ownRating.value, note: orNull(plan.ownRating.note) },
      ratingResult:
        plan.ratingResult === undefined
          ? null
          : {
              participants: plan.ratingResult.participants,
              rated: plan.ratingResult.rated,
              up: plan.ratingResult.up,
              down: plan.ratingResult.down,
              notes: plan.ratingResult.notes.map((n) => ({
                author: n.authorName,
                value: n.value,
                note: n.note,
              })),
            },
      files: { calendar, route: orNull(route), recap: orNull(recap) },
    };
  });

  const templates = data.templates.map(({ template, route }, index) => ({
    template: templateJson(template),
    files: {
      route:
        route === undefined
          ? null
          : add(
              `templates/${index + 1}-${fileName(template.title, "template")}/route.gpx`,
              toGpx(route, template.title),
            ),
    },
  }));

  add(
    "data.json",
    JSON.stringify(
      {
        format: "rendezroute-export",
        version: EXPORT_VERSION,
        exportedAt: data.exportedAt,
        plans,
        templates,
        calendarFeed: data.calendarFeed,
        mayPostSince: orNull(data.mayPostSince),
        account:
          data.account === undefined
            ? null
            : {
                provider: data.account.provider,
                subject: data.account.subject,
                handle: orNull(data.account.handle),
                displayName: orNull(data.account.displayName),
                createdAt: data.account.createdAt,
                lastActiveAt: data.account.lastActiveAt,
              },
      },
      null,
      2,
    ),
  );
  return zipSync(files);
}

/** Sends an export as a download that no cache keeps (spec 3.7: generated on demand, not stored). */
export function zipDownload(c: Context, zip: Uint8Array, name: string): Response {
  c.header("content-type", "application/zip");
  c.header("content-disposition", `attachment; filename="${name}"`);
  c.header("cache-control", "private, no-store");
  return c.body(zip.slice().buffer);
}
