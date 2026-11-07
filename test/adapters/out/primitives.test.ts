import { describe, expect, it } from "vite-plus/test";
import { createIdGenerator } from "../../../src/adapters/out/ids.ts";
import { systemClock } from "../../../src/adapters/out/system-clock.ts";
import { createTokenService } from "../../../src/adapters/out/tokens.ts";
import { FakeClock } from "../../fakes/clock.ts";
import { FakeFieldCipher } from "../../fakes/field-cipher.ts";
import { FakeOutboundHttp } from "../../fakes/outbound-http.ts";
import { SequentialIdGenerator } from "../../fakes/ids.ts";
import { FakeTokenService } from "../../fakes/tokens.ts";

describe("IdGenerator (decision P1)", () => {
  const ids = createIdGenerator();

  it("creates plan IDs from 128 random bits as 22 base64url characters", () => {
    const planIds = new Set(Array.from({ length: 1000 }, () => ids.planId()));
    expect(planIds.size).toBe(1000);
    for (const id of planIds) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("creates row IDs as UUIDv7", () => {
    expect(ids.rowId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("TokenService (spec 3.2)", () => {
  const tokens = createTokenService();

  it("generates 256-bit URL-safe tokens", () => {
    const generated = new Set(Array.from({ length: 1000 }, () => tokens.generate()));
    expect(generated.size).toBe(1000);
    for (const token of generated) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes with SHA-256 as lowercase hex", () => {
    expect(tokens.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("Clock", () => {
  it("system clock returns the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("fakes", () => {
  it("FakeClock is settable and advances", () => {
    const clock = new FakeClock("2026-06-01T08:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-06-01T08:00:00.000Z");
    clock.advance({ hours: 2, minutes: 30 });
    expect(clock.now().toISOString()).toBe("2026-06-01T10:30:00.000Z");
    clock.set("2026-07-01T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("FakeClock returns copies that callers cannot mutate", () => {
    const clock = new FakeClock("2026-06-01T08:00:00Z");
    clock.now().setFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it("SequentialIdGenerator and FakeTokenService are deterministic", () => {
    const ids = new SequentialIdGenerator();
    expect([ids.planId(), ids.planId(), ids.rowId()]).toEqual([
      "plan-0001",
      "plan-0002",
      "row-0001",
    ]);
    const tokens = new FakeTokenService();
    expect([tokens.generate(), tokens.generate()]).toEqual(["token-0001", "token-0002"]);
    expect(tokens.hash("token-0001")).toBe(createTokenService().hash("token-0001"));
  });
});

describe("FakeFieldCipher", () => {
  const cipher = new FakeFieldCipher();

  it("round-trips, hides the plaintext and binds the field", () => {
    const encrypted = cipher.encrypt("SENTINEL-name", "responses.display_name");
    expect(encrypted).not.toContain("SENTINEL");
    expect(cipher.decrypt(encrypted, "responses.display_name")).toBe("SENTINEL-name");
    expect(() => cipher.decrypt(encrypted, "responses.request_note")).toThrow(/different field/);
  });
});

describe("FakeOutboundHttp", () => {
  it("answers configured URL prefixes, records requests and refuses everything else", async () => {
    const http = new FakeOutboundHttp().respond("https://geo.example/search", {
      body: '{"ok":true}',
    });
    const response = await http.get(new URL("https://geo.example/search?q=Isar"));
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe('{"ok":true}');
    expect(http.requests.map((url) => url.href)).toEqual(["https://geo.example/search?q=Isar"]);
    await expect(http.get(new URL("https://elsewhere.example/"))).rejects.toThrow(
      /no fake response/,
    );
  });

  it("simulates failures", async () => {
    const http = new FakeOutboundHttp().fail("https://weather.example/", new Error("timed out"));
    await expect(http.get(new URL("https://weather.example/v1"))).rejects.toThrow(/timed out/);
  });
});
