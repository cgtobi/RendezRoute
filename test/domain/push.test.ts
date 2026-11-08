import { describe, expect, it } from "vite-plus/test";
import { isPushServiceEndpoint, parsePushSubscription } from "../../src/domain/push.ts";

const keys = {
  // 65-byte uncompressed P-256 point and 16-byte secret, base64url (RFC 8291 section 5).
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

describe("isPushServiceEndpoint (decision I36)", () => {
  it("accepts the browser vendors' push services over https", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect({ endpoint, ok: isPushServiceEndpoint(endpoint) }).toEqual({ endpoint, ok: true });
    }
  });

  it("refuses anything else, so subscriptions cannot point the server at arbitrary hosts", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://notify.windows.com.evil.example/x",
      "https://127.0.0.1/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) {
      expect({ endpoint, ok: isPushServiceEndpoint(endpoint) }).toEqual({ endpoint, ok: false });
    }
  });
});

describe("parsePushSubscription (spec 6 feature 3)", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  it("takes the endpoint and keys from a browser's subscription JSON", () => {
    expect(parsePushSubscription({ endpoint, expirationTime: null, keys })).toEqual({
      ok: true,
      value: { endpoint, keys },
    });
  });

  it("refuses foreign endpoints and malformed keys", () => {
    const bad = [
      { endpoint: "https://evil.example/x", keys },
      { endpoint, keys: { ...keys, p256dh: "short" } },
      { endpoint, keys: { ...keys, auth: "!!!" } },
      { endpoint },
      "nonsense",
      { endpoint: endpoint + "x".repeat(2000), keys },
    ];
    for (const value of bad) expect(parsePushSubscription(value).ok).toBe(false);
  });
});
