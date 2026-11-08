import type {
  Device,
  DeviceLinkTarget,
  DeviceRepository,
  PlanRepository,
  ResponseRepository,
} from "../../src/application/ports.ts";
import type { Plan } from "../../src/domain/plan.ts";
import type { PlanResponse } from "../../src/domain/response.ts";
import type { Route } from "../../src/domain/route.ts";

/** In-memory repositories sharing one store, like the SQLite adapters share a database. */
export function createFakeRepositories(): {
  plans: PlanRepository;
  devices: DeviceRepository & { all(): Device[] };
  responses: ResponseRepository;
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

  const linkKey = (deviceId: string, target: DeviceLinkTarget) =>
    `${deviceId}|${target.role}|${target.role === "host" ? target.planId : target.responseId}`;
  const copy = (response: PlanResponse) => structuredClone(response);

  /** Plan deletion with the cascades the database performs. */
  const deletePlan = (id: string) => {
    plans.delete(id);
    routes.delete(id);
    previews.delete(id);
    for (const [nonce, planId] of planNonces) if (planId === id) planNonces.delete(nonce);
    for (const [responseId, entry] of responses) {
      if (entry.response.planId !== id) continue;
      responses.delete(responseId);
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
          .map((e) => e.plan.id);
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
      async findWithRetentionAbove(max) {
        return [...plans.values()]
          .filter((e) => e.plan.retentionDays > max)
          .map((e) => structuredClone(e.plan));
      },
      delete: async (id) => deletePlan(id),
      async deleteMany(ids) {
        for (const id of ids) deletePlan(id);
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
  };
}
