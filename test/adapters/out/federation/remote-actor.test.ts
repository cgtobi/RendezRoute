// Finding a fediverse account's actor from its address (spec 7 Optional notification channels,
// decision D47): WebFinger, then the actor, over OutboundHttp, trusting nothing the server says
// that it could use to make this site write to someone else.
import { describe, expect, it } from "vite-plus/test";
import { createRemoteActorLookup } from "../../../../src/adapters/out/federation/remote-actor.ts";
import {
  createOutboundHttp,
  OutboundError,
} from "../../../../src/adapters/out/http/outbound-http.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";
import {
  type FediverseAccountOptions,
  serveFediverseAccount,
} from "../../../support/remote-people.ts";

const HANDLE = "@anna@social.example";
const ACTOR = "https://social.example/users/anna";

/** A WebFinger answer naming the actor, with the given subject (none: the field is left out). */
const fingerFor = (subject: string | undefined) =>
  JSON.stringify({
    ...(subject === undefined ? {} : { subject }),
    links: [{ rel: "self", type: "application/activity+json", href: ACTOR }],
  });

function world(options: FediverseAccountOptions = {}, name = "anna") {
  const http = new FakeOutboundHttp();
  serveFediverseAccount({ federationHttp: http }, name, "social.example", options);
  return { http, lookup: createRemoteActorLookup({ http }) };
}

describe("looking an account up by WebFinger", () => {
  it("finds the actor and its own inbox, never the shared one", async () => {
    const { http, lookup } = world();
    expect(await lookup.resolve(HANDLE)).toEqual({
      kind: "found",
      actor: { id: ACTOR, inbox: `${ACTOR}/inbox`, sharedInbox: undefined },
    });
    expect(http.requests.map(String)).toEqual([
      "https://social.example/.well-known/webfinger?resource=acct%3Aanna%40social.example",
      ACTOR,
    ]);
  });

  it("takes a subject in another case, as servers may write the address", async () => {
    const { lookup } = world({ fingerBody: fingerFor("acct:Anna@Social.Example") });
    expect((await lookup.resolve(HANDLE)).kind).toBe("found");
  });

  it("takes the name without its @, and a name in another case", async () => {
    const { lookup } = world({ preferredUsername: "Anna" });
    expect((await lookup.resolve("anna@social.example")).kind).toBe("found");
    expect((await lookup.resolve(HANDLE)).kind).toBe("found");
  });

  it("accepts a link typed as ld+json with a profile", async () => {
    const { lookup } = world({
      fingerBody: JSON.stringify({
        subject: "acct:anna@social.example",
        links: [
          {
            rel: "self",
            type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
            href: ACTOR,
          },
        ],
      }),
    });
    expect((await lookup.resolve(HANDLE)).kind).toBe("found");
  });

  it.each([
    ["not an address", "anna"],
    ["two names", "@anna@bob@social.example"],
    ["no name", "@@social.example"],
    ["a server that is not a public name", "@anna@localhost"],
    ["an IP address as the server", "@anna@203.0.113.9"],
    ["a name with a space", "@an na@social.example"],
    ["a name with a slash path in the server", "@anna@social.example/x"],
  ])("sends nothing for %s", async (_, handle) => {
    const { http, lookup } = world();
    expect(await lookup.resolve(handle)).toEqual({ kind: "not_found" });
    expect(http.requests).toEqual([]);
  });

  it.each<[string, FediverseAccountOptions]>([
    ["WebFinger says 404", { fingerStatus: 404 }],
    ["WebFinger says 410", { fingerStatus: 410 }],
    ["WebFinger says 403", { fingerStatus: 403 }],
    ["WebFinger is not JSON", { fingerBody: "<html>hello</html>" }],
    [
      "WebFinger is over a mebibyte",
      { fingerBody: JSON.stringify({ links: [], padding: "x".repeat(1024 * 1024) }) },
    ],
    ["the actor is over a mebibyte", { actorBody: `{"padding":"${"x".repeat(1024 * 1024)}"}` }],
    ["WebFinger names another subject", { fingerBody: fingerFor("acct:mallory@social.example") }],
    [
      "WebFinger names a subject on another host",
      { fingerBody: fingerFor("acct:anna@evil.example") },
    ],
    ["WebFinger names no subject", { fingerBody: fingerFor(undefined) }],
    [
      "WebFinger names an actor with a password",
      {
        href: "https://anna:pw@social.example/users/anna",
        id: "https://anna:pw@social.example/users/anna",
      },
    ],
    ["the inbox has a user name", { inbox: "https://anna@social.example/users/anna/inbox" }],
    ["WebFinger is a JSON list", { fingerBody: "[]" }],
    ["WebFinger has no actor link", { fingerBody: JSON.stringify({ links: [] }) }],
    ["WebFinger names an actor on another host", { href: "https://evil.example/users/anna" }],
    ["WebFinger names an actor over http", { href: "http://social.example/users/anna" }],
    ["WebFinger names a subdomain", { href: "https://evil.social.example/users/anna" }],
    ["the actor is gone (410)", { actorStatus: 410 }],
    ["the actor is not JSON", { actorBody: "nope" }],
    ["the actor claims another id", { id: "https://social.example/users/mallory" }],
    ["the actor has the wrong name", { preferredUsername: "mallory" }],
    [
      "the actor has no name",
      { actorBody: JSON.stringify({ id: ACTOR, inbox: `${ACTOR}/inbox` }) },
    ],
    ["the inbox is on another host", { inbox: "https://evil.example/inbox" }],
    ["the inbox is over http", { inbox: "http://social.example/users/anna/inbox" }],
    [
      "the actor has no inbox",
      { actorBody: JSON.stringify({ id: ACTOR, preferredUsername: "anna" }) },
    ],
    ["the inbox is not an address", { inbox: "not a url" }],
  ])("is a final no when %s", async (_, options) => {
    const { lookup } = world(options);
    expect(await lookup.resolve(HANDLE)).toEqual({ kind: "not_found" });
  });

  it.each([
    ["WebFinger says 500", { fingerStatus: 500 }],
    ["WebFinger says 503", { fingerStatus: 503 }],
    ["WebFinger says 429", { fingerStatus: 429 }],
    ["WebFinger says 408", { fingerStatus: 408 }],
    ["the actor says 502", { actorStatus: 502 }],
    ["the actor says 429", { actorStatus: 429 }],
  ] as [string, FediverseAccountOptions][])("may be tried again when %s", async (_, options) => {
    const { lookup } = world(options);
    expect(await lookup.resolve(HANDLE)).toEqual({ kind: "unavailable" });
  });

  it("may be tried again when the server is unreachable or too slow", async () => {
    for (const message of ["Request failed.", "Request timed out."]) {
      const http = new FakeOutboundHttp().fail(
        "https://social.example/",
        new OutboundError(message),
      );
      expect(await createRemoteActorLookup({ http }).resolve(HANDLE)).toEqual({
        kind: "unavailable",
      });
    }
    const plain = new FakeOutboundHttp().fail("https://social.example/", new Error("boom"));
    expect(await createRemoteActorLookup({ http: plain }).resolve(HANDLE)).toEqual({
      kind: "unavailable",
    });
  });

  it("is a final no when the guard refused the request, the answer was too big or redirects never end", async () => {
    for (const message of [
      "Request blocked: social.example resolves to a forbidden address.",
      "Response too large (limit 1048576 bytes).",
      "Too many redirects (more than 5).",
      "Only https URLs are allowed, got http:",
    ]) {
      const http = new FakeOutboundHttp().fail(
        "https://social.example/",
        new OutboundError(message),
      );
      expect(await createRemoteActorLookup({ http }).resolve(HANDLE)).toEqual({
        kind: "not_found",
      });
    }
  });

  it("asks for small answers with a time limit, through the guarded client only", async () => {
    const calls: { maxBytes?: number | undefined; timeoutMs?: number | undefined }[] = [];
    const inner = world().http;
    const http = {
      get: (url: URL, options?: { maxBytes?: number; timeoutMs?: number }) => {
        calls.push({ maxBytes: options?.maxBytes, timeoutMs: options?.timeoutMs });
        return inner.get(url);
      },
      post: inner.post.bind(inner),
    };
    await createRemoteActorLookup({ http }).resolve(HANDLE);
    expect(calls).toEqual([
      { maxBytes: 1024 * 1024, timeoutMs: 10_000 },
      { maxBytes: 1024 * 1024, timeoutMs: 10_000 },
    ]);
  });

  it("does not follow WebFinger to another host", async () => {
    const { http, lookup } = world();
    const real = http.get.bind(http);
    http.get = async (url: URL) => {
      const answer = await real(url);
      // As if a redirect had led to another host; the guarded client reports where it ended.
      return url.pathname.endsWith("webfinger")
        ? { ...answer, url: new URL("https://elsewhere.example/.well-known/webfinger") }
        : answer;
    };
    expect(await lookup.resolve(HANDLE)).toEqual({ kind: "not_found" });
  });

  it("does not follow the actor to another host", async () => {
    const { http, lookup } = world();
    const real = http.get.bind(http);
    http.get = async (url: URL) => {
      const answer = await real(url);
      // As if the actor's address had redirected away; the guarded client says where it ended.
      return url.pathname === "/users/anna"
        ? { ...answer, url: new URL("https://elsewhere.example/users/anna") }
        : answer;
    };
    expect(await lookup.resolve(HANDLE)).toEqual({ kind: "not_found" });
  });

  it("accepts an actor and inbox over http only in development", async () => {
    const http = new FakeOutboundHttp()
      .respond("https://dev.test/.well-known/webfinger", {
        body: JSON.stringify({
          subject: "acct:a@dev.test",
          links: [
            { rel: "self", type: "application/activity+json", href: "http://dev.test/users/a" },
          ],
        }),
      })
      .respond("http://dev.test/users/a", {
        body: JSON.stringify({
          id: "http://dev.test/users/a",
          preferredUsername: "a",
          inbox: "http://dev.test/users/a/inbox",
        }),
      });
    expect(await createRemoteActorLookup({ http }).resolve("@a@dev.test")).toEqual({
      kind: "not_found",
    });
    expect(
      await createRemoteActorLookup({ http, allowInsecure: true }).resolve("@a@dev.test"),
    ).toEqual({
      kind: "found",
      actor: {
        id: "http://dev.test/users/a",
        inbox: "http://dev.test/users/a/inbox",
        sharedInbox: undefined,
      },
    });
  });

  it("is refused by the real SSRF guard for a host that resolves to a private address, without connecting", async () => {
    const http = createOutboundHttp({
      userAgent: "RendezRoute/test",
      resolve: () => Promise.resolve([{ address: "127.0.0.2", family: 4 }]),
    });
    expect(await createRemoteActorLookup({ http }).resolve("@anna@internal.example")).toEqual({
      kind: "not_found",
    });
  });
});
