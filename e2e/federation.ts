// What the federation specs share (plan v1.0 step 13b): talking to the fake fediverse server from
// the Node side (fakes/fediverse.ts), reading what it recorded, and waiting for the job runner,
// which delivers every 10 seconds.
import { expect } from "@playwright/test";

const FAKES = "http://localhost:8080";
/** Where the browser reaches the fakes (it maps `fakes` to the local machine). */
export const FAKES_HOST = "http://fakes:8080";
/** The app's public address (BASE_URL of the accounts container). */
export const APP = "http://localhost:3103";
/** The address of the instance actor, which remote people reply and report to. */
export const INSTANCE = `${APP}/actors/instance`;

export interface Activity {
  type?: string;
  id?: string;
  to?: unknown;
  cc?: unknown;
  object?:
    | {
        type?: string;
        id?: string;
        name?: string;
        content?: string;
        inReplyTo?: unknown;
        to?: unknown;
        cc?: unknown;
        tag?: unknown;
      }
    | string;
}
export interface Received {
  inbox: string | null;
  headers: Record<string, string | string[] | undefined>;
  activity: Activity;
}

/** A fetch to the fakes that fails clearly when the fake is down or slow. */
export async function fake(path: string, init?: RequestInit): Promise<Response> {
  const answer = await fetch(`${FAKES}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!answer.ok) throw new Error(`fakes ${path} answered ${answer.status}`);
  return answer;
}

/** Append-only. */
export const received = async (to: string): Promise<Received[]> => {
  return (await (await fake(`/fedi/received?to=${to}`)).json()) as Received[];
};

/** Every delivery from the app is signed and carries a digest; a missing header fails by name. */
export const expectSigned = (entries: Received[]) => {
  for (const entry of entries) {
    expect(entry.headers.signature, `signature on ${entry.activity.id}`).toBeTruthy();
    expect(entry.headers.digest, `digest on ${entry.activity.id}`).toBeTruthy();
  }
};

/**
 * Polls the fake's inbox (the job runner delivers every 10 seconds) for a matching activity.
 * `after` skips what was there before: a kept container holds earlier runs' deliveries.
 */
export async function waitFor(
  to: string,
  match: (activity: Activity) => boolean,
  after = 0,
): Promise<Activity> {
  let found: Received | undefined;
  await expect
    .poll(
      async () => {
        found = (await received(to)).slice(after).find((entry) => match(entry.activity));
        return found !== undefined;
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBe(true);
  if (found === undefined) throw new Error(`no matching activity for ${to}`);
  expectSigned([found]);
  return found.activity;
}

/** The address of an activity's object, whether it is embedded or a bare address. */
export const objectId = (activity: Activity) =>
  typeof activity.object === "string" ? activity.object : activity.object?.id;

/** A `to` that may be one address or a list, as a list. */
export const addresses = (value: unknown): string[] =>
  Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];

/** Has the fake person sign an activity and post it to the app; returns the app's answer. */
export async function send(
  as: string,
  path: string,
  activity: Record<string, unknown>,
  app: "default" | "clock" = "default",
) {
  const answer = await fake("/fedi/send", {
    method: "POST",
    body: JSON.stringify({ as, path, activity, app }),
  });
  return (await answer.json()) as { status: number; body: string };
}

/** The recipients of an activity and of its object, whatever way they were written. */
export const recipientsOf = (activity: Activity) => {
  const object = typeof activity.object === "object" ? activity.object : undefined;
  return [
    ...addresses(activity.to),
    ...addresses(activity.cc),
    ...addresses(object?.to),
    ...addresses(object?.cc),
  ];
};
