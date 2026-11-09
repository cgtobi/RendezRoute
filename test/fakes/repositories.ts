import type {
  CalendarFeed,
  CalendarFeedRepository,
  Device,
  DeviceLinkTarget,
  DeviceRepository,
  LinkedPlan,
  NewTemplate,
  PlanRepository,
  RecapRepository,
  ResponseRepository,
  TemplateRepository,
} from "../../src/application/ports.ts";
import type { Plan } from "../../src/domain/plan.ts";
import type { RecapContribution } from "../../src/domain/recap.ts";
import type { PlanResponse } from "../../src/domain/response.ts";
import type { Route } from "../../src/domain/route.ts";
import type { PlanTemplate } from "../../src/domain/template.ts";

/** In-memory repositories sharing one store, like the SQLite adapters share a database. */
export function createFakeRepositories(): {
  plans: PlanRepository;
  devices: DeviceRepository & { all(): Device[] };
  responses: ResponseRepository;
  calendarFeeds: CalendarFeedRepository;
  recap: RecapRepository;
  templates: TemplateRepository;
} {
  const plans = new Map<string, { plan: Plan; hostTokenHash: string }>();
  const routes = new Map<string, Route>();
  const previews = new Map<string, { version: string; image: Uint8Array }>();
  const planNonces = new Map<string, string>();
  const devices = new Map<string, { device: Device; tokenHash: string }>();
  const links = new Set<string>();
  const responses = new Map<
    string,
    { response: PlanResponse; manageTokenHash: string; deviceId: string | undefined }
  >();
  const responseNonces = new Map<string, string>();
  const feeds = new Map<string, CalendarFeed & { tokenHash: string }>();
  const contributions = new Map<string, RecapContribution>();
  const templates = new Map<
    string,
    {
      template: PlanTemplate;
      hostTokenHash: string | undefined;
      route: Route | undefined;
      creationNonce: string | undefined;
    }
  >();
  const deleteContributions = (matches: (c: RecapContribution) => boolean) => {
    let deleted = 0;
    for (const [id, c] of contributions) {
      if (matches(c)) {
        contributions.delete(id);
        deleted++;
      }
    }
    return deleted;
  };

  const targetId = (target: DeviceLinkTarget) =>
    target.role === "host"
      ? target.planId
      : target.role === "manage"
        ? target.responseId
        : target.templateId;
  const linkKey = (deviceId: string, target: DeviceLinkTarget) =>
    `${deviceId}|${target.role}|${targetId(target)}`;
  const deleteTemplate = (id: string) => {
    templates.delete(id);
    for (const key of links) if (key.endsWith(`|template|${id}`)) links.delete(key);
  };
  /** Stores a template and links the plan's host devices, like the SQLite adapter. */
  const insertTemplate = ({
    template,
    hostTokenHash,
    route,
    hostsOfPlan,
    creationNonce,
  }: NewTemplate) => {
    if (
      creationNonce !== undefined &&
      [...templates.values()].some((e) => e.creationNonce === creationNonce)
    ) {
      throw new Error("duplicate key");
    }
    templates.set(template.id, {
      creationNonce,
      template: structuredClone({ ...template, hasRoute: route !== undefined }),
      hostTokenHash,
      route: structuredClone(route),
    });
    const hostDevices = Array.from(links, (key) => key.split("|"))
      .filter(([, role, id]) => role === "host" && id === hostsOfPlan)
      .map(([device = ""]) => device);
    for (const device of hostDevices) {
      links.add(linkKey(device, { role: "template", templateId: template.id }));
    }
  };
  const copy = (response: PlanResponse) => structuredClone(response);

  /** Plan deletion with the cascades the database performs. */
  const deletePlan = (id: string) => {
    plans.delete(id);
    routes.delete(id);
    deleteContributions((c) => c.planId === id);
    previews.delete(id);
    for (const [nonce, planId] of planNonces) if (planId === id) planNonces.delete(nonce);
    for (const [responseId, entry] of responses) {
      if (entry.response.planId !== id) continue;
      responses.delete(responseId);
      deleteContributions((c) => c.responseId === responseId);
      for (const key of links) if (key.endsWith(`|manage|${responseId}`)) links.delete(key);
    }
    for (const key of links) if (key.endsWith(`|host|${id}`)) links.delete(key);
  };

  const activeWhere = (matches: (plan: Plan) => boolean) =>
    [...plans.values()]
      .filter((e) => e.plan.status === "active" && matches(e.plan))
      .map((e) => structuredClone(e.plan));

  return {
    plans: {
      async create({ plan, hostTokenHash, creationNonce, hostDeviceId, route }) {
        if (plans.has(plan.id) || planNonces.has(creationNonce)) throw new Error("duplicate key");
        if (route !== undefined) routes.set(plan.id, structuredClone(route));
        plans.set(plan.id, { plan: structuredClone(plan), hostTokenHash });
        planNonces.set(creationNonce, plan.id);
        links.add(linkKey(hostDeviceId, { role: "host", planId: plan.id }));
      },
      async findById(id) {
        const entry = plans.get(id);
        return entry === undefined ? undefined : structuredClone(entry.plan);
      },
      async findByHostTokenHash(hash) {
        const entry = [...plans.values()].find((candidate) => candidate.hostTokenHash === hash);
        return entry === undefined ? undefined : structuredClone(entry.plan);
      },
      async findIdByCreationNonce(nonce) {
        return planNonces.get(nonce);
      },
      async update(plan) {
        const entry = plans.get(plan.id);
        if (entry !== undefined) entry.plan = structuredClone(plan);
      },

      async findDueForDeletion(now) {
        return [...plans.values()]
          .filter((e) => e.plan.deleteAt.getTime() <= now.getTime())
          .map((e) => structuredClone(e.plan));
      },
      async findRoute(planId) {
        const route = routes.get(planId);
        return route === undefined ? undefined : structuredClone(route);
      },
      async saveRoute(planId, route) {
        routes.set(planId, structuredClone(route));
        const entry = plans.get(planId);
        if (entry !== undefined) entry.plan = { ...entry.plan, hasRoute: true };
      },
      async findPreview(planId, version) {
        const entry = previews.get(planId);
        return entry?.version === version ? entry.image.slice() : undefined;
      },
      async savePreview(planId, version, image) {
        if (plans.has(planId)) previews.set(planId, { version, image: image.slice() });
      },
      async deleteRoute(planId) {
        routes.delete(planId);
        const entry = plans.get(planId);
        if (entry !== undefined) entry.plan = { ...entry.plan, hasRoute: false };
      },
      async findActiveStartingBetween(from, to) {
        return activeWhere((plan) => plan.startsAt >= from && plan.startsAt <= to);
      },
      async findActiveDeletingBetween(from, to) {
        return activeWhere((plan) => plan.deleteAt >= from && plan.deleteAt <= to);
      },
      async findLinkedToDevice(deviceId) {
        const linked: LinkedPlan[] = [];
        for (const key of links) {
          const [device, role, id = ""] = key.split("|");
          if (device !== deviceId) continue;
          if (role === "host") {
            const entry = plans.get(id);
            if (entry !== undefined)
              linked.push({ plan: structuredClone(entry.plan), role: "host" });
          } else {
            const response = responses.get(id)?.response;
            const entry = response && plans.get(response.planId);
            if (response !== undefined && entry !== undefined) {
              linked.push({
                plan: structuredClone(entry.plan),
                role: "manage",
                responseKind: response.kind,
              });
            }
          }
        }
        return linked.sort((a, b) => a.plan.startsAt.getTime() - b.plan.startsAt.getTime());
      },
      async findWithRetentionAbove(max) {
        return [...plans.values()]
          .filter((e) => e.plan.retentionDays > max)
          .map((e) => structuredClone(e.plan));
      },
      delete: async (id) => deletePlan(id),
      async deleteMany(ids, kept = []) {
        for (const template of kept) insertTemplate(template);
        for (const id of ids) deletePlan(id);
      },
    },

    templates: {
      async create(input) {
        insertTemplate(input);
      },
      async findById(id) {
        const entry = templates.get(id);
        return entry === undefined ? undefined : structuredClone(entry.template);
      },
      async findByHostTokenHash(hash) {
        const entry = [...templates.values()].find((e) => e.hostTokenHash === hash);
        return entry === undefined ? undefined : structuredClone(entry.template);
      },
      async findIdByCreationNonce(nonce) {
        return [...templates.values()].find((e) => e.creationNonce === nonce)?.template.id;
      },
      async update(template) {
        const entry = templates.get(template.id);
        if (entry !== undefined) {
          entry.template = structuredClone({ ...template, hasRoute: entry.route !== undefined });
        }
      },
      async markUsed(id, lastUsedAt, expiresAt) {
        const entry = templates.get(id);
        if (entry !== undefined) {
          entry.template = { ...entry.template, lastUsedAt, expiresAt, updatedAt: lastUsedAt };
        }
      },
      async findRoute(id) {
        return structuredClone(templates.get(id)?.route);
      },
      async deleteRoute(id) {
        const entry = templates.get(id);
        if (entry !== undefined) {
          entry.route = undefined;
          entry.template = { ...entry.template, hasRoute: false };
        }
      },
      async delete(id) {
        deleteTemplate(id);
      },
      async listForDevice(deviceId) {
        return [...templates.values()]
          .filter((e) =>
            links.has(linkKey(deviceId, { role: "template", templateId: e.template.id })),
          )
          .map((e) => structuredClone(e.template))
          .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      },
      async deleteExpired(now) {
        const expired = [...templates.values()].filter(
          (e) => e.template.expiresAt.getTime() <= now.getTime(),
        );
        for (const e of expired) deleteTemplate(e.template.id);
        return expired.length;
      },
    },

    devices: {
      async findByTokenHash(hash) {
        const entry = [...devices.values()].find((candidate) => candidate.tokenHash === hash);
        return entry === undefined ? undefined : { ...entry.device };
      },
      async create({ id, tokenHash, now }) {
        devices.set(id, { device: { id, lastSeenAt: now }, tokenHash });
      },
      async touch(id, now) {
        const entry = devices.get(id);
        if (entry !== undefined) entry.device = { ...entry.device, lastSeenAt: now };
      },
      async link(deviceId, target) {
        links.add(linkKey(deviceId, target));
      },
      async hasLink(deviceId, target) {
        return links.has(linkKey(deviceId, target));
      },
      async deleteInactive({ unlinkedLastSeenBefore, anyLastSeenBefore }) {
        let deleted = 0;
        for (const [id, entry] of devices) {
          const seen = entry.device.lastSeenAt.getTime();
          const linked = [...links].some((key) => key.startsWith(`${id}|`));
          if (
            seen < anyLastSeenBefore.getTime() ||
            (!linked && seen < unlinkedLastSeenBefore.getTime())
          ) {
            devices.delete(id);
            feeds.delete(id);
            for (const key of links) if (key.startsWith(`${id}|`)) links.delete(key);
            deleted++;
          }
        }
        return deleted;
      },
      all: () => [...devices.values()].map((entry) => ({ ...entry.device })),
    },

    responses: {
      async create({ response, manageTokenHash, creationNonce, deviceId }) {
        if (responses.has(response.id) || responseNonces.has(creationNonce))
          throw new Error("duplicate key");
        responses.set(response.id, { response: copy(response), manageTokenHash, deviceId });
        responseNonces.set(creationNonce, response.id);
        if (deviceId !== undefined)
          links.add(linkKey(deviceId, { role: "manage", responseId: response.id }));
      },
      async findById(id) {
        const entry = responses.get(id);
        return entry === undefined ? undefined : copy(entry.response);
      },
      async findByManageTokenHash(hash) {
        const entry = [...responses.values()].find(
          (candidate) => candidate.manageTokenHash === hash,
        );
        return entry === undefined ? undefined : copy(entry.response);
      },
      async findIdByCreationNonce(nonce) {
        return responseNonces.get(nonce);
      },
      async findForDevice(planId, deviceId) {
        const entry = [...responses.values()].find(
          (candidate) =>
            candidate.response.planId === planId &&
            links.has(linkKey(deviceId, { role: "manage", responseId: candidate.response.id })),
        );
        return entry === undefined ? undefined : copy(entry.response);
      },
      async listByPlan(planId) {
        return [...responses.values()]
          .filter((entry) => entry.response.planId === planId)
          .map((entry) => copy(entry.response));
      },
      async counts(planId) {
        const kinds = [...responses.values()]
          .filter((e) => e.response.planId === planId)
          .map((e) => e.response.kind);
        return {
          interested: kinds.filter((kind) => kind === "interested").length,
          participants: kinds.filter((kind) => kind === "joined").length,
        };
      },
      async update(response) {
        const entry = responses.get(response.id);
        if (entry !== undefined) entry.response = copy(response);
      },
      async delete(id) {
        responses.delete(id);
        deleteContributions((c) => c.responseId === id);
        for (const key of links) if (key.endsWith(`|manage|${id}`)) links.delete(key);
      },
      async isBlocked(planId, deviceId) {
        return [...responses.values()].some(
          (entry) =>
            entry.response.planId === planId &&
            entry.deviceId === deviceId &&
            (entry.response.kind === "rejected" || entry.response.kind === "removed"),
        );
      },
    },

    recap: {
      async create(c) {
        contributions.set(c.id, structuredClone(c));
      },
      async update(c) {
        const existing = contributions.get(c.id);
        if (existing !== undefined) contributions.set(c.id, { ...existing, ...structuredClone(c) });
      },
      async findById(id) {
        const c = contributions.get(id);
        return c === undefined ? undefined : structuredClone(c);
      },
      async listByPlan(planId) {
        return [...contributions.values()]
          .filter((c) => c.planId === planId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
          .map((c) => structuredClone(c));
      },
      async countByPlan(planId) {
        return [...contributions.values()].filter((c) => c.planId === planId).length;
      },
      async countByAuthor(planId, responseId) {
        return [...contributions.values()].filter(
          (c) => c.planId === planId && c.responseId === responseId,
        ).length;
      },
      async delete(id) {
        contributions.delete(id);
      },
      async deleteForResponse(responseId) {
        deleteContributions((c) => c.responseId === responseId);
      },
      async deleteForPlan(planId) {
        return deleteContributions((c) => c.planId === planId);
      },
    },
    calendarFeeds: {
      async replace(feed) {
        feeds.set(feed.deviceId, { ...feed });
      },
      async findByTokenHash(hash) {
        const found = [...feeds.values()].find((feed) => feed.tokenHash === hash);
        return found === undefined ? undefined : withoutHash(found);
      },
      async findForDevice(deviceId) {
        const found = feeds.get(deviceId);
        return found === undefined ? undefined : withoutHash(found);
      },
      async deleteForDevice(deviceId) {
        feeds.delete(deviceId);
      },
      async deleteUnlinked() {
        let deleted = 0;
        for (const deviceId of feeds.keys()) {
          if (![...links].some((key) => key.startsWith(`${deviceId}|`))) {
            feeds.delete(deviceId);
            deleted++;
          }
        }
        return deleted;
      },
    },
  };
}

function withoutHash(feed: CalendarFeed & { tokenHash: string }): CalendarFeed {
  return {
    id: feed.id,
    deviceId: feed.deviceId,
    language: feed.language,
    createdAt: feed.createdAt,
  };
}
