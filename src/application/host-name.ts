// The name the plan form suggests to a host (D67, I83). Read-only: it follows links that already
// exist, creates no device and sets no cookie.
import { lookupDevice, type DeviceDeps } from "./devices.ts";

/**
 * The account's display name, else the poster name of the device's latest hosted plan, else of
 * its latest template; undefined for a device with none or an unknown token. A response's display
 * name is never used: it belongs to the participant.
 */
export async function suggestHostName(
  deps: DeviceDeps,
  request: { deviceToken: string | undefined; accountName?: string | undefined },
): Promise<string | undefined> {
  const accountName = request.accountName?.trim();
  if (accountName !== undefined && accountName !== "") return request.accountName;
  const device = await lookupDevice(deps, request.deviceToken);
  return device === undefined ? undefined : deps.devices.lastHostName(device.id);
}
