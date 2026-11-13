// Delivering a queued activity (spec 7 ActivityPub, 3.11; decisions D36, D38): signed with the
// actor's key looked up at delivery (or carried by a retired actor's Delete), posted through
// OutboundHttp, tried again while the server is down or busy, given up when it refuses.
import { exportJwk, generateCryptoKeyPair } from "@fedify/fedify";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { federationDeliveryHandler } from "../../../../src/adapters/out/federation/delivery.ts";
import type { DeliveryPayload } from "../../../../src/adapters/out/federation/publisher.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";

const INBOX = "https://social.example/inbox";
const payload: DeliveryPayload = {
  localActor: "instance",
  inbox: INBOX,
  body: '{"type":"Accept"}',
  keyId: "https://runs.example.org/actors/instance#main-key",
};
let keys: Awaited<ReturnType<typeof generateCryptoKeyPair>>;

beforeAll(async () => {
  keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
});

/** Only the instance actor has keys here; a retired actor has none. */
const deliver = (http: FakeOutboundHttp, value: unknown = payload) =>
  federationDeliveryHandler(http, (localActor) =>
    Promise.resolve(localActor === "instance" ? [keys] : undefined),
  )(value);

describe("delivering an activity (decision D38)", () => {
  it("posts the body, signed with the actor's key", async () => {
    const http = new FakeOutboundHttp().respond(INBOX, { status: 202 });
    expect(await deliver(http)).toBe("done");
    const [sent] = http.posts;
    expect(sent?.url.href).toBe(INBOX);
    expect(new TextDecoder().decode(sent?.body)).toBe(payload.body);
    expect(sent?.headers["content-type"]).toBe("application/activity+json");
    expect(sent?.headers.signature).toContain(`keyId="${payload.keyId}"`);
    expect(sent?.headers.digest).toMatch(/^SHA-256=/);
  });

  it("tries again while the server is down or busy, and gives up when it refuses", async () => {
    for (const [status, outcome] of [
      [500, "retry"],
      [503, "retry"],
      [429, "retry"],
      [408, "retry"],
      [400, "drop"],
      [401, "drop"],
      [404, "drop"],
      [410, "drop"],
    ] as const) {
      expect(await deliver(new FakeOutboundHttp().respond(INBOX, { status }))).toBe(outcome);
    }
    // A failed connection throws, which the job runner retries.
    await expect(deliver(new FakeOutboundHttp())).rejects.toThrow("no fake response");
  });

  it("signs a retired actor's Delete with the key it carries, and drops what nobody can sign", async () => {
    const http = new FakeOutboundHttp().respond(INBOX, { status: 202 });
    const retired = {
      ...payload,
      localActor: "retired-actor",
      keyId: "https://runs.example.org/actors/retired-actor#main-key",
    };
    expect(await deliver(http, retired)).toBe("drop");
    expect(http.posts).toEqual([]);
    expect(await deliver(http, { ...retired, privateKey: await exportJwk(keys.privateKey) })).toBe(
      "done",
    );
    expect(http.posts[0]?.headers.signature).toContain(`keyId="${retired.keyId}"`);
  });

  it("drops a Note's Create or Update that is no longer current, and sends one that is", async () => {
    const guard = { responseId: "response-1", noteId: "note-1" };
    const guarded = (current: boolean, http: FakeOutboundHttp) =>
      federationDeliveryHandler(
        http,
        () => Promise.resolve([keys]),
        (asked) => Promise.resolve(current && asked.noteId === "note-1"),
      )({ ...payload, guard });
    const stale = new FakeOutboundHttp().respond(INBOX, { status: 202 });
    // Withdrawn, or replaced by another Note, while it waited to be tried again.
    expect(await guarded(false, stale)).toBe("drop");
    expect(stale.posts).toEqual([]);
    const current = new FakeOutboundHttp().respond(INBOX, { status: 202 });
    expect(await guarded(true, current)).toBe("done");
    expect(current.posts).toHaveLength(1);
    // A guard that is there but not whole is a damaged job: dropped, not sent.
    for (const broken of [
      { responseId: "response-1" },
      { noteId: "note-1" },
      "x",
      { responseId: 1, noteId: "note-1" },
    ]) {
      const damaged = new FakeOutboundHttp().respond(INBOX, { status: 202 });
      expect(
        await federationDeliveryHandler(damaged, () => Promise.resolve([keys]))({
          ...payload,
          guard: broken,
        }),
      ).toBe("drop");
      expect(damaged.posts).toEqual([]);
    }
    // A payload without a guard (an Accept, a Delete) is never held back.
    const plain = new FakeOutboundHttp().respond(INBOX, { status: 202 });
    expect(
      await federationDeliveryHandler(
        plain,
        () => Promise.resolve([keys]),
        () => Promise.resolve(false),
      )(payload),
    ).toBe("done");
  });

  it("drops a payload that is not a delivery", async () => {
    const http = new FakeOutboundHttp();
    expect(await deliver(http, { inbox: INBOX })).toBe("drop");
    expect(await deliver(http, { ...payload, inbox: "not a url" })).toBe("drop");
    expect(await deliver(http, null)).toBe("drop");
    expect(http.posts).toEqual([]);
  });
});
