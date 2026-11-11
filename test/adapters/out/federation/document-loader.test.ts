// Fedify's remote fetches through OutboundHttp (spec 3.11: every outbound request; I61): remote
// documents such as the keys of servers that post to the inbox, and JSON-LD contexts other than
// the ones Fedify ships with.
import { describe, expect, it } from "vite-plus/test";
import {
  outboundContextLoader,
  outboundDocumentLoader,
} from "../../../../src/adapters/out/federation/document-loader.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";

const KEY = "https://social.example/users/ben#main-key";

describe("Fedify's document loader on OutboundHttp", () => {
  it("fetches ActivityPub documents through OutboundHttp, asking for JSON-LD", async () => {
    const http = new FakeOutboundHttp().respond("https://social.example/users/ben", {
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({ id: "https://social.example/users/ben", type: "Person" }),
    });
    const loaded = await outboundDocumentLoader(http)(KEY);
    expect(loaded).toEqual({
      contextUrl: null,
      documentUrl: KEY,
      document: { id: "https://social.example/users/ben", type: "Person" },
    });
    expect(http.requests.map(String)).toEqual([KEY]);
  });

  it("fails on anything but a JSON answer, and on what OutboundHttp refuses", async () => {
    const http = new FakeOutboundHttp()
      .respond("https://social.example/gone", { status: 404 })
      .respond("https://social.example/html", { body: "<html>" })
      .fail("https://internal.example/", new Error("blocked: private address"));
    const load = outboundDocumentLoader(http);
    await expect(load("https://social.example/gone")).rejects.toThrow(/404/);
    await expect(load("https://social.example/html")).rejects.toThrow(/JSON/);
    await expect(load("https://internal.example/key")).rejects.toThrow(/blocked/);
  });

  it("answers the contexts Fedify ships with itself, and fetches others", async () => {
    const http = new FakeOutboundHttp().respond("https://contexts.example/extra", {
      body: JSON.stringify({ "@context": { extra: "https://contexts.example/extra#" } }),
    });
    const load = outboundContextLoader(http);
    const known = await load("https://www.w3.org/ns/activitystreams");
    expect(known.document).toBeDefined();
    expect(http.requests).toEqual([]);
    await load("https://contexts.example/extra");
    expect(http.requests.map(String)).toEqual(["https://contexts.example/extra"]);
  });
});
