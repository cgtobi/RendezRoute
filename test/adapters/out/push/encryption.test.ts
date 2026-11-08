import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { encryptPayload } from "../../../../src/adapters/out/push/encryption.ts";
import { vapidAuthorization } from "../../../../src/adapters/out/push/vapid.ts";

const b64 = (text: string) => Buffer.from(text.replace(/\s+/g, ""), "base64url");

// RFC 8291 section 5 and appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
};

describe("encryptPayload (RFC 8291)", () => {
  it("reproduces the RFC's example message byte for byte", () => {
    const body = encryptPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { senderPrivateKey: b64(RFC.asPrivate), salt: b64(RFC.salt) },
    );
    expect(Buffer.from(body).toString("base64url")).toBe(RFC.body.replace(/\s+/g, ""));
  });

  it("uses a fresh key and salt for every message", () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const message = new TextEncoder().encode("hello");
    expect(Buffer.from(encryptPayload(message, keys))).not.toEqual(
      Buffer.from(encryptPayload(message, keys)),
    );
  });
});

describe("vapidAuthorization (RFC 8292)", () => {
  it("signs a short-lived claim for the push service's origin with the instance key", () => {
    const { privateKey: generated, publicKey: verifyKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const jwk = generated.export({ format: "jwk" });
    const publicKey = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x ?? "", "base64url"),
      Buffer.from(jwk.y ?? "", "base64url"),
    ]).toString("base64url");
    const header = vapidAuthorization({
      endpoint: new URL("https://fcm.googleapis.com/fcm/send/abc"),
      keys: { publicKey, privateKey: jwk.d ?? "" },
      subject: "mailto:owner@example.org",
      now: new Date("2026-11-08T10:00:00Z"),
    });

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    if (match === null) throw new Error(header);
    const [, head = "", claims = "", signature = "", k] = match;
    expect(k).toBe(publicKey);
    expect(JSON.parse(b64(head).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b64(claims).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.parse("2026-11-08T22:00:00Z") / 1000,
      sub: "mailto:owner@example.org",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key: verifyKey, dsaEncoding: "ieee-p1363" },
        b64(signature),
      ),
    ).toBe(true);
  });
});
