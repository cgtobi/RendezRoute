// The Home Assistant Supervisor's version (decision D56): `GET /supervisor/info` with the app's
// SUPERVISOR_TOKEN. The Supervisor is trusted configuration on the internal app network, a private
// address and plain http, so OutboundHttp's SSRF guard would refuse it by design; the trusted
// fetch (D23) is the fit: only the configured SUPERVISOR_URL is ever called, redirects are not
// followed, and the timeout and the size limit apply.
import type { SupervisorInfo } from "../../../application/ports.ts";
import { createTrustedFetch } from "../http/trusted-fetch.ts";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 64 * 1024;

export function createSupervisorInfo({
  url,
  token,
  timeoutMs = TIMEOUT_MS,
}: {
  url: URL;
  token: string;
  timeoutMs?: number;
}): SupervisorInfo {
  const trustedFetch = createTrustedFetch({
    userAgent: "RendezRoute",
    allowHttp: true,
    timeoutMs,
    maxBytes: MAX_BYTES,
  });
  return {
    async version() {
      const response = await trustedFetch(new URL("/supervisor/info", url).href, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      }).catch((error: unknown) => {
        // fetch only says "fetch failed"; the cause's code (ENOTFOUND, ECONNREFUSED, ETIMEDOUT)
        // tells the owner what to fix. Never the request: it carries the token.
        const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
        const message = error instanceof Error ? error.message : "request failed";
        throw new Error(typeof code === "string" ? `${message}, ${code}` : message);
      });
      if (response.status !== 200)
        throw new Error(`the Supervisor answered HTTP ${response.status}`);
      const body: unknown = await response.json().catch(() => undefined);
      const data = (body as { data?: { version?: unknown } | null } | null | undefined)?.data;
      const version = data?.version;
      if (typeof version !== "string") throw new Error("the Supervisor's answer has no version");
      return version;
    },
  };
}
