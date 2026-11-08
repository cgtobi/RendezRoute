import { createECDH, createDecipheriv, generateKeyPairSync, hkdfSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createWebPushNotifier } from "../../../../src/adapters/out/push/notifier.ts";
import type { Notification } from "../../../../src/domain/notification.ts";
import { FakeChannelRepository } from "../../../fakes/channels.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";

// The RFC 8291 receiver, so the test can read what was sent.
const UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const keys = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

function decrypt(body: Uint8Array): unknown {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const idLength = data.readUInt8(20);
  const asPublic = data.subarray(21, 21 + idLength);
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(Buffer.from(UA_PRIVATE, "base64url"));
  const uaPublic = Buffer.from(keys.p256dh, "base64url");
  const secret = receiver.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(
    hkdfSync("sha256", secret, Buffer.from(keys.auth, "base64url"), info, 32),
  );
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const record = data.subarray(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

function vapidKeys() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
    format: "jwk",
  });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d ?? "" };
}

const notification: Notification = {
  kind: "accepted",
  planTitle: "Hill repeats",
  planPath: "/p/abc",
  language: "de",
};

let channels: FakeChannelRepository;
let http: FakeOutboundHttp;
let channelId: string;
beforeEach(async () => {
  channels = new FakeChannelRepository();
  http = new FakeOutboundHttp();
  channelId = await channels.add({ responseId: "r1" }, { endpoint: ENDPOINT, keys });
});

const notifier = () =>
  createWebPushNotifier({
    channels,
    http,
    vapid: vapidKeys(),
    subject: "mailto:owner@example.org",
    baseUrl: new URL("https://runs.example.org"),
    now: () => new Date("2026-11-08T10:00:00Z"),
  });

describe("Web Push notifier (spec 6 feature 3, decision I36)", () => {
  it("sends an encrypted message in the recipient's language with VAPID identification", async () => {
    http.respond(ENDPOINT, { status: 201 });
    expect(await notifier().send({ channelId }, notification)).toBe("sent");
    const [post] = http.posts;
    expect(post?.url.href).toBe(ENDPOINT);
    expect(post?.headers).toMatchObject({
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal",
    });
    expect(post?.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
    expect(decrypt(post?.body ?? new Uint8Array())).toEqual({
      title: "Hill repeats",
      body: "Du bist dabei. Der genaue Treffpunkt steht jetzt beim Treffen.",
      url: "https://runs.example.org/p/abc",
    });
  });

  it("sends to a subscription carried by the job itself, after its channel is gone", async () => {
    http.respond(ENDPOINT, { status: 201 });
    const message = { ...notification, kind: "deleted" as const, planPath: undefined };
    expect(await notifier().send({ subscription: { endpoint: ENDPOINT, keys } }, message)).toBe(
      "sent",
    );
    expect(decrypt(http.posts[0]?.body ?? new Uint8Array())).toEqual({
      title: "Hill repeats",
      body: "Die Organisator:in hat das Treffen gelöscht.",
    });
  });

  it("reports subscriptions the push service refuses as gone, so they are deleted", async () => {
    for (const status of [400, 403, 404, 410, 413]) {
      http.respond(ENDPOINT, { status });
      expect(await notifier().send({ channelId }, notification)).toBe("gone");
    }
    expect(await notifier().send({ channelId: "unknown-channel" }, notification)).toBe("gone");
  });

  it("reports a subscription whose browser key is not a valid P-256 point as gone", async () => {
    const broken = await channels.add(
      { responseId: "r2" },
      { endpoint: `${ENDPOINT}/broken`, keys: { ...keys, p256dh: `B${"A".repeat(86)}` } },
    );
    http.respond(ENDPOINT, { status: 201 });
    expect(await notifier().send({ channelId: broken }, notification)).toBe("gone");
    expect(http.posts).toEqual([]);
  });

  it("retries when the push service is busy or failing", async () => {
    for (const status of [429, 500, 503]) {
      http.respond(ENDPOINT, { status });
      expect(await notifier().send({ channelId }, notification)).toBe("retry");
    }
  });
});
