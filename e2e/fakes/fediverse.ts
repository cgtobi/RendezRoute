// A fake fediverse server for end-to-end tests (plan v1.0 step 13b, decision D50): remote people
// on this server (`http://fakes:8080/fedi/users/<name>`, made on first use, each with RSA keys of
// its own), their actor documents and WebFinger, and inboxes that record every activity the app
// delivers. The spec drives the people from the Node side: POST /fedi/send signs an activity as a
// person (draft-cavage HTTP signatures, node:crypto only, the headers Fedify's own signRequest
// sends) and posts it to the app container, which the fakes container reaches as
// `app-accounts:3000` while the app's BASE_URL stays `http://localhost:3103`. A spec may name the
// other accounts container, the one with the controllable clock (`app: "clock"`, decision D87).
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

const ORIGIN = "http://fakes:8080";
/** The app containers a person may post to: where the fakes reach it, and its public Host. */
const APPS = {
  default: {
    url: new URL(process.env.APP_ACCOUNTS_URL ?? "http://app-accounts:3000"),
    host: process.env.HOST_HEADER ?? "localhost:3103",
  },
  clock: { url: new URL("http://app-clock-accounts:3000"), host: "localhost:3109" },
};
type AppName = keyof typeof APPS;
const CONTEXT = ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"];

interface Person {
  id: string;
  privateKey: string;
  publicKey: string;
}

interface Received {
  /** The person's own inbox, or null for the shared inbox. */
  inbox: string | null;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  activity: unknown;
}

const people = new Map<string, Person>();
const received: Received[] = [];

const json = (
  response: ServerResponse,
  status: number,
  value: unknown,
  type = "application/json",
) => {
  response.writeHead(status, { "content-type": type });
  response.end(JSON.stringify(value));
};

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The person of this name; the keys are made the first time anyone asks. */
function personOf(name: string): Person {
  let person = people.get(name);
  if (person === undefined) {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    person = {
      id: `${ORIGIN}/fedi/users/${name}`,
      privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    people.set(name, person);
  }
  return person;
}

/** The headers of a POST signed like Fedify's signRequest: draft-cavage, rsa-sha256. */
function signedHeaders(
  person: Person,
  path: string,
  payload: string,
  host: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/activity+json",
    date: new Date().toUTCString(),
    digest: `SHA-256=${createHash("sha256").update(payload).digest("base64")}`,
    host,
  };
  const names = ["content-type", "date", "digest", "host"];
  const text = [
    `(request-target): post ${path}`,
    ...names.map((name) => `${name}: ${headers[name]}`),
  ].join("\n");
  const signature = createSign("RSA-SHA256").update(text).sign(person.privateKey, "base64");
  headers.signature = `keyId="${person.id}#main-key",algorithm="rsa-sha256",headers="(request-target) ${names.join(" ")}",signature="${signature}"`;
  return headers;
}

/** Posts to the app container with the Host header of its public address. */
function postToApp(
  app: { url: URL },
  path: string,
  headers: Record<string, string>,
  payload: string,
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpRequest(
      { host: app.url.hostname, port: app.url.port, path, method: "POST", headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

export async function handleFediverse(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  if (path === "/.well-known/webfinger") {
    const match = /^acct:([a-z0-9_-]+)@fakes:8080$/.exec(url.searchParams.get("resource") ?? "");
    if (match?.[1] === undefined) {
      response.writeHead(404).end();
      return true;
    }
    const person = personOf(match[1]);
    json(
      response,
      200,
      {
        subject: `acct:${match[1]}@fakes:8080`,
        links: [{ rel: "self", type: "application/activity+json", href: person.id }],
      },
      "application/jrd+json",
    );
    return true;
  }
  const actor = /^\/fedi\/users\/([a-z0-9_-]+)$/.exec(path);
  if (actor?.[1] !== undefined) {
    const person = personOf(actor[1]);
    json(
      response,
      200,
      {
        "@context": CONTEXT,
        id: person.id,
        type: "Person",
        preferredUsername: actor[1],
        inbox: `${person.id}/inbox`,
        endpoints: { sharedInbox: `${ORIGIN}/fedi/inbox` },
        publicKey: {
          id: `${person.id}#main-key`,
          owner: person.id,
          publicKeyPem: person.publicKey,
        },
      },
      "application/activity+json",
    );
    return true;
  }
  const inbox = /^\/fedi\/(?:users\/([a-z0-9_-]+)\/)?inbox$/.exec(path);
  if (inbox !== null && request.method === "POST") {
    received.push({
      inbox: inbox[1] ?? null,
      path,
      headers: request.headers,
      activity: JSON.parse(await body(request)),
    });
    response.writeHead(202).end();
    return true;
  }
  if (path === "/fedi/received" && request.method === "GET") {
    // For one person: their own inbox and the shared one, which cannot tell who it was for.
    const to = url.searchParams.get("to");
    json(
      response,
      200,
      received.filter((entry) => to === null || entry.inbox === null || entry.inbox === to),
    );
    return true;
  }
  if (path === "/fedi/received" && request.method === "DELETE") {
    received.length = 0;
    response.writeHead(204).end();
    return true;
  }
  if (path === "/fedi/send" && request.method === "POST") {
    const send = JSON.parse(await body(request)) as {
      as: string;
      path: string;
      activity: Record<string, unknown>;
      app?: AppName;
    };
    const appName = send.app ?? "default";
    if (!Object.hasOwn(APPS, appName)) {
      json(response, 400, { error: `unknown app "${appName}"` });
      return true;
    }
    const app = APPS[appName];
    const person = personOf(send.as);
    const payload = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      actor: person.id,
      ...send.activity,
    });
    json(
      response,
      200,
      await postToApp(app, send.path, signedHeaders(person, send.path, payload, app.host), payload),
    );
    return true;
  }
  return false;
}
