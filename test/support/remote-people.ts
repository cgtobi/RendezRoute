// Remote fediverse people for tests of the inboxes: an actor document the fake serves, its own
// keys, signed posts to the shared inbox, and what the app delivered in return.
import { generateCryptoKeyPair, signRequest } from "@fedify/fedify";
import type { createTestApp } from "./app.ts";

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
export type Remote = { id: string; keys: Awaited<ReturnType<typeof generateCryptoKeyPair>> };

export const HOST = "runs.example.org";
export const INSTANCE = `https://${HOST}/actors/instance`;

export async function remotePerson(
  test: TestApp,
  name: string,
  server = "social.example",
  /** Keys made before, for suites with many people, where generating them is slow. */
  sharedKeys?: Remote["keys"],
) {
  const keys = sharedKeys ?? (await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"));
  const id = `https://${server}/users/${name}`;
  const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
  test.federationHttp.respond(id, {
    headers: { "content-type": "application/activity+json" },
    body: JSON.stringify({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id,
      type: "Person",
      preferredUsername: name,
      inbox: `https://${server}/users/${name}/inbox`,
      endpoints: { sharedInbox: `https://${server}/inbox` },
      publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
    }),
  });
  test.federationHttp.respond(`https://${server}/inbox`, { status: 202 });
  return { id, keys } satisfies Remote;
}

/** Posts an activity to the shared inbox, signed by `from` unless another signer is given. */
export async function post(
  test: TestApp,
  from: { id: string },
  activity: Record<string, unknown>,
  signer: Remote = from as Remote,
) {
  const json = JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    actor: from.id,
    ...activity,
  });
  const signed = await signRequest(
    new Request(`https://${HOST}/inbox`, {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body: json,
    }),
    signer.keys.privateKey,
    new URL(`${signer.id}#main-key`),
  );
  return test.app.request("/inbox", { method: "POST", headers: signed.headers, body: json });
}

export const joinOf = (from: { id: string }, planId: string, n = 1) => ({
  id: `${from.id}#join-${n}`,
  type: "Join",
  object: `https://${HOST}/p/${planId}`,
});

export const tentativeOf = (from: { id: string }, planId: string, n = 1) => ({
  id: `${from.id}#tentative-${n}`,
  type: "TentativeAccept",
  object: `https://${HOST}/p/${planId}`,
});

/** What the app delivered, with the activity parsed. */
export const delivered = (test: TestApp) =>
  test.federationHttp.posts.map((sent) => ({
    url: sent.url.href,
    headers: sent.headers,
    activity: JSON.parse(new TextDecoder().decode(sent.body)) as Record<string, unknown>,
  }));

/**
 * Whether an activity is about a private Note: its object is the Note, or the Tombstone of one.
 * By the object, not by a substring anywhere in the activity, so an `Event` update that wrongly
 * carried a Note address is still checked like any other.
 */
export function isNoteActivity(activity: Record<string, unknown>): boolean {
  const object = activity.object as { type?: unknown; id?: unknown } | string | undefined;
  if (typeof object !== "object" || object === null) return false;
  return (
    object.type === "Note" ||
    (typeof object.id === "string" && new URL(object.id).pathname.startsWith("/notes/"))
  );
}

export const rows = (test: TestApp, table: string) =>
  JSON.stringify(test.database.sqlite.prepare(`select * from ${table}`).all());

/** What a fake fediverse account serves: WebFinger, the actor, and its two inboxes. */
export interface FediverseAccountOptions {
  /** What WebFinger names as the actor; the actor's own address by default. */
  href?: string;
  /** The `id` the actor document claims. */
  id?: string;
  inbox?: string;
  sharedInbox?: string;
  preferredUsername?: string;
  /** The WebFinger status; anything but 200 serves no body. */
  fingerStatus?: number;
  /** The actor document's status. */
  actorStatus?: number;
  fingerBody?: string;
  actorBody?: string;
}

/**
 * Serves `@name@server` as a Mastodon would: WebFinger at the server, the actor under /users, its
 * own inbox and a shared one. Returns the addresses, for assertions.
 */
export function serveFediverseAccount(
  test: Pick<TestApp, "federationHttp">,
  name: string,
  server = "social.example",
  options: FediverseAccountOptions = {},
) {
  const actorId = `https://${server}/users/${name}`;
  const inbox = options.inbox ?? `${actorId}/inbox`;
  const sharedInbox = options.sharedInbox ?? `https://${server}/inbox`;
  test.federationHttp.respond(`https://${server}/.well-known/webfinger`, {
    status: options.fingerStatus ?? 200,
    headers: { "content-type": "application/jrd+json" },
    body:
      options.fingerBody ??
      JSON.stringify({
        subject: `acct:${name}@${server}`,
        links: [
          { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: actorId },
          { rel: "self", type: "application/activity+json", href: options.href ?? actorId },
        ],
      }),
  });
  test.federationHttp.respond(actorId, {
    status: options.actorStatus ?? 200,
    headers: { "content-type": "application/activity+json" },
    body:
      options.actorBody ??
      JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: options.id ?? actorId,
        type: "Person",
        preferredUsername: options.preferredUsername ?? name,
        inbox,
        endpoints: { sharedInbox },
      }),
  });
  // Both accept a delivery; the tests look at which one got it.
  test.federationHttp.respond(`${actorId}/inbox`, { status: 202 });
  test.federationHttp.respond(sharedInbox, { status: 202 });
  return { actorId, inbox: `${actorId}/inbox`, sharedInbox };
}
