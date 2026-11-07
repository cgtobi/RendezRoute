import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createOutboundHttp,
  isBlockedAddress,
  OutboundError,
  type OutboundHttpOptions,
} from "../../../src/adapters/out/http/outbound-http.ts";

describe("isBlockedAddress (spec 3.11 SSRF)", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:0001::1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "ff02::1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001::200e",
  ])("allows public address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

/** Test DNS: known names only, so no test depends on real resolution. */
function resolver(table: Record<string, string>) {
  return (hostname: string) => {
    const address = table[hostname];
    return address === undefined
      ? Promise.reject(new Error(`unknown test host ${hostname}`))
      : Promise.resolve([{ address, family: address.includes(":") ? 6 : 4 }]);
  };
}

describe("OutboundHttp", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  async function serve(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<{ port: number; hits: IncomingMessage[] }> {
    const hits: IncomingMessage[] = [];
    const server = createServer((req, res) => {
      hits.push(req);
      handler(req, res);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { port: (server.address() as AddressInfo).port, hits };
  }

  /** Test policy: the local test server (127.0.0.1) is reachable, 127.0.0.2 stands in for a forbidden target. */
  const testOptions: OutboundHttpOptions = {
    userAgent: "RendezRoute/test (+https://runs.example.org; owner@example.org)",
    allowHttp: true,
    isBlocked: (address) => address === "127.0.0.2",
    resolve: resolver({ "evil.test": "127.0.0.2", "fine.test": "127.0.0.1" }),
  };

  describe("with the production policy", () => {
    const http = createOutboundHttp({ userAgent: "RendezRoute/test", allowHttp: true });

    it.each(["127.0.0.1", "localhost", "[::1]"])(
      "blocks requests to %s before connecting",
      async (host) => {
        const { port, hits } = await serve((_, res) => res.end("secret"));
        await expect(http.get(new URL(`http://${host}:${port}/`))).rejects.toThrow(OutboundError);
        expect(hits).toHaveLength(0);
      },
    );
  });

  it("fetches allowed URLs with the identifying User-Agent", async () => {
    const { port, hits } = await serve((_, res) => res.end("hello"));
    const response = await createOutboundHttp(testOptions).get(
      new URL(`http://fine.test:${port}/path?q=1`),
    );

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("hello");
    expect(hits[0]?.headers["user-agent"]).toBe(testOptions.userAgent);
    expect(hits[0]?.url).toBe("/path?q=1");
  });

  it("re-checks every redirect hop, by IP literal and by DNS", async () => {
    for (const target of ["127.0.0.2", "evil.test"]) {
      const { port } = await serve((_, res) => {
        res.writeHead(302, { location: `http://${target}:${port}/internal` }).end();
      });
      await expect(
        createOutboundHttp(testOptions).get(new URL(`http://fine.test:${port}/`)),
      ).rejects.toThrow(/blocked/);
    }
  });

  it("follows allowed redirects up to a limit", async () => {
    const { port } = await serve((req, res) => {
      const hop = Number(new URL(req.url ?? "/", "http://x").searchParams.get("hop") ?? 0);
      if (hop < 3) res.writeHead(302, { location: `/?hop=${hop + 1}` }).end();
      else res.end(`arrived after ${hop}`);
    });
    const http = createOutboundHttp(testOptions);
    const response = await http.get(new URL(`http://fine.test:${port}/`));
    expect(new TextDecoder().decode(response.body)).toBe("arrived after 3");
    expect(response.url.searchParams.get("hop")).toBe("3");

    await expect(
      createOutboundHttp({ ...testOptions, maxRedirects: 2 }).get(
        new URL(`http://fine.test:${port}/`),
      ),
    ).rejects.toThrow(/redirects/);
  });

  it("enforces the size limit with and without Content-Length", async () => {
    const big = "x".repeat(2048);
    const declared = await serve((_, res) =>
      res.writeHead(200, { "content-length": String(big.length) }).end(big),
    );
    const chunked = await serve((_, res) => {
      res.write(big.slice(0, 1024));
      res.end(big.slice(1024));
    });
    const http = createOutboundHttp({ ...testOptions, maxBytes: 1000 });
    await expect(http.get(new URL(`http://fine.test:${declared.port}/`))).rejects.toThrow(
      /too large/,
    );
    await expect(http.get(new URL(`http://fine.test:${chunked.port}/`))).rejects.toThrow(
      /too large/,
    );
  });

  it("times out", async () => {
    const { port } = await serve(() => {
      /* never responds */
    });
    await expect(
      createOutboundHttp({ ...testOptions, timeoutMs: 200 }).get(
        new URL(`http://fine.test:${port}/`),
      ),
    ).rejects.toThrow(/timed out/);
  });

  it("accepts only https, and http when explicitly allowed", async () => {
    const strict = createOutboundHttp({ ...testOptions, allowHttp: false });
    await expect(strict.get(new URL("http://fine.test/"))).rejects.toThrow(/https/);
    await expect(
      createOutboundHttp(testOptions).get(new URL("file:///etc/passwd")),
    ).rejects.toThrow(/https/);
  });
});
