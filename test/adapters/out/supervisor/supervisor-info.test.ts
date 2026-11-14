// The Supervisor's version over its internal API (decision D56), against a fake Supervisor.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSupervisorInfo } from "../../../../src/adapters/out/supervisor/supervisor-info.ts";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) resolve();
    else {
      server.closeAllConnections();
      server.close(() => resolve());
    }
  });
  server = undefined;
});

async function fakeSupervisor(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<URL> {
  server = createServer(handle);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return new URL(`http://127.0.0.1:${address.port}`);
}

const json = (response: ServerResponse, body: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const info = (url: URL, options: { timeoutMs?: number } = {}) =>
  createSupervisorInfo({ url, token: "the-token", ...options });

describe("asking the Supervisor for its version", () => {
  it("reads data.version from /supervisor/info, with the bearer token", async () => {
    const seen: {
      url?: string | undefined;
      auth?: string | undefined;
      method?: string | undefined;
    } = {};
    const url = await fakeSupervisor((request, response) => {
      Object.assign(seen, {
        url: request.url,
        auth: request.headers.authorization,
        method: request.method,
      });
      json(response, { result: "ok", data: { version: "2026.10.4", other: 1 } });
    });
    expect(await info(url).version()).toBe("2026.10.4");
    expect(seen).toEqual({ url: "/supervisor/info", auth: "Bearer the-token", method: "GET" });
  });

  it("hands on any version string, for the check to judge (dev, unparsable)", async () => {
    for (const version of ["dev", "2026.10.4.dev0", "nonsense"]) {
      const url = await fakeSupervisor((_request, response) =>
        json(response, { data: { version } }),
      );
      expect(await info(url).version()).toBe(version);
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("fails on 401 and other error statuses", async () => {
    for (const status of [401, 403, 500]) {
      const url = await fakeSupervisor((_request, response) =>
        json(response, { result: "error", message: "nope" }, status),
      );
      await expect(info(url).version()).rejects.toThrow(`HTTP ${status}`);
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("fails on a body without a version", async () => {
    for (const body of [{}, { data: {} }, { data: { version: 5 } }, { data: null }, []]) {
      const url = await fakeSupervisor((_request, response) => json(response, body));
      await expect(info(url).version()).rejects.toThrow("version");
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("fails on a body that is not JSON", async () => {
    const url = await fakeSupervisor((_request, response) => response.end("<html>"));
    await expect(info(url).version()).rejects.toThrow("version");
  });

  it("does not follow a redirect", async () => {
    let followed = false;
    const url = await fakeSupervisor((request, response) => {
      if (request.url === "/elsewhere") {
        followed = true;
        json(response, { data: { version: "2026.10.4" } });
      } else {
        response.writeHead(302, { location: "/elsewhere" });
        response.end();
      }
    });
    await expect(info(url).version()).rejects.toThrow("HTTP 302");
    expect(followed).toBe(false);
  });

  it("fails when nothing listens", async () => {
    const url = await fakeSupervisor((_request, response) => response.end());
    const dead = new URL(url.href);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    await expect(info(dead).version()).rejects.toThrow(/./);
  });

  it("names the network error code, never the token", async () => {
    const url = await fakeSupervisor((_request, response) => response.end());
    const dead = new URL(url.href);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const error = await info(dead)
      .version()
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ECONNREFUSED");
    expect((error as Error).message).not.toContain("the-token");
  });

  it("gives up after the timeout", async () => {
    const url = await fakeSupervisor(() => {
      // never answers
    });
    const started = Date.now();
    await expect(info(url, { timeoutMs: 150 }).version()).rejects.toThrow(/./);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("refuses an oversized answer", async () => {
    const url = await fakeSupervisor((_request, response) =>
      json(response, { data: { version: "2026.10.4", padding: "x".repeat(200_000) } }),
    );
    await expect(info(url).version()).rejects.toThrow("too large");
  });
});

describe("asking the Supervisor over its unix socket", () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function fakeSocket(
    handle: (request: IncomingMessage, response: ServerResponse) => void,
  ): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "rr-sup-"));
    const socketPath = join(directory, "supervisor.sock");
    server = createServer(handle);
    await new Promise<void>((resolve) => server?.listen(socketPath, resolve));
    return socketPath;
  }

  const viaSocket = (socketPath: string, options: { timeoutMs?: number } = {}) =>
    createSupervisorInfo({ socketPath, ...options });

  it("reads data.version from /supervisor/info, without any token", async () => {
    const seen: { url?: string | undefined; auth?: string | undefined; method?: string } = {};
    const socketPath = await fakeSocket((request, response) => {
      Object.assign(seen, {
        url: request.url,
        auth: request.headers.authorization,
        method: request.method,
      });
      json(response, { result: "ok", data: { version: "2026.10.4" } });
    });
    expect(await viaSocket(socketPath).version()).toBe("2026.10.4");
    expect(seen).toEqual({ url: "/supervisor/info", auth: undefined, method: "GET" });
  });

  it("fails on error statuses, a missing version and bad JSON", async () => {
    const socketPath = await fakeSocket((request, response) => {
      if (request.url === "/supervisor/info") json(response, { data: {} }, 403);
    });
    await expect(viaSocket(socketPath).version()).rejects.toThrow("HTTP 403");
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const second = await fakeSocket((_request, response) => response.end("<html>"));
    await expect(viaSocket(second).version()).rejects.toThrow("version");
  });

  it("does not follow a redirect", async () => {
    let followed = false;
    const socketPath = await fakeSocket((request, response) => {
      if (request.url === "/elsewhere") {
        followed = true;
        json(response, { data: { version: "2026.10.4" } });
      } else {
        response.writeHead(302, { location: "/elsewhere" });
        response.end();
      }
    });
    await expect(viaSocket(socketPath).version()).rejects.toThrow("HTTP 302");
    expect(followed).toBe(false);
  });

  it("names ENOENT for a missing socket and the code for a file that is no socket (ENOTSOCK on macOS, ECONNREFUSED on Linux)", async () => {
    const socketPath = await fakeSocket((_request, response) => response.end());
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    // closing the server unlinks the socket file: ENOENT
    await expect(viaSocket(socketPath).version()).rejects.toThrow("ENOENT");
    // a file at the path that nobody listens on
    const stale = join(directory ?? "", "stale.sock");
    await writeFile(stale, "");
    await expect(viaSocket(stale).version()).rejects.toThrow(/ENOTSOCK|ECONNREFUSED/);
  });

  it("keeps no connection open: it asks for close and uses no shared agent", async () => {
    let connection: string | undefined;
    const socketPath = await fakeSocket((request, response) => {
      connection = request.headers.connection;
      json(response, { data: { version: "2026.10.4" } });
    });
    const open = () =>
      new Promise<number>((resolve, reject) =>
        server?.getConnections((error, count) => (error ? reject(error) : resolve(count))),
      );
    expect(await viaSocket(socketPath).version()).toBe("2026.10.4");
    expect(connection).toBe("close");
    for (let waited = 0; waited < 1000 && (await open()) > 0; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await open()).toBe(0);
  });

  it("gives up after the timeout", async () => {
    const socketPath = await fakeSocket(() => {
      // never answers
    });
    const started = Date.now();
    await expect(viaSocket(socketPath, { timeoutMs: 150 }).version()).rejects.toThrow(/./);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("refuses an oversized answer", async () => {
    const socketPath = await fakeSocket((_request, response) =>
      json(response, { data: { version: "2026.10.4", padding: "x".repeat(200_000) } }),
    );
    await expect(viaSocket(socketPath).version()).rejects.toThrow("too large");
  });

  it("refuses an oversized answer without a content-length too", async () => {
    const socketPath = await fakeSocket((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("x".repeat(100_000));
      response.end("x".repeat(100_000));
    });
    await expect(viaSocket(socketPath).version()).rejects.toThrow("too large");
  });
});
