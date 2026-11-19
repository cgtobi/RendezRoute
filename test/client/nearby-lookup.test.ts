// Nearby's place lookup (decision D35, ADR 008) with a fake fetch: one POST to the instance's place
// search endpoint with the CSRF token, the first result's point, and none or failed otherwise.
import { describe, expect, it } from "vite-plus/test";
import { lookUp } from "../../src/client/nearby-lookup.ts";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that records its calls and answers with `respond`. */
function fakeFetch(respond: () => Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return respond();
  };
  return { fetch: fake as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("lookUp", () => {
  it("posts the query with the CSRF token and returns the first place's point", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        places: [
          { label: "Flaucher, Isar, Munich", lat: 48.1107, lng: 11.5582 },
          { label: "Flaucher, elsewhere", lat: 1, lng: 2 },
        ],
      }),
    );
    expect(await lookUp("/geocode", "token-1", "Flaucher", fetch)).toEqual({
      kind: "found",
      lat: 48.1107,
      lng: 11.5582,
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("/geocode");
    expect(call?.init?.method).toBe("POST");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("x-csrf-token")).toBe("token-1");
    expect(headers.get("content-type")).toBe("application/json");
    const body = call?.init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({ q: "Flaucher" });
  });

  it("says none when the search found nothing", async () => {
    const { fetch } = fakeFetch(() => json({ places: [] }));
    expect(await lookUp("/geocode", "t", "Nowhere", fetch)).toEqual({ kind: "none" });
  });

  it("says failed when the endpoint refuses (503) or the network fails", async () => {
    const refused = fakeFetch(() => json({ error: "unavailable" }, 503));
    expect(await lookUp("/geocode", "t", "Flaucher", refused.fetch)).toEqual({ kind: "failed" });
    const broken = fakeFetch(() => Promise.reject(new TypeError("network error")));
    expect(await lookUp("/geocode", "t", "Flaucher", broken.fetch)).toEqual({ kind: "failed" });
  });

  it("says failed for an answer that is not a list of points", async () => {
    for (const body of [{}, { places: "x" }, { places: [{ lat: "48", lng: 11 }] }]) {
      const { fetch } = fakeFetch(() => json(body));
      expect(await lookUp("/geocode", "t", "Flaucher", fetch)).toEqual({ kind: "failed" });
    }
    const { fetch } = fakeFetch(() => json({ places: [{ lat: 91, lng: 11 }] }));
    expect(await lookUp("/geocode", "t", "Flaucher", fetch)).toEqual({ kind: "failed" });
  });

  it("passes the signal on and says failed once it is aborted", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    expect(await lookUp("/geocode", "t", "Flaucher", fetch, controller.signal)).toEqual({
      kind: "failed",
    });
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });
});
