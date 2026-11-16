import { inBox } from "../../src/domain/nearby.ts";
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
  FormNonceRepository,
  RatingRepository,
  ReportRepository,
  AccessScope,
  InviteRepository,
  PermissionRepository,
  IdentityRepository,
  PendingLogin,
  PendingLoginRepository,
  RemoteActor,
  RemoteJoin,
} from "../../src/application/ports.ts";
import type { Identity } from "../../src/domain/identity.ts";
import { type Invite, inviteState } from "../../src/domain/invite.ts";
import type { Report } from "../../src/domain/report.ts";
import type { Plan } from "../../src/domain/plan.ts";
import type { RecapContribution } from "../../src/domain/recap.ts";
import type { PlanResponse } from "../../src/domain/response.ts";
import type { Route } from "../../src/domain/route.ts";
import type { PlanRating } from "../../src/domain/rating.ts";
import type { PlanTemplate } from "../../src/domain/template.ts";

/** In-memory repositories sharing one store, like the SQLite adapters share a database. */
export function createFakeRepositories(): {
  plans: PlanRepository;
  devices: DeviceRepository & { all(): Device[] };
  responses: ResponseRepository;
  calendarFeeds: CalendarFeedRepository;
  recap: RecapRepository;
  templates: TemplateRepository;
  formNonces: FormNonceRepository;
  ratings: RatingRepository;
  reports: ReportRepository;
  invites: InviteRepository;
  permissions: PermissionRepository;
  identities: IdentityRepository & { all(): Identity[] };
  pendingLogins: PendingLoginRepository;
} {
  const plans = new Map<string, { plan: Plan; hostTokenHash: string }>();
  const routes = new Map<string, Route>();
  const previews = new Map<string, { version: string; image: Uint8Array }>();
  const planNonces = new Map<string, string>();
  const devices = new Map<string, { device: Device; tokenHash: string }>();
  const links = new Set<string>();
  const responses = new Map<
    string,
    {
      response: PlanResponse;
      manageTokenHash: string;
      deviceId: string | undefined;
      /** A remote participant (decision D42); `actor` and `join` as the database keeps them. */
      remote?: { actor: RemoteActor; join: RemoteJoin };
    }
  >();
  const responseNonces = new Map<string, string>();
  const feeds = new Map<string, CalendarFeed & { tokenHash: string }>();
  const contributions = new Map<string, RecapContribution>();
  const usedNonces = new Map<string, Date>();
  /** By response ID: one rating per response. */
  const ratings = new Map<string, PlanRating>();
  const reports = new Map<string, Report>();
  const invites = new Map<string, { invite: Invite; tokenHash: string }>();
  /** When each device ("device:<id>") or account ("identity:<id>") became allowed to post. */
  const mayPost = new Map<string, Date>();
  const identities = new Map<
    string,
    { identity: Identity; subjectHash: string; warnedAt?: Date | undefined }
  >();
  const pendingLogins = new Map<string, PendingLogin>();
  /** The device's own permission, or its account's. */
  const mayPostOf = (deviceId: string) => {
    const identityId = devices.get(deviceId)?.device.identityId;
    const own = mayPost.get(`device:${deviceId}`);
    const account = identityId === undefined ? undefined : mayPost.get(`identity:${identityId}`);
    return [own, account]
      .filter((at) => at !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0];
  };
  const byCreation = (a: Report, b: Report) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
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
  /** Account ownership by "role|id" (step 5a), like the owner columns. */
  const owners = new Map<string, string>();
  /** What a device may act on, as link keys: its links, and its account's items (device_access). */
  const access = (deviceId: string, scope: AccessScope = "device_and_account") => {
    const keys = new Set(
      scope === "account" ? [] : [...links].filter((key) => key.startsWith(`${deviceId}|`)),
    );
    const identityId = devices.get(deviceId)?.device.identityId;
    if (scope !== "device" && identityId !== undefined) {
      for (const [target, owner] of owners) {
        if (owner === identityId) keys.add(`${deviceId}|${target}`);
      }
    }
    return keys;
  };
  /** The device's own links that no account owns yet, by role. */
  /** The plan a link key's target belongs to, if any. */
  const planOfKey = (role: string, id: string) =>
    role === "host" ? id : role === "manage" ? responses.get(id)?.response.planId : undefined;
  /** Whether the account has a response to the plan, or owns it. */
  const accountAnswered = (identityId: string, planId: string) =>
    [...responses.values()].some(
      (entry) =>
        entry.response.planId === planId &&
        owners.get(`manage|${entry.response.id}`) === identityId,
    );
  /** The device's own links that claiming may move, like the SQLite adapter's claimableIds. */
  const claimableKeys = (deviceId: string) => {
    const identityId = devices.get(deviceId)?.device.identityId;
    return [...links].filter((key) => {
      const [device, role = "", id = ""] = key.split("|");
      if (device !== deviceId || owners.has(`${role}|${id}`)) return false;
      const planId = planOfKey(role, id);
      if (identityId === undefined || planId === undefined) return true;
      if (role === "host") return !accountAnswered(identityId, planId);
      return owners.get(`host|${planId}`) !== identityId && !accountAnswered(identityId, planId);
    });
  };
  const countClaims = (keys: string[]) => {
    const count = (role: string) => keys.filter((key) => key.split("|")[1] === role).length;
    return { plans: count("host"), responses: count("manage"), templates: count("template") };
  };
  const deleteTemplate = (id: string) => {
    templates.delete(id);
    owners.delete(`template|${id}`);
    for (const key of links) if (key.endsWith(`|template|${id}`)) links.delete(key);
  };
  /** Stores a template and links the plan's host devices, like the SQLite adapter. */
  const insertTemplate = ({
    template,
    hostTokenHash,
    route,
    hostsOfPlan,
    creationNonce,
    ownerIdentityId,
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
    const planOwner = ownerIdentityId ?? owners.get(`host|${hostsOfPlan}`);
    if (planOwner !== undefined) owners.set(`template|${template.id}`, planOwner);
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
    owners.delete(`host|${id}`);
    routes.delete(id);
    deleteContributions((c) => c.planId === id);
    for (const [responseId, rating] of ratings)
      if (rating.planId === id) ratings.delete(responseId);
    for (const [reportId, report] of reports) if (report.planId === id) reports.delete(reportId);
    previews.delete(id);
    for (const [nonce, planId] of planNonces) if (planId === id) planNonces.delete(nonce);
    for (const [responseId, entry] of responses) {
      if (entry.response.planId !== id) continue;
      responses.delete(responseId);
      owners.delete(`manage|${responseId}`);
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
      async create({ plan, hostTokenHash, creationNonce, hostDeviceId, ownerIdentityId, route }) {
        if (plans.has(plan.id) || planNonces.has(creationNonce)) throw new Error("duplicate key");
        if (route !== undefined) routes.set(plan.id, structuredClone(route));
        plans.set(plan.id, { plan: structuredClone(plan), hostTokenHash });
        planNonces.set(creationNonce, plan.id);
        if (ownerIdentityId !== undefined) owners.set(`host|${plan.id}`, ownerIdentityId);
        else links.add(linkKey(hostDeviceId, { role: "host", planId: plan.id }));
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
      async ownerOf(planId) {
        return owners.get(`host|${planId}`);
      },
      async setHostTokenHash(planId, hash) {
        const entry = plans.get(planId);
        if (entry !== undefined) entry.hostTokenHash = hash;
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
      findPublicIn(box, window, page) {
        const found = activeWhere(
          (plan) =>
            plan.visibility === "public" &&
            plan.area.point !== undefined &&
            inBox(box, plan.area.point) &&
            (page.activity === undefined || plan.activity === page.activity) &&
            plan.startsAt >= window.from &&
            plan.startsAt < window.to,
        );
        return Promise.resolve(
          found
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
            .slice(page.offset, page.offset + page.limit),
        );
      },
      async findActiveDeletingBetween(from, to) {
        return activeWhere((plan) => plan.deleteAt >= from && plan.deleteAt <= to);
      },
      async findLinkedToDevice(deviceId, scope) {
        const linked: LinkedPlan[] = [];
        for (const key of access(deviceId, scope)) {
          const [, role, id = ""] = key.split("|");
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
                responseId: response.id,
                responseKind: response.kind,
              });
            }
          }
        }
        return linked.sort((a, b) => a.plan.startsAt.getTime() - b.plan.startsAt.getTime());
      },
      async findOwnedBy(identityId) {
        const linked: LinkedPlan[] = [];
        for (const [key, owner] of owners) {
          if (owner !== identityId) continue;
          const [role, id = ""] = key.split("|");
          if (role === "host") {
            const entry = plans.get(id);
            if (entry !== undefined)
              linked.push({ plan: structuredClone(entry.plan), role: "host" });
          } else if (role === "manage") {
            const response = responses.get(id)?.response;
            const entry = response && plans.get(response.planId);
            if (response !== undefined && entry !== undefined) {
              linked.push({
                plan: structuredClone(entry.plan),
                role: "manage",
                responseId: response.id,
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

    ratings: {
      async findByResponse(responseId) {
        return structuredClone(ratings.get(responseId));
      },
      async listByPlan(planId) {
        return [...ratings.values()]
          .filter((rating) => rating.planId === planId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
          .map((rating) => structuredClone(rating));
      },
      async save(rating) {
        const existing = ratings.get(rating.responseId);
        ratings.set(
          rating.responseId,
          structuredClone(
            existing === undefined
              ? rating
              : {
                  ...existing,
                  value: rating.value,
                  note: rating.note,
                  updatedAt: rating.updatedAt,
                },
          ),
        );
      },
      async deleteForResponse(responseId) {
        ratings.delete(responseId);
      },
    },

    reports: {
      async create(report) {
        reports.set(report.id, structuredClone(report));
      },
      async listOpen() {
        return [...reports.values()]
          .filter((report) => report.resolvedAt === undefined)
          .sort(byCreation)
          .flatMap((report) => {
            const plan = plans.get(report.planId)?.plan;
            return plan === undefined
              ? []
              : [{ planId: plan.id, planTitle: plan.title, reason: report.reason }];
          });
      },
      async listOpenForPlan(planId) {
        return [...reports.values()]
          .filter((report) => report.planId === planId && report.resolvedAt === undefined)
          .sort(byCreation)
          .map((report) => structuredClone(report));
      },
      async countResolvedForPlan(planId) {
        return [...reports.values()].filter(
          (report) => report.planId === planId && report.resolvedAt !== undefined,
        ).length;
      },
      async resolve(id, at) {
        const report = reports.get(id);
        if (report === undefined) return undefined;
        const wasOpen = report.resolvedAt === undefined;
        if (wasOpen) report.resolvedAt = at;
        return { planId: report.planId, wasOpen };
      },
    },

    invites: {
      async create(invite, tokenHash) {
        invites.set(invite.id, { invite: structuredClone(invite), tokenHash });
      },
      async findByTokenHash(hash) {
        const entry = [...invites.values()].find((e) => e.tokenHash === hash);
        return entry === undefined ? undefined : structuredClone(entry.invite);
      },
      async list() {
        return [...invites.values()]
          .map((e) => structuredClone(e.invite))
          .sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
          );
      },
      async revoke(id, at) {
        const entry = invites.get(id);
        if (entry === undefined) return false;
        entry.invite.revokedAt ??= at;
        return true;
      },
      async redeem({ inviteId, deviceId, now }) {
        if (mayPostOf(deviceId) !== undefined) return "already_allowed";
        const entry = invites.get(inviteId);
        if (entry === undefined || inviteState(entry.invite, now) !== "usable") return "unusable";
        entry.invite.uses++;
        const identityId = devices.get(deviceId)?.device.identityId;
        mayPost.set(
          identityId === undefined ? `device:${deviceId}` : `identity:${identityId}`,
          now,
        );
        return "granted";
      },
    },

    permissions: {
      async mayPostSince(deviceId) {
        return mayPostOf(deviceId);
      },
      async accountMayPostSince(identityId) {
        return mayPost.get(`identity:${identityId}`);
      },
      async deviceMayPostSince(deviceId) {
        return mayPost.get(`device:${deviceId}`);
      },
    },

    identities: {
      async create(identity, subjectHash) {
        identities.set(identity.id, { identity: structuredClone(identity), subjectHash });
      },
      async findBySubjectHash(provider, subjectHash) {
        const entry = [...identities.values()].find(
          (e) => e.identity.provider === provider && e.subjectHash === subjectHash,
        );
        return entry === undefined ? undefined : structuredClone(entry.identity);
      },
      async findById(id) {
        const entry = identities.get(id);
        return entry === undefined ? undefined : structuredClone(entry.identity);
      },
      async setDisplayName(id, displayName) {
        const entry = identities.get(id);
        if (entry !== undefined) entry.identity.displayName = displayName;
      },
      async setHandle(id, handle) {
        const entry = identities.get(id);
        if (entry !== undefined) entry.identity.handle = handle;
      },
      async touch(id, now) {
        const entry = identities.get(id);
        if (entry !== undefined) entry.identity.lastActiveAt = now;
      },
      async delete(id) {
        identities.delete(id);
        for (const [key, owner] of owners) if (owner === id) owners.delete(key);
        mayPost.delete(`identity:${id}`);
        for (const entry of devices.values()) {
          if (entry.device.identityId === id)
            entry.device = { ...entry.device, identityId: undefined };
        }
      },
      async listUnwarnedBefore(cutoff) {
        return [...identities.values()]
          .filter(
            (e) =>
              e.identity.lastActiveAt.getTime() < cutoff.getTime() &&
              (e.warnedAt === undefined ||
                e.warnedAt.getTime() < e.identity.lastActiveAt.getTime()),
          )
          .sort((a, b) => a.identity.lastActiveAt.getTime() - b.identity.lastActiveAt.getTime())
          .map((e) => structuredClone(e.identity));
      },
      async markExpiryWarned(id, now) {
        const entry = identities.get(id);
        if (entry !== undefined) entry.warnedAt = now;
      },
      async listUnusedBefore(cutoff) {
        return [...identities.values()]
          .filter((e) => e.identity.lastActiveAt.getTime() < cutoff.getTime())
          .sort((a, b) => a.identity.lastActiveAt.getTime() - b.identity.lastActiveAt.getTime())
          .map((e) => structuredClone(e.identity));
      },
      all: () => [...identities.values()].map((e) => structuredClone(e.identity)),
    },

    pendingLogins: {
      async create(stateHash, login) {
        pendingLogins.set(stateHash, structuredClone(login));
      },
      async take(stateHash) {
        const login = pendingLogins.get(stateHash);
        pendingLogins.delete(stateHash);
        return login;
      },
      async deleteStartedBefore(cutoff) {
        let deleted = 0;
        for (const [hash, login] of pendingLogins) {
          if (login.startedAt.getTime() < cutoff.getTime()) {
            pendingLogins.delete(hash);
            deleted++;
          }
        }
        return deleted;
      },
    },

    formNonces: {
      async claim(nonce, now) {
        if (usedNonces.has(nonce)) return false;
        usedNonces.set(nonce, now);
        return true;
      },
      async deleteUsedBefore(cutoff) {
        let deleted = 0;
        for (const [nonce, usedAt] of usedNonces) {
          if (usedAt.getTime() < cutoff.getTime()) {
            usedNonces.delete(nonce);
            deleted++;
          }
        }
        return deleted;
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
      async setHostTokenHash(templateId, hash) {
        const entry = templates.get(templateId);
        if (entry !== undefined) entry.hostTokenHash = hash;
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
      async listForDevice(deviceId, scope) {
        const keys = access(deviceId, scope);
        return [...templates.values()]
          .filter((e) =>
            keys.has(linkKey(deviceId, { role: "template", templateId: e.template.id })),
          )
          .map((e) => structuredClone(e.template))
          .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      },
      async listOwnedBy(identityId) {
        return [...templates.values()]
          .filter((e) => owners.get(`template|${e.template.id}`) === identityId)
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
        devices.set(id, { device: { id, lastSeenAt: now, identityId: undefined }, tokenHash });
      },
      async touch(id, now) {
        const entry = devices.get(id);
        if (entry !== undefined) entry.device = { ...entry.device, lastSeenAt: now };
        const account = entry?.device.identityId;
        if (account !== undefined) {
          const identity = identities.get(account);
          if (identity !== undefined) identity.identity.lastActiveAt = now;
        }
      },
      async link(deviceId, target) {
        links.add(linkKey(deviceId, target));
      },
      async hasLink(deviceId, target, scope) {
        return access(deviceId, scope).has(linkKey(deviceId, target));
      },
      async lastHostName(deviceId) {
        const named = (name: string) => (name.trim() === "" ? undefined : name);
        const linked = (role: string) =>
          [...links].flatMap((key) => {
            const [device, linkRole, id = ""] = key.split("|");
            return device === deviceId && linkRole === role ? [id] : [];
          });
        const byLatest = <T extends { at: Date; id: string }>(a: T, b: T) =>
          b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id);
        const hosted = linked("host")
          .flatMap((id) => {
            const plan = plans.get(id)?.plan;
            return plan === undefined ? [] : [{ id, at: plan.createdAt, name: plan.posterName }];
          })
          .sort(byLatest);
        const fromTemplates = linked("template")
          .flatMap((id) => {
            const template = templates.get(id)?.template;
            return template === undefined
              ? []
              : [{ id, at: template.updatedAt, name: template.posterName }];
          })
          .sort(byLatest);
        for (const entry of [...hosted, ...fromTemplates]) {
          const name = named(entry.name);
          if (name !== undefined) return name;
        }
        return undefined;
      },
      async claimable(deviceId) {
        return countClaims(claimableKeys(deviceId));
      },
      async claimInto(deviceId, identityId) {
        if (devices.get(deviceId)?.device.identityId !== identityId) return countClaims([]);
        const keys = claimableKeys(deviceId);
        const counts = countClaims(keys);
        for (const key of keys) {
          const [, role, id] = key.split("|");
          owners.set(`${role}|${id}`, identityId);
          links.delete(key);
        }
        return counts;
      },
      async replaceToken(deviceId, tokenHash) {
        const entry = devices.get(deviceId);
        if (entry !== undefined) entry.tokenHash = tokenHash;
      },
      async setIdentity(deviceId, identityId) {
        const entry = devices.get(deviceId);
        if (entry !== undefined) entry.device = { ...entry.device, identityId };
      },
      async delete(id) {
        devices.delete(id);
        feeds.delete(id);
        mayPost.delete(`device:${id}`);
        for (const key of links) if (key.startsWith(`${id}|`)) links.delete(key);
      },
      async unlinkOthers(target, keepDeviceId) {
        const suffix = `|${target.role}|${targetId(target)}`;
        if (!access(keepDeviceId).has(`${keepDeviceId}${suffix}`)) return 0;
        let removed = 0;
        for (const key of links) {
          if (key.endsWith(suffix) && !key.startsWith(`${keepDeviceId}|`)) {
            links.delete(key);
            removed++;
          }
        }
        return removed;
      },
      async deleteInactive({ unlinkedLastSeenBefore, anyLastSeenBefore }) {
        let deleted = 0;
        for (const [id, entry] of devices) {
          const seen = entry.device.lastSeenAt.getTime();
          const linked =
            [...links].some((key) => key.startsWith(`${id}|`)) ||
            mayPost.has(`device:${id}`) ||
            entry.device.identityId !== undefined;
          if (
            seen < anyLastSeenBefore.getTime() ||
            (!linked && seen < unlinkedLastSeenBefore.getTime())
          ) {
            devices.delete(id);
            feeds.delete(id);
            mayPost.delete(`device:${id}`);
            for (const key of links) if (key.startsWith(`${id}|`)) links.delete(key);
            deleted++;
          }
        }
        return deleted;
      },
      all: () => [...devices.values()].map((entry) => ({ ...entry.device })),
    },

    responses: {
      async createRemote({ response, actor, join, manageTokenHash }) {
        // One response per actor and plan, as the unique index says.
        if (
          responses.has(response.id) ||
          [...responses.values()].some(
            (entry) =>
              entry.response.planId === response.planId && entry.remote?.actor.id === actor.id,
          )
        ) {
          throw new Error("duplicate key");
        }
        responses.set(response.id, {
          response: copy(response),
          manageTokenHash,
          deviceId: undefined,
          remote: { actor: { ...actor }, join: { ...join } },
        });
      },
      async findRemote(planId, actorId) {
        const entry = [...responses.values()].find(
          (candidate) =>
            candidate.response.planId === planId && candidate.remote?.actor.id === actorId,
        );
        return entry?.remote === undefined
          ? undefined
          : { response: copy(entry.response), ...structuredClone(entry.remote) };
      },
      async remoteOf(responseId) {
        const remote = responses.get(responseId)?.remote;
        return remote === undefined ? undefined : structuredClone(remote);
      },
      async listRemote(planId) {
        return [...responses.values()].flatMap((entry) =>
          entry.response.planId === planId && entry.remote !== undefined
            ? [{ response: copy(entry.response), ...structuredClone(entry.remote) }]
            : [],
        );
      },
      async listByRemoteActor(actorId) {
        return [...responses.values()]
          .filter((entry) => entry.remote?.actor.id === actorId)
          .map((entry) => copy(entry.response));
      },
      async updateRemote({ response, actor, join }) {
        const entry = responses.get(response.id);
        if (entry?.remote === undefined) return;
        entry.response = copy(response);
        entry.remote = { actor: { ...actor }, join: { ...join } };
      },
      async create({ response, manageTokenHash, creationNonce, deviceId, identityId }) {
        if (responses.has(response.id) || responseNonces.has(creationNonce))
          throw new Error("duplicate key");
        responses.set(response.id, { response: copy(response), manageTokenHash, deviceId });
        responseNonces.set(creationNonce, response.id);
        if (identityId !== undefined) owners.set(`manage|${response.id}`, identityId);
        else if (deviceId !== undefined)
          links.add(linkKey(deviceId, { role: "manage", responseId: response.id }));
      },
      async findById(id) {
        const entry = responses.get(id);
        return entry === undefined ? undefined : copy(entry.response);
      },
      async setManageTokenHash(responseId, hash) {
        const entry = responses.get(responseId);
        if (entry !== undefined) entry.manageTokenHash = hash;
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
      async findForDevice(planId, deviceId, scope) {
        // The device's own response first, then the account's oldest (like SQLite).
        const reachable = [...responses.values()]
          .filter(
            (candidate) =>
              candidate.response.planId === planId &&
              access(deviceId, scope).has(
                linkKey(deviceId, { role: "manage", responseId: candidate.response.id }),
              ),
          )
          .sort(
            (a, b) =>
              Number(!links.has(linkKey(deviceId, { role: "manage", responseId: a.response.id }))) -
                Number(
                  !links.has(linkKey(deviceId, { role: "manage", responseId: b.response.id })),
                ) || a.response.createdAt.getTime() - b.response.createdAt.getTime(),
          );
        const [entry] = reachable;
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
        owners.delete(`manage|${id}`);
        ratings.delete(id);
        deleteContributions((c) => c.responseId === id);
        for (const key of links) if (key.endsWith(`|manage|${id}`)) links.delete(key);
      },
      async isBlocked(planId, deviceId) {
        const identityId = devices.get(deviceId)?.device.identityId;
        return [...responses.values()].some(
          (entry) =>
            entry.response.planId === planId &&
            (entry.deviceId === deviceId ||
              (identityId !== undefined &&
                owners.get(`manage|${entry.response.id}`) === identityId)) &&
            (entry.response.kind === "rejected" || entry.response.kind === "removed"),
        );
      },
    },

    recap: {
      async create(c) {
        contributions.set(c.id, structuredClone(c));
      },
      async createWithinLimit(c, max) {
        const count = [...contributions.values()].filter(
          (other) => other.planId === c.planId && other.responseId === c.responseId,
        ).length;
        if (count >= max) return false;
        contributions.set(c.id, structuredClone(c));
        return true;
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
          if (access(deviceId).size === 0) {
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
