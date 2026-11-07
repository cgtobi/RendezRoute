// Outbound HTTP with SSRF protection (spec 3.11): private, loopback, link-local and
// metadata addresses are refused after DNS resolution, for IP literals and on every
// redirect hop. The check runs inside the socket's DNS lookup, so the address that
// was checked is the address that is connected to (no DNS rebinding window).
import { type LookupAddress, promises as dnsPromises } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";
import type { OutboundHttp, OutboundResponse } from "../../../application/ports.ts";

export class OutboundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutboundError";
  }
}

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

function ipv6Bytes(address: string): number[] | undefined {
  let text = address;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1] !== undefined) {
    tail.push(...dotted[1].split(".").map(Number));
    text = `${text.slice(0, -dotted[1].length)}0:0`;
  }
  const [head = "", rest] = text.split("::");
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = groups(head);
  const right = rest === undefined ? [] : groups(rest);
  const all = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (all.length !== 8) return undefined;
  const bytes = all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** IPv4 embedded in IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96) or 6to4 (2002::/16) addresses. */
function embeddedV4(address: string): string | undefined {
  const b = ipv6Bytes(address);
  if (b === undefined) return undefined;
  const isMapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  const isNat64 =
    b[0] === 0x00 &&
    b[1] === 0x64 &&
    b[2] === 0xff &&
    b[3] === 0x9b &&
    b.slice(4, 12).every((x) => x === 0);
  if (isMapped || isNat64) return b.slice(12, 16).join(".");
  if (b[0] === 0x20 && b[1] === 0x02) return b.slice(2, 6).join(".");
  return undefined;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blockedV4.check(address, "ipv4");
  if (version === 6) {
    const v4 = embeddedV4(address);
    if (v4 !== undefined && blockedV4.check(v4, "ipv4")) return true;
    return blockedV6.check(address, "ipv6");
  }
  return true;
}

export interface OutboundHttpOptions {
  userAgent: string;
  /** Plain http is accepted only in development (ALLOW_INSECURE_DEV). */
  allowHttp?: boolean;
  /** Address policy; defaults to isBlockedAddress. Development may allow private networks. */
  isBlocked?: (address: string) => boolean;
  /** Name resolution; defaults to the system resolver. Results always pass the address policy. */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

export function createOutboundHttp(options: OutboundHttpOptions): OutboundHttp {
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const resolve =
    options.resolve ?? ((hostname: string) => dnsPromises.lookup(hostname, { all: true }));

  const guardedLookup = (
    hostname: string,
    lookupOptions: { all?: boolean; family?: number },
    callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    const done = (error: Error | null, addresses: LookupAddress[]) => {
      if (error !== null) return callback(error, []);
      if (addresses.length === 0 || addresses.some((entry) => isBlocked(entry.address))) {
        return callback(
          new OutboundError(`Request blocked: ${hostname} resolves to a forbidden address.`),
          [],
        );
      }
      if (lookupOptions.all === true) return callback(null, addresses);
      const [first] = addresses as [LookupAddress];
      return callback(null, first.address, first.family);
    };
    resolve(hostname).then(
      (addresses) => done(null, addresses),
      (error: unknown) => done(error instanceof Error ? error : new Error(String(error)), []),
    );
  };

  const agent = new Agent({ connect: { lookup: guardedLookup as never } });

  const checkUrl = (url: URL): void => {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && options.allowHttp === true)) {
      throw new OutboundError(`Only https URLs are allowed, got ${url.protocol}`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) !== 0 && isBlocked(host)) {
      throw new OutboundError("Request blocked: forbidden address.");
    }
  };

  return {
    async get(initialUrl, { headers = {}, maxBytes, timeoutMs } = {}): Promise<OutboundResponse> {
      const limit = maxBytes ?? options.maxBytes ?? DEFAULT_MAX_BYTES;
      const signal = AbortSignal.timeout(timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
      let url = initialUrl;

      try {
        for (let hop = 0; ; hop++) {
          checkUrl(url);
          const response = await fetch(url, {
            dispatcher: agent,
            redirect: "manual",
            signal,
            headers: { ...headers, "user-agent": options.userAgent },
          });

          const location = response.headers.get("location");
          if (response.status >= 300 && response.status < 400 && location !== null) {
            await response.body?.cancel();
            if (hop >= maxRedirects)
              throw new OutboundError(`Too many redirects (more than ${maxRedirects}).`);
            url = new URL(location, url);
            continue;
          }

          const declared = Number(response.headers.get("content-length") ?? 0);
          if (declared > limit) {
            await response.body?.cancel();
            throw new OutboundError(`Response too large (${declared} bytes, limit ${limit}).`);
          }

          const chunks: Uint8Array[] = [];
          let total = 0;
          if (response.body !== null) {
            for await (const chunk of response.body) {
              total += chunk.byteLength;
              if (total > limit)
                throw new OutboundError(`Response too large (limit ${limit} bytes).`);
              chunks.push(chunk);
            }
          }

          return {
            status: response.status,
            url,
            headers: Object.fromEntries(response.headers),
            body: Buffer.concat(chunks),
          };
        }
      } catch (error) {
        if (error instanceof OutboundError) throw error;
        if (signal.aborted) throw new OutboundError("Request timed out.", { cause: error });
        const cause = (error as { cause?: unknown }).cause;
        if (cause instanceof OutboundError) throw cause;
        throw new OutboundError("Request failed.", { cause: error });
      }
    },
  };
}
