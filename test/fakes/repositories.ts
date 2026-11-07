import type { Device, DeviceRepository, PlanRepository } from "../../src/application/ports.ts";
import type { Plan } from "../../src/domain/plan.ts";

/** In-memory plan and device repositories sharing one store, like the SQLite adapters share a database. */
export function createFakeRepositories(): {
  plans: PlanRepository;
  devices: DeviceRepository & { all(): Device[] };
} {
  const plans = new Map<string, { plan: Plan; hostTokenHash: string }>();
  const nonces = new Map<string, string>();
  const devices = new Map<string, { device: Device; tokenHash: string }>();
  const hostLinks = new Set<string>();
  const linkKey = (deviceId: string, planId: string) => `${deviceId}|${planId}`;

  return {
    plans: {
      async create({ plan, hostTokenHash, creationNonce, hostDeviceId }) {
        if (plans.has(plan.id) || nonces.has(creationNonce)) throw new Error("duplicate key");
        plans.set(plan.id, { plan: structuredClone(plan), hostTokenHash });
        nonces.set(creationNonce, plan.id);
        hostLinks.add(linkKey(hostDeviceId, plan.id));
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
        return nonces.get(nonce);
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
      async linkHost(deviceId, planId) {
        hostLinks.add(linkKey(deviceId, planId));
      },
      async isHost(deviceId, planId) {
        return hostLinks.has(linkKey(deviceId, planId));
      },
      all: () => [...devices.values()].map((entry) => ({ ...entry.device })),
    },
  };
}
