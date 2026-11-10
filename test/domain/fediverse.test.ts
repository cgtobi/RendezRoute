// Fediverse login: which server someone means (spec 7 Identity; plan v1.0 step 4b, decision D24).
import { describe, expect, it } from "vite-plus/test";
import {
  fediverseAccount,
  fediverseServerAllowed,
  parseFediverseServer,
} from "../../src/domain/fediverse.ts";

describe("the server someone types", () => {
  it("is taken from a domain, a URL or a handle, as an HTTPS origin", () => {
    const inputs = [
      "mastodon.social",
      " Mastodon.Social ",
      "https://mastodon.social",
      "https://mastodon.social/",
      "https://mastodon.social/@anna",
      "mastodon.social.",
      "@anna@mastodon.social",
      "anna@mastodon.social",
    ];
    expect(inputs.map((input) => [input, parseFediverseServer(input)])).toEqual(
      inputs.map((input) => [input, { ok: true, value: "https://mastodon.social" }]),
    );
  });

  it("writes international domains in their ASCII form", () => {
    expect(parseFediverseServer("läufer.example")).toEqual({
      ok: true,
      value: "https://xn--lufer-gra.example",
    });
  });

  it("refuses what cannot be a public server", () => {
    for (const input of [
      "",
      "localhost",
      "mastodon",
      "127.0.0.1",
      "[::1]",
      "10.0.0.1",
      "http://mastodon.social",
      "mastodon.social:8443",
      "user:pw@mastodon.social",
      "@anna@",
      "a b.example",
      `${"a".repeat(250)}.example`,
    ]) {
      expect(parseFediverseServer(input)).toEqual({ ok: false, error: "server_invalid" });
    }
  });

  it("may use plain http and a port in development, for local fake servers", () => {
    expect(parseFediverseServer("http://localhost:9001", { allowInsecure: true })).toEqual({
      ok: true,
      value: "http://localhost:9001",
    });
    expect(parseFediverseServer("http://localhost:9001")).toEqual({
      ok: false,
      error: "server_invalid",
    });
  });
});

describe("the list of accepted servers (FEDIVERSE_LOGIN_SERVERS)", () => {
  it("accepts any server without a list, and only listed hosts with one", () => {
    expect(fediverseServerAllowed("https://mastodon.social", undefined)).toBe(true);
    expect(fediverseServerAllowed("https://club.example", ["club.example"])).toBe(true);
    expect(fediverseServerAllowed("https://mastodon.social", ["club.example"])).toBe(false);
    expect(fediverseServerAllowed("https://sub.club.example", ["club.example"])).toBe(false);
  });
});

describe("the account a server says logged in", () => {
  it("is taken only when ID and username are short and plain", () => {
    expect(fediverseAccount("109", "anna_r")).toEqual({ id: "109", username: "anna_r" });
    expect(fediverseAccount("01HXYZ", "anna.runs")).toEqual({
      id: "01HXYZ",
      username: "anna.runs",
    });
    for (const [id, username] of [
      ["", "anna"],
      ["109", ""],
      [109, "anna"],
      ["109", "anna@evil.example"],
      ["109", "an na"],
      ["109", "anna\u0000"],
      ["109", "a".repeat(65)],
      ["x".repeat(65), "anna"],
    ]) {
      expect(fediverseAccount(id, username)).toBeUndefined();
    }
  });
});
