// Device identity from the device cookie (spec 3.2). A device is created only when
// something is linked to it (decision P2).
import type { Clock, Device, DeviceRepository, IdGenerator, TokenService } from "./ports.ts";

export interface DeviceDeps {
  devices: DeviceRepository;
  tokens: TokenService;
  ids: IdGenerator;
  clock: Clock;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The device for a cookie token, if any, without any write (for GETs that must not change state). */
export async function lookupDevice(
  deps: DeviceDeps,
  token: string | undefined,
): Promise<Device | undefined> {
  if (token === undefined || token === "") return undefined;
  return deps.devices.findByTokenHash(deps.tokens.hash(token));
}

/** The device for a cookie token, if any. Updates last_seen_at at most once per day (spec 3.2). */
export async function resolveDevice(
  deps: DeviceDeps,
  token: string | undefined,
): Promise<Device | undefined> {
  const device = await lookupDevice(deps, token);
  if (device === undefined) return undefined;
  const now = deps.clock.now();
  if (now.getTime() - device.lastSeenAt.getTime() >= DAY_MS) {
    await deps.devices.touch(device.id, now);
    return { ...device, lastSeenAt: now };
  }
  return device;
}

/** The existing device, or a new one whose token the caller must set as the device cookie. */
export async function ensureDevice(
  deps: DeviceDeps,
  token: string | undefined,
): Promise<{ device: Device; newToken: string | undefined }> {
  const existing = await resolveDevice(deps, token);
  if (existing !== undefined) return { device: existing, newToken: undefined };

  const newToken = deps.tokens.generate();
  const device: Device = {
    id: deps.ids.rowId(),
    lastSeenAt: deps.clock.now(),
    identityId: undefined,
  };
  await deps.devices.create({
    id: device.id,
    tokenHash: deps.tokens.hash(newToken),
    now: device.lastSeenAt,
  });
  return { device, newToken };
}
