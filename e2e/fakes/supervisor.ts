// A fake Home Assistant Supervisor (0.10 step 10b, decision D56): its info API for the app's
// start-up version check, and a minimal Ingress proxy that reaches the app's admin listener from
// this container's address (the app trusts only that one, ADMIN_INGRESS_PEER in compose.yaml).
//
//   /supervisor/info                 version 2026.10.4, for the bearer token the app was given
//   /ingress/e2e/<path>              as an administrator's browser session (system-admin)
//   /ingress/e2e-user/<path>         as a signed-in user who is no administrator
//
// Like the real Supervisor behind Core it strips every identity header the browser sent in any
// letter case and sets its own, forwards the rest (Cookie, Origin and Host included) and passes
// the app's answer on untouched, except that Core adds `Referrer-Policy: no-referrer` (so form
// posts carry `Origin: null`) and `X-Frame-Options: SAMEORIGIN`.
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

const SUPERVISOR_TOKEN = "e2e-supervisor-token";
const TARGET = new URL(`http://${process.env.INGRESS_TARGET ?? "app-admin-ingress:3001"}`);
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te"]);
const PEOPLE: Record<string, { groups: string }> = {
  e2e: { groups: "system-users,system-admin" },
  "e2e-user": { groups: "system-users" },
};

export function handleSupervisor(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname === "/supervisor/info") {
    if (request.headers.authorization !== `Bearer ${SUPERVISOR_TOKEN}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ result: "error", message: "Unauthorized" }));
      return true;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result: "ok", data: { version: "2026.10.4" } }));
    return true;
  }
  const match = /^\/ingress\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (match === null) return false;
  const person = PEOPLE[match[1] ?? ""];
  if (person === undefined) {
    response.writeHead(404).end();
    return true;
  }
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower.startsWith("x-remote-user-")) continue;
    // Core does not pass the browser's encodings on, so the app is not asked to compress.
    if (lower === "accept-encoding") continue;
    headers[name] = value;
  }
  headers["x-remote-user-id"] = "e2e-user-id";
  headers["x-remote-user-name"] = "e2e";
  headers["x-remote-user-display-name"] = "E2E";
  headers["x-remote-user-groups"] = person.groups;
  headers["x-ingress-path"] = `/ingress/${match[1]}`;
  const upstream = httpRequest(
    {
      host: TARGET.hostname,
      port: TARGET.port,
      path: `${match[2] ?? "/"}${url.search}`,
      method: request.method ?? "GET",
      headers,
    },
    (answer) => {
      const out = { ...answer.headers };
      out["referrer-policy"] = "no-referrer";
      out["x-frame-options"] = "SAMEORIGIN";
      response.writeHead(answer.statusCode ?? 502, out);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
  return true;
}
