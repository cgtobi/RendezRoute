// Fetch for services the instance owner configured, such as the OIDC issuer (decision D23): unlike
// OutboundHttp it may reach private addresses (a Keycloak or Authelia on the local network), but
// keeps the timeout, the size limit and HTTPS (plain http only in development), and never follows
// redirects.
export interface TrustedFetchOptions {
  userAgent: string;
  allowHttp: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

export type TrustedFetch = (
  url: string,
  init: {
    method?: string;
    headers?: Readonly<Record<string, string>> | Headers;
    body?: string | Uint8Array | URLSearchParams | ArrayBuffer | null | undefined;
    signal?: AbortSignal | null | undefined;
  },
) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export class TrustedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustedFetchError";
  }
}

export function createTrustedFetch(options: TrustedFetchOptions): TrustedFetch {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return async (url, init) => {
    const protocol = new URL(url).protocol;
    if (protocol !== "https:" && !(protocol === "http:" && options.allowHttp)) {
      throw new TrustedFetchError(`Only https URLs are allowed, got ${protocol}`);
    }
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers = new Headers(init.headers);
    headers.set("user-agent", options.userAgent);
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body ?? null,
      redirect: "manual",
      signal:
        init.signal === null || init.signal === undefined
          ? timeout
          : AbortSignal.any([init.signal, timeout]),
    });
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maxBytes) {
      await response.body?.cancel();
      throw new TrustedFetchError("Response too large.");
    }
    const body = await readLimited(response, maxBytes);
    // Statuses that carry no body cannot be given one, not even an empty one.
    const bodiless = [101, 204, 205, 304].includes(response.status);
    return new Response(bodiless ? null : body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TrustedFetchError("Response too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
