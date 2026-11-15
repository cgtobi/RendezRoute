// The Home Assistant Supervisor's version (decision D56): `GET /supervisor/info`. The Supervisor
// is trusted configuration on the internal app network, so it is reached in one of two ways, both
// fail closed (timeout, size limit, no redirect, a status other than 200 is an error):
//   - over TCP at SUPERVISOR_URL with the app's SUPERVISOR_TOKEN (plain http on a private address,
//     which OutboundHttp's SSRF guard would refuse by design; the trusted fetch (D23) is the fit);
//   - over the unix socket the Supervisor mounts into the app (SUPERVISOR_SOCKET; the socket itself
//     identifies the app, a token is never sent). Decision D57: the TCP token is being deprecated.
// Either way the app's config.yaml needs `hassio_api: true`; the default role may call /*/info.
import { request } from "node:http";
import type { SupervisorInfo } from "../../../application/ports.ts";
import { createTrustedFetch } from "../http/trusted-fetch.ts";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 64 * 1024;

export type SupervisorEndpoint =
  | { url: URL; token: string; socketPath?: undefined }
  | { socketPath: string; url?: undefined; token?: undefined };

/**
 * The Supervisor's socket could not be connected (missing, refused, not permitted, reset or timed
 * out before the connect). `unreachable` lets the start step tell it from any answer, however bad
 * (decision I79); the message is the usual one and carries no secret.
 */
export class SupervisorUnreachableError extends Error {
  readonly unreachable = true;
}

function failure(error: unknown): Error {
  // fetch only says "fetch failed"; the cause's code (ENOTFOUND, ECONNREFUSED, ETIMEDOUT) tells
  // the owner what to fix. Never the request: it may carry the token.
  const direct = (error as { code?: unknown } | null)?.code;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code ?? direct;
  const message = error instanceof Error ? error.message : "request failed";
  // Socket errors already name the code ("connect ENOENT /path"); fetch's do not.
  return new Error(
    typeof code === "string" && !message.includes(code) ? `${message}, ${code}` : message,
  );
}

function overSocket(
  socketPath: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    // Set once the connection is up: an error or a timeout before that is "unreachable", one after
    // it is the Supervisor's (or the network's) own answer.
    let connected = false;
    const req = request(
      {
        socketPath,
        path: "/supervisor/info",
        method: "GET",
        // No shared agent and no keep-alive: a pooled connection to the root-only socket must not
        // outlive the privilege drop.
        agent: false,
        headers: {
          host: "supervisor",
          accept: "application/json",
          "user-agent": "RendezRoute",
          connection: "close",
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const length = Number(response.headers["content-length"] ?? "0");
        if (length > MAX_BYTES) {
          response.destroy();
          reject(new Error("Response too large."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_BYTES) {
            response.destroy();
            reject(new Error("Response too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
        response.on("error", (error) => reject(failure(error)));
      },
    );
    req.on("socket", (socket) => {
      if (socket.connecting) socket.once("connect", () => (connected = true));
      else connected = true;
    });
    req.on("error", (error) => {
      const cause = failure(error);
      reject(connected ? cause : new SupervisorUnreachableError(cause.message));
    });
    req.end();
  });
}

export function createSupervisorInfo({
  timeoutMs = TIMEOUT_MS,
  ...endpoint
}: SupervisorEndpoint & { timeoutMs?: number }): SupervisorInfo {
  const trustedFetch = createTrustedFetch({
    userAgent: "RendezRoute",
    allowHttp: true,
    timeoutMs,
    maxBytes: MAX_BYTES,
  });
  async function answer(): Promise<{ status: number; text: () => Promise<string> }> {
    if (endpoint.socketPath !== undefined) {
      const { status, body } = await overSocket(endpoint.socketPath, timeoutMs);
      return { status, text: async () => body };
    }
    const response = await trustedFetch(new URL("/supervisor/info", endpoint.url).href, {
      headers: { authorization: `Bearer ${endpoint.token}`, accept: "application/json" },
    }).catch((error: unknown) => {
      throw failure(error);
    });
    return { status: response.status, text: () => response.text() };
  }
  return {
    async version() {
      const response = await answer();
      if (response.status !== 200)
        throw new Error(`the Supervisor answered HTTP ${response.status}`);
      const body: unknown = await response
        .text()
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined);
      const data = (body as { data?: { version?: unknown } | null } | null | undefined)?.data;
      const version = data?.version;
      if (typeof version !== "string") throw new Error("the Supervisor's answer has no version");
      return version;
    },
  };
}
