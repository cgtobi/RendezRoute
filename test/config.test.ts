import { describe, expect, it } from "vite-plus/test";
import { type Config, loadConfig } from "../src/config.ts";

const minimal = { BASE_URL: "https://runs.example.org", CONTACT_EMAIL: "owner@example.org" };

function ok(env: Record<string, string>): { config: Config; warnings: string[] } {
  const result = loadConfig(env);
  if (!result.ok) throw new Error(`expected valid config, got: ${result.errors.join("; ")}`);
  return result;
}

function errors(env: Record<string, string>): string[] {
  const result = loadConfig(env);
  if (result.ok) throw new Error("expected invalid config");
  return result.errors;
}

describe("defaults (spec section 10)", () => {
  it("produces a complete configuration from BASE_URL and CONTACT_EMAIL alone", () => {
    const { config, warnings } = ok(minimal);

    expect(config.baseUrl.href).toBe("https://runs.example.org/");
    expect(config.instanceName).toBe("RendezRoute");
    expect(config.dataDir).toBe("/data");
    expect(config.encryptionKeyFile).toBeUndefined();
    expect(config.trustProxy).toBe(false);
    expect(config.contactEmail).toBe("owner@example.org");
    expect(config.imprintUrl).toBeUndefined();
    expect(config.privacyUrl).toBeUndefined();
    expect(config.maxRetentionDays).toBe(30);
    expect(config.maxPlanHorizonDays).toBe(180);
    expect(config.defaultTimezone).toBe("UTC");
    expect(config.allowInsecureDev).toBe(false);
    expect(config.e2eClockControl).toBe(false);
    expect(config.adminToken).toBeUndefined();
    expect(config.maps).toEqual({
      enabled: true,
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      tileCspSource: "https://tile.openstreetmap.org",
      tileHost: "tile.openstreetmap.org",
      attribution: "© OpenStreetMap contributors",
      serverSideTiles: true,
    });
    expect(config.geocoder).toEqual({
      enabled: true,
      url: new URL("https://nominatim.openstreetmap.org"),
    });
    expect(config.weather).toEqual({ enabled: true, url: new URL("https://api.open-meteo.com") });
    expect(warnings).toEqual([]);
  });

  it("reports every problem at once", () => {
    const found = errors({ BASE_URL: "nope", MAX_RETENTION_DAYS: "99", TRUST_PROXY: "yes" });
    expect(found).toHaveLength(3);
  });
});

describe("ADMIN_TOKEN (spec 7 Moderation)", () => {
  it("is optional, and taken as given when long enough", () => {
    const token = "x".repeat(32);
    expect(ok({ ...minimal, ADMIN_TOKEN: token }).config.adminToken).toBe(token);
  });

  it("must be at least 32 characters, or the app refuses to start", () => {
    expect(errors({ ...minimal, ADMIN_TOKEN: "x".repeat(31) })).toEqual([
      "ADMIN_TOKEN must be at least 32 characters.",
    ]);
  });
});

describe("ADMIN_INGRESS (decision D56)", () => {
  const ingress = {
    ...minimal,
    ADMIN_INGRESS: "true",
    ADMIN_PORT: "8099",
    ADMIN_BIND: "0.0.0.0",
    SUPERVISOR_TOKEN: "supervisor-token",
  };

  it("changes nothing while it is unset or false", () => {
    expect(ok(minimal).config.admin).toBeUndefined();
    const token = "x".repeat(32);
    const split = { ...minimal, ADMIN_TOKEN: token, ADMIN_PORT: "3001" };
    expect(ok(split).config.admin?.ingress).toBeUndefined();
    expect(ok({ ...split, ADMIN_INGRESS: "false" }).config.admin?.ingress).toBeUndefined();
    expect(errors({ ...minimal, ADMIN_PORT: "3001" })).toEqual([
      "ADMIN_PORT needs ADMIN_TOKEN: the admin pages need a way to log in.",
    ]);
  });

  it("is on with its defaults, and needs no ADMIN_TOKEN", () => {
    const { config } = ok(ingress);
    expect(config.adminToken).toBeUndefined();
    expect(config.admin).toEqual({
      port: 8099,
      bind: "0.0.0.0",
      url: undefined,
      ingress: {
        peer: "172.30.32.2",
        supervisorUrl: new URL("http://supervisor"),
        supervisorSocket: undefined,
        supervisorToken: "supervisor-token",
        skipVersionCheck: false,
      },
    });
  });

  it("takes the peer, the Supervisor URL and the skip flag", () => {
    for (const peer of ["127.0.0.1", "::1", "fd00::2", "::ffff:172.30.32.2"]) {
      expect(ok({ ...ingress, ADMIN_INGRESS_PEER: peer }).config.admin?.ingress?.peer).toBe(peer);
    }
    const { config, warnings } = ok({
      ...ingress,
      SUPERVISOR_URL: "http://127.0.0.1:4000",
      ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
    });
    expect(config.admin?.ingress?.supervisorUrl.origin).toBe("http://127.0.0.1:4000");
    expect(config.admin?.ingress?.skipVersionCheck).toBe(true);
    expect(warnings.join(" ")).toContain("ADMIN_INGRESS_SKIP_VERSION_CHECK=true");
  });

  it("needs ADMIN_PORT", () => {
    const { ADMIN_PORT: _port, ADMIN_BIND: _bind, ...without } = ingress;
    expect(errors(without)).toEqual(["ADMIN_INGRESS needs ADMIN_PORT."]);
  });

  it("is mutually exclusive with ADMIN_TOKEN", () => {
    expect(errors({ ...ingress, ADMIN_TOKEN: "x".repeat(32) })).toEqual([
      "ADMIN_INGRESS and ADMIN_TOKEN cannot be used together: Home Assistant signs the admin in.",
    ]);
  });

  it("needs ADMIN_BIND to be set explicitly", () => {
    const { ADMIN_BIND: _bind, ...without } = ingress;
    expect(errors(without)).toEqual([
      "ADMIN_INGRESS needs ADMIN_BIND: the Supervisor connects from outside the container.",
    ]);
  });

  it("refuses a peer that is not an IP address", () => {
    for (const bad of ["supervisor", "172.30.32", "172.30.32.2/24", "256.1.1.1", "[::1]"]) {
      expect(errors({ ...ingress, ADMIN_INGRESS_PEER: bad })).toEqual([
        expect.stringContaining("ADMIN_INGRESS_PEER must be an IP address"),
      ]);
    }
  });

  it("refuses a Supervisor URL that is not an http(s) origin", () => {
    for (const bad of ["supervisor", "ftp://supervisor", "http://u:p@supervisor", "http://s/x"]) {
      expect(errors({ ...ingress, SUPERVISOR_URL: bad })).toEqual([
        expect.stringContaining("SUPERVISOR_URL"),
      ]);
    }
  });

  it("needs SUPERVISOR_TOKEN unless the version check is skipped", () => {
    const { SUPERVISOR_TOKEN: _token, ...without } = ingress;
    expect(errors(without)).toEqual([
      "ADMIN_INGRESS needs SUPERVISOR_TOKEN in the environment (Home Assistant sets it for apps) to ask the Supervisor for its version.",
    ]);
    const skipped = ok({ ...without, ADMIN_INGRESS_SKIP_VERSION_CHECK: "true" });
    expect(skipped.config.admin?.ingress?.supervisorToken).toBeUndefined();
  });

  it("needs no Supervisor settings when the version was verified outside (decision I75)", () => {
    const { SUPERVISOR_TOKEN: _token, ...without } = ingress;
    const result = loadConfig(without, { ingressVersionVerified: true });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.config.admin?.ingress).toEqual({
      peer: "172.30.32.2",
      supervisorUrl: new URL("http://supervisor"),
      supervisorSocket: undefined,
      supervisorToken: undefined,
      skipVersionCheck: false,
    });
    expect(result.warnings).toEqual([]);
    // The same environment without the fact is still an error, and false is the default.
    for (const options of [undefined, {}, { ingressVersionVerified: false }]) {
      const refused = loadConfig(without, options);
      expect(refused.ok).toBe(false);
    }
  });

  it("does not take the verified fact from the environment", () => {
    const { SUPERVISOR_TOKEN: _token, ...without } = ingress;
    for (const name of [
      "INGRESS_VERSION_VERIFIED",
      "ADMIN_INGRESS_VERSION_VERIFIED",
      "ADMIN_INGRESS_VERSION_CHECKED",
      "SUPERVISOR_VERSION_VERIFIED",
    ]) {
      expect(errors({ ...without, [name]: "true" })).toEqual([
        expect.stringContaining("ADMIN_INGRESS needs SUPERVISOR_TOKEN"),
      ]);
    }
  });

  it("takes SUPERVISOR_SOCKET instead of the URL and the token (decision D57)", () => {
    const { SUPERVISOR_TOKEN: _token, ...withoutToken } = ingress;
    const socket = "/run/supervisor/api/supervisor.sock";
    const { config } = ok({ ...withoutToken, SUPERVISOR_SOCKET: socket });
    expect(config.admin?.ingress?.supervisorSocket).toBe(socket);
    expect(config.admin?.ingress?.supervisorToken).toBeUndefined();
    // Home Assistant sets both; the socket wins and the token is not kept.
    const both = ok({ ...ingress, SUPERVISOR_SOCKET: socket }).config.admin?.ingress;
    expect(both?.supervisorSocket).toBe(socket);
    expect(both?.supervisorToken).toBeUndefined();
  });

  it("refuses a socket path that is relative or too long, and a socket with a URL", () => {
    for (const bad of ["supervisor.sock", "run/x.sock", `/${"a".repeat(120)}`]) {
      expect(errors({ ...ingress, SUPERVISOR_SOCKET: bad })).toEqual([
        expect.stringContaining("SUPERVISOR_SOCKET"),
      ]);
    }
    expect(
      errors({ ...ingress, SUPERVISOR_SOCKET: "/s.sock", SUPERVISOR_URL: "http://127.0.0.1:1" }),
    ).toEqual(["SUPERVISOR_SOCKET and SUPERVISOR_URL cannot be used together."]);
  });

  it("ignores SUPERVISOR_SOCKET without ADMIN_INGRESS, as Home Assistant sets it for every app", () => {
    const split = { ...minimal, ADMIN_TOKEN: "x".repeat(32), ADMIN_PORT: "3001" };
    expect(ok({ ...split, SUPERVISOR_SOCKET: "/s.sock" }).config.admin?.ingress).toBeUndefined();
  });

  it("refuses the Ingress settings without ADMIN_INGRESS", () => {
    const split = { ...minimal, ADMIN_TOKEN: "x".repeat(32), ADMIN_PORT: "3001" };
    for (const name of [
      "ADMIN_INGRESS_PEER",
      "SUPERVISOR_URL",
      "ADMIN_INGRESS_SKIP_VERSION_CHECK",
    ]) {
      const value =
        name === "ADMIN_INGRESS_PEER"
          ? "127.0.0.1"
          : name === "SUPERVISOR_URL"
            ? "http://s"
            : "true";
      expect(errors({ ...split, [name]: value })).toEqual([`${name} needs ADMIN_INGRESS.`]);
    }
  });

  it("allows POSTING_MODE=invite, as the admin exists", () => {
    expect(ok({ ...ingress, POSTING_MODE: "invite" }).config.postingMode).toBe("invite");
  });
});

describe("ADMIN_PORT, ADMIN_BIND and ADMIN_URL (decision D55)", () => {
  const token = "x".repeat(32);
  const split = { ...minimal, ADMIN_TOKEN: token, ADMIN_PORT: "3001" };

  it("changes nothing while ADMIN_PORT is unset, also when it is empty", () => {
    expect(ok(minimal).config.admin).toBeUndefined();
    expect(ok({ ...minimal, ADMIN_TOKEN: token, ADMIN_PORT: "" }).config.admin).toBeUndefined();
  });

  it("listens on 127.0.0.1 by default, without an own URL", () => {
    expect(ok(split).config.admin).toEqual({ port: 3001, bind: "127.0.0.1", url: undefined });
  });

  it("accepts whole port numbers from 1 to 65535", () => {
    expect(ok({ ...split, ADMIN_PORT: "1" }).config.admin?.port).toBe(1);
    expect(ok({ ...split, ADMIN_PORT: "65535" }).config.admin?.port).toBe(65535);
    for (const bad of ["0", "65536", "30.5", "abc", "-1", "3001 3002"]) {
      expect(errors({ ...split, ADMIN_PORT: bad })).toEqual([
        expect.stringContaining("ADMIN_PORT must be a port number"),
      ]);
    }
  });

  it("must differ from the public port", () => {
    expect(errors({ ...split, ADMIN_PORT: "3000" })).toEqual([
      expect.stringContaining("ADMIN_PORT must differ from the public port 3000"),
    ]);
  });

  it("needs ADMIN_TOKEN until another way to log in exists", () => {
    expect(errors({ ...minimal, ADMIN_PORT: "3001" })).toEqual([
      "ADMIN_PORT needs ADMIN_TOKEN: the admin pages need a way to log in.",
    ]);
  });

  it("takes an IP address or a host name as ADMIN_BIND", () => {
    for (const bind of ["0.0.0.0", "::1", "192.168.1.5", "localhost", "admin.internal"]) {
      expect(ok({ ...split, ADMIN_BIND: bind }).config.admin?.bind).toBe(bind);
    }
    expect(ok({ ...split, ADMIN_BIND: "[::1]" }).config.admin?.bind).toBe("::1");
  });

  it("refuses garbage as ADMIN_BIND", () => {
    for (const bad of [
      "not an address",
      "a b",
      "http://0.0.0.0",
      "-bad.example",
      "1.2.3",
      "a_b",
      "::g",
    ]) {
      expect(errors({ ...split, ADMIN_BIND: bad })).toEqual([
        expect.stringContaining("ADMIN_BIND must be an IP address or a host name"),
      ]);
    }
  });

  it("refuses ADMIN_BIND and ADMIN_URL without ADMIN_PORT", () => {
    expect(errors({ ...minimal, ADMIN_BIND: "0.0.0.0" })).toEqual(["ADMIN_BIND needs ADMIN_PORT."]);
    expect(errors({ ...minimal, ADMIN_URL: "https://admin.example.org" })).toEqual([
      "ADMIN_URL needs ADMIN_PORT.",
    ]);
  });

  it("takes ADMIN_URL as an origin", () => {
    const url = ok({ ...split, ADMIN_URL: "https://admin.example.org" }).config.admin?.url;
    expect(url?.origin).toBe("https://admin.example.org");
    expect(
      ok({ ...split, ADMIN_URL: "https://admin.example.org:8443/" }).config.admin?.url?.origin,
    ).toBe("https://admin.example.org:8443");
  });

  it("refuses an ADMIN_URL with path, query, fragment or credentials", () => {
    for (const bad of [
      "https://admin.example.org/admin",
      "https://admin.example.org/?a=1",
      "https://admin.example.org/#x",
      "https://user:pw@admin.example.org",
      "ftp://admin.example.org",
      "nope",
    ]) {
      expect(errors({ ...split, ADMIN_URL: bad })).toEqual([expect.stringContaining("ADMIN_URL")]);
    }
  });

  const HTTPS_RULE =
    "ADMIN_URL must use HTTPS unless it is localhost, a loopback or private-network IP address, or ALLOW_INSECURE_DEV=true (development only).";

  it("takes http for ADMIN_URL on loopback and private-network addresses", () => {
    for (const host of [
      "localhost:3105",
      "127.0.0.1:3105",
      "127.5.6.7",
      "[::1]:3105",
      "10.0.0.5:3105",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255:3105",
      "192.168.1.5:3105",
      "[fc00::1]",
      "[fd12:3456:789a::1]:3105",
      "169.254.10.20",
    ]) {
      expect([
        host,
        ok({ ...split, ADMIN_URL: `http://${host}` }).config.admin?.url?.origin,
      ]).toEqual([host, `http://${host}`]);
    }
  });

  it("relies on URL normalisation for loopback spellings and mapped IPv6 addresses", () => {
    for (const host of ["0x7f.1:3001", "127.1:3001", "2130706433:3001", "LOCALHOST:3001"]) {
      expect([
        host,
        ok({ ...split, ADMIN_URL: `http://${host}` }).config.admin?.url?.protocol,
      ]).toEqual([host, "http:"]);
    }
    for (const host of ["[::ffff:10.0.0.1]:3001", "localhost.evil.example:3001"]) {
      expect([host, errors({ ...split, ADMIN_URL: `http://${host}` })]).toEqual([
        host,
        [HTTPS_RULE],
      ]);
    }
  });

  it("needs HTTPS for ADMIN_URL on any other address, except in development mode", () => {
    for (const host of [
      "admin.example.org",
      "localhost.example.org",
      "10.example.org",
      "8.8.8.8",
      "11.0.0.1",
      "172.15.255.255",
      "172.32.0.1",
      "192.169.0.1",
      "169.253.1.1",
      "128.0.0.1",
      "[2001:db8::1]",
      "[fe00::1]",
      "[fb00::1]",
      "[::ffff:808:808]",
    ]) {
      expect([host, errors({ ...split, ADMIN_URL: `http://${host}` })]).toEqual([
        host,
        [HTTPS_RULE],
      ]);
      expect(ok({ ...split, ADMIN_URL: `https://${host}` }).config.admin?.url?.protocol).toBe(
        "https:",
      );
    }
    expect(
      ok({ ...split, ADMIN_URL: "http://admin.example.org", ALLOW_INSECURE_DEV: "true" }).config
        .admin?.url?.origin,
    ).toBe("http://admin.example.org");
  });
});

describe("PUBLIC_REQUIRES_LOGIN (spec 7 Visibility and Nearby plans)", () => {
  it("requires an account for public plans unless turned off", () => {
    expect(ok(minimal).config.publicRequiresLogin).toBe(true);
    expect(ok({ ...minimal, PUBLIC_REQUIRES_LOGIN: "false" }).config.publicRequiresLogin).toBe(
      false,
    );
    expect(errors({ ...minimal, PUBLIC_REQUIRES_LOGIN: "no" })).toEqual([
      'PUBLIC_REQUIRES_LOGIN must be "true" or "false", got "no".',
    ]);
  });
});

describe("FEDERATION_ENABLED (spec 7 ActivityPub)", () => {
  it("is on unless turned off", () => {
    expect(ok(minimal).config.federationEnabled).toBe(true);
    expect(ok({ ...minimal, FEDERATION_ENABLED: "false" }).config.federationEnabled).toBe(false);
  });
});

describe("NEARBY_ENABLED (spec 7 Visibility and Nearby plans)", () => {
  it("is on unless turned off", () => {
    expect(ok(minimal).config.nearbyEnabled).toBe(true);
    expect(ok({ ...minimal, NEARBY_ENABLED: "false" }).config.nearbyEnabled).toBe(false);
  });
});

describe("PALETTE (decision 004)", () => {
  it("is default unless set", () => {
    expect(ok(minimal).config.palette).toBe("default");
    expect(ok({ ...minimal, PALETTE: "" }).config.palette).toBe("default");
  });

  it("accepts the shipped palettes", () => {
    expect(ok({ ...minimal, PALETTE: "default" }).config.palette).toBe("default");
    expect(ok({ ...minimal, PALETTE: "mono" }).config.palette).toBe("mono");
    expect(ok({ ...minimal, PALETTE: "bold" }).config.palette).toBe("bold");
    expect(ok({ ...minimal, PALETTE: "archivo" }).config.palette).toBe("archivo");
  });

  it("rejects an unknown palette", () => {
    expect(errors({ ...minimal, PALETTE: "neon" }).join(" ")).toContain(
      "PALETTE must be default, mono, bold or archivo.",
    );
    expect(errors({ ...minimal, PALETTE: "Bold" }).join(" ")).toContain("PALETTE must be");
  });
});

describe("POSTING_MODE (spec 7 Moderation)", () => {
  it("lets anyone post by default", () => {
    expect(ok(minimal).config.postingMode).toBe("anyone");
    expect(ok({ ...minimal, POSTING_MODE: "anyone" }).config.postingMode).toBe("anyone");
  });

  it("accepts invite, which needs ADMIN_TOKEN, since only the admin creates invite links", () => {
    const token = "x".repeat(32);
    expect(ok({ ...minimal, POSTING_MODE: "invite", ADMIN_TOKEN: token }).config.postingMode).toBe(
      "invite",
    );
    expect(errors({ ...minimal, POSTING_MODE: "invite" })).toEqual([
      "POSTING_MODE=invite needs ADMIN_TOKEN (or ADMIN_INGRESS in the Home Assistant app): only the instance admin can create invite links.",
    ]);
  });

  it("accepts logged_in, which needs a way to log in", () => {
    expect(ok({ ...minimal, ...OIDC, POSTING_MODE: "logged_in" }).config.postingMode).toBe(
      "logged_in",
    );
    for (const env of [{}, { OIDC_ISSUER: "" }]) {
      expect(errors({ ...minimal, ...env, POSTING_MODE: "logged_in" })).toEqual([
        "POSTING_MODE=logged_in needs a way to log in: set OIDC_ISSUER and OIDC_CLIENT_ID, or FEDIVERSE_LOGIN=true.",
      ]);
    }
  });

  it("refuses other values", () => {
    for (const value of ["Invite", "nobody", "logged-in"]) {
      expect(errors({ ...minimal, POSTING_MODE: value })).toEqual([
        "POSTING_MODE must be anyone, invite or logged_in.",
      ]);
    }
  });
});

const OIDC = { OIDC_ISSUER: "https://id.example.org/realms/club", OIDC_CLIENT_ID: "rendezroute" };

describe("FEDIVERSE_LOGIN and FEDIVERSE_LOGIN_SERVERS (spec 7 Identity, decision D24)", () => {
  it("is off unless turned on, and then accepts any server", () => {
    expect(ok(minimal).config.fediverseLogin).toBeUndefined();
    expect(ok({ ...minimal, FEDIVERSE_LOGIN: "false" }).config.fediverseLogin).toBeUndefined();
    expect(ok({ ...minimal, FEDIVERSE_LOGIN: "true" }).config.fediverseLogin).toEqual({
      servers: undefined,
    });
  });

  it("can be limited to a list of servers, given as domains", () => {
    const limited = ok({
      ...minimal,
      FEDIVERSE_LOGIN: "true",
      FEDIVERSE_LOGIN_SERVERS: " Club.Example , mastodon.social,",
    });
    expect(limited.config.fediverseLogin).toEqual({
      servers: ["club.example", "mastodon.social"],
    });
  });

  it("refuses a server list without FEDIVERSE_LOGIN=true, and entries that are not domains", () => {
    expect(errors({ ...minimal, FEDIVERSE_LOGIN_SERVERS: "club.example" })).toEqual([
      "FEDIVERSE_LOGIN_SERVERS needs FEDIVERSE_LOGIN=true.",
    ]);
    expect(
      errors({
        ...minimal,
        FEDIVERSE_LOGIN: "true",
        FEDIVERSE_LOGIN_SERVERS: "club.example, https://x.example/path, 10.0.0.1",
      }),
    ).toEqual([
      'FEDIVERSE_LOGIN_SERVERS must list domains such as mastodon.social, got "https://x.example/path".',
      'FEDIVERSE_LOGIN_SERVERS must list domains such as mastodon.social, got "10.0.0.1".',
    ]);
  });

  it("refuses a list without domains, and takes local servers with ports in development", () => {
    expect(errors({ ...minimal, FEDIVERSE_LOGIN: "true", FEDIVERSE_LOGIN_SERVERS: " , " })).toEqual(
      ["FEDIVERSE_LOGIN_SERVERS must list at least one domain."],
    );
    const dev = ok({
      ...minimal,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
      FEDIVERSE_LOGIN: "true",
      FEDIVERSE_LOGIN_SERVERS: "localhost:9001",
    });
    expect(dev.config.fediverseLogin).toEqual({ servers: ["localhost:9001"] });
  });

  it("is a way to log in for POSTING_MODE=logged_in", () => {
    expect(
      ok({ ...minimal, FEDIVERSE_LOGIN: "true", POSTING_MODE: "logged_in" }).config.postingMode,
    ).toBe("logged_in");
  });
});

describe("OIDC_* (spec 7 Identity)", () => {
  it("is off unless an issuer and client ID are set", () => {
    expect(ok(minimal).config.oidc).toBeUndefined();
  });

  it("takes the issuer, client, optional secret and a name for the login button", () => {
    expect(ok({ ...minimal, ...OIDC }).config.oidc).toEqual({
      issuer: new URL("https://id.example.org/realms/club"),
      clientId: "rendezroute",
      clientSecret: undefined,
      name: "id.example.org",
    });
    const named = ok({
      ...minimal,
      ...OIDC,
      OIDC_CLIENT_SECRET: "s3cret",
      OIDC_NAME: "Club login",
    });
    expect(named.config.oidc).toMatchObject({ clientSecret: "s3cret", name: "Club login" });
  });

  it("needs issuer and client ID together", () => {
    expect(errors({ ...minimal, OIDC_ISSUER: OIDC.OIDC_ISSUER })).toEqual([
      "OIDC_ISSUER and OIDC_CLIENT_ID must be set together.",
    ]);
    expect(errors({ ...minimal, OIDC_CLIENT_ID: "x", OIDC_CLIENT_SECRET: "y" })).toEqual([
      "OIDC_ISSUER and OIDC_CLIENT_ID must be set together.",
    ]);
  });

  it("needs an HTTPS issuer without credentials, query or fragment, and a short name", () => {
    for (const issuer of [
      "http://id.example.org",
      "https://user:pw@id.example.org",
      "https://id.example.org/?x=1",
      "https://id.example.org/#x",
      "id.example.org",
    ]) {
      expect(errors({ ...minimal, ...OIDC, OIDC_ISSUER: issuer })).toEqual([
        expect.stringContaining("OIDC_ISSUER"),
      ]);
    }
    expect(errors({ ...minimal, ...OIDC, OIDC_NAME: "x".repeat(41) })).toEqual([
      "OIDC_NAME must be 1–40 characters.",
    ]);
  });

  it("allows a plain-HTTP issuer in development mode, for a local fake provider", () => {
    const dev = ok({
      ...minimal,
      ...OIDC,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
      OIDC_ISSUER: "http://localhost:9000",
    });
    expect(dev.config.oidc?.issuer.href).toBe("http://localhost:9000/");
  });
});

describe("BASE_URL", () => {
  it("is required", () => {
    expect(errors({})).toEqual([expect.stringContaining("BASE_URL is required")]);
  });

  it("must be a valid URL", () => {
    expect(errors({ ...minimal, BASE_URL: "runs.example.org" })).toEqual([
      expect.stringContaining("BASE_URL"),
    ]);
  });

  it("must be a bare origin without path, query or fragment", () => {
    for (const url of [
      "https://example.org/runs",
      "https://example.org/?a=1",
      "https://example.org/#x",
    ]) {
      expect(errors({ ...minimal, BASE_URL: url })).toEqual([expect.stringContaining("BASE_URL")]);
    }
    expect(ok({ ...minimal, BASE_URL: "https://example.org/" }).config.baseUrl.href).toBe(
      "https://example.org/",
    );
  });

  it("must not contain credentials", () => {
    expect(errors({ ...minimal, BASE_URL: "https://user:pw@runs.example.org" })).toEqual([
      expect.stringContaining("credentials"),
    ]);
  });

  it("must use HTTPS (spec section 11)", () => {
    expect(errors({ ...minimal, BASE_URL: "http://runs.example.org" })).toEqual([
      expect.stringContaining("HTTPS"),
    ]);
  });

  it("may use HTTP when ALLOW_INSECURE_DEV=true, with a development-mode warning", () => {
    const { config, warnings } = ok({
      ...minimal,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
    });
    expect(config.allowInsecureDev).toBe(true);
    expect(config.baseUrl.href).toBe("http://localhost:3000/");
    expect(warnings).toEqual([expect.stringContaining("development mode")]);
  });
});

describe("E2E_CLOCK_CONTROL (decision D87)", () => {
  const dev = { ...minimal, ALLOW_INSECURE_DEV: "true" };

  it("is off by default, also in development mode", () => {
    expect(ok(minimal).config.e2eClockControl).toBe(false);
    expect(ok(dev).config.e2eClockControl).toBe(false);
    expect(ok({ ...dev, E2E_CLOCK_CONTROL: "false" }).config.e2eClockControl).toBe(false);
  });

  it("is accepted with ALLOW_INSECURE_DEV=true, with a warning", () => {
    const { config, warnings } = ok({ ...dev, E2E_CLOCK_CONTROL: "true" });
    expect(config.e2eClockControl).toBe(true);
    expect(warnings).toContainEqual(expect.stringContaining("E2E_CLOCK_CONTROL=true"));
  });

  it("is refused without ALLOW_INSECURE_DEV, naming both settings", () => {
    for (const extra of [{}, { ALLOW_INSECURE_DEV: "false" }]) {
      const found = errors({ ...minimal, ...extra, E2E_CLOCK_CONTROL: "true" });
      expect(found).toEqual([
        expect.stringMatching(
          /E2E_CLOCK_CONTROL.*ALLOW_INSECURE_DEV|ALLOW_INSECURE_DEV.*E2E_CLOCK_CONTROL/,
        ),
      ]);
    }
  });

  it("is refused for values other than true or false, also in development mode", () => {
    for (const bad of ["1", "yes", "TRUE", ""]) {
      expect(errors({ ...dev, E2E_CLOCK_CONTROL: bad })).toEqual([
        expect.stringContaining("E2E_CLOCK_CONTROL"),
      ]);
    }
  });
});

describe("booleans", () => {
  it.each([
    "TRUST_PROXY",
    "MAPS_ENABLED",
    "GEOCODER_ENABLED",
    "WEATHER_ENABLED",
    "ALLOW_INSECURE_DEV",
    "E2E_CLOCK_CONTROL",
  ])("%s accepts only true or false", (name) => {
    expect(errors({ ...minimal, [name]: "yes" })).toEqual([expect.stringContaining(name)]);
    expect(() => ok({ ...minimal, [name]: "false" })).not.toThrow();
  });

  it("reads TRUST_PROXY", () => {
    expect(ok({ ...minimal, TRUST_PROXY: "true" }).config.trustProxy).toBe(true);
  });
});

describe("limits that may only be lowered", () => {
  it.each([
    ["MAX_RETENTION_DAYS", 30, "maxRetentionDays"],
    ["MAX_PLAN_HORIZON_DAYS", 180, "maxPlanHorizonDays"],
  ] as const)("%s accepts whole numbers from 1 to %i", (name, max, key) => {
    expect(ok({ ...minimal, [name]: "1" }).config[key]).toBe(1);
    expect(ok({ ...minimal, [name]: String(max) }).config[key]).toBe(max);
    for (const bad of ["0", String(max + 1), "7.5", "abc", ""]) {
      expect(errors({ ...minimal, [name]: bad })).toEqual([expect.stringContaining(name)]);
    }
  });
});

describe("DEFAULT_TIMEZONE", () => {
  it("accepts IANA zones", () => {
    expect(ok({ ...minimal, DEFAULT_TIMEZONE: "Europe/Berlin" }).config.defaultTimezone).toBe(
      "Europe/Berlin",
    );
  });

  it("rejects UTC offsets, which are not IANA zones", () => {
    for (const zone of ["+01:00", "-0530"]) {
      expect(errors({ ...minimal, DEFAULT_TIMEZONE: zone })).toEqual([
        expect.stringContaining("DEFAULT_TIMEZONE"),
      ]);
    }
  });

  it("canonicalizes zone names", () => {
    expect(ok({ ...minimal, DEFAULT_TIMEZONE: "utc" }).config.defaultTimezone).toBe("UTC");
  });

  it("rejects unknown zones", () => {
    expect(errors({ ...minimal, DEFAULT_TIMEZONE: "Mars/Olympus_Mons" })).toEqual([
      expect.stringContaining("DEFAULT_TIMEZONE"),
    ]);
  });
});

describe("DEFAULT_MAP_CENTER and DEFAULT_MAP_ZOOM (decision D63)", () => {
  const center = (value: string) => ok({ ...minimal, DEFAULT_MAP_CENTER: value }).config.defaultMap;

  it("has no center and zoom 6 by default", () => {
    expect(ok(minimal).config.defaultMap).toEqual({ center: undefined, zoom: 6 });
  });

  it("accepts a center and a zoom", () => {
    const { defaultMap } = ok({
      ...minimal,
      DEFAULT_MAP_CENTER: "48.1374,11.5755",
      DEFAULT_MAP_ZOOM: "9",
    }).config;
    expect(defaultMap).toEqual({ center: { lat: 48.1374, lng: 11.5755 }, zoom: 9 });
  });

  it("accepts spaces around the comma, negative numbers and whole numbers", () => {
    expect(center(" 48.1374 , 11.5755 ").center).toEqual({ lat: 48.1374, lng: 11.5755 });
    expect(center("-33.87,151.21").center).toEqual({ lat: -33.87, lng: 151.21 });
    expect(center("90,-180").center).toEqual({ lat: 90, lng: -180 });
    expect(center("0,0").center).toEqual({ lat: 0, lng: 0 });
  });

  it("accepts the zoom limits 2 and 12", () => {
    for (const zoom of [2, 12]) {
      const { defaultMap } = ok({ ...minimal, DEFAULT_MAP_ZOOM: String(zoom) }).config;
      expect(defaultMap.zoom).toBe(zoom);
    }
  });

  it("treats an empty center as not set", () => {
    expect(center("").center).toBeUndefined();
    expect(center("   ").center).toBeUndefined();
  });

  it("accepts a zoom without a center, which is then not used", () => {
    // The zoom only goes with the operator's center: without one the form follows the browser's
    // time zone at zoom 6 (the client ignores the zoom then).
    const { defaultMap } = ok({ ...minimal, DEFAULT_MAP_ZOOM: "9" }).config;
    expect(defaultMap).toEqual({ center: undefined, zoom: 9 });
  });

  it("rejects a center that is not exactly two numbers in range, naming the setting", () => {
    for (const bad of [
      "Berlin",
      "48.1374",
      "48.1,11.5,100",
      "91,0",
      "-91,0",
      "0,181",
      "0,-181",
      "48.1374;11.5755",
      "48.1374 11.5755",
      "48.1374,11.5755 east",
      "lat 48.1,11.5",
      "48.1,",
      ",11.5",
      "1e1,5",
    ]) {
      expect(errors({ ...minimal, DEFAULT_MAP_CENTER: bad })).toEqual([
        expect.stringContaining("DEFAULT_MAP_CENTER"),
      ]);
    }
  });

  it("rejects a zoom that is not a whole number from 2 to 12, naming the setting", () => {
    for (const bad of ["1", "13", "6.5", "abc", "0", "-3"]) {
      expect(errors({ ...minimal, DEFAULT_MAP_ZOOM: bad })).toEqual([
        expect.stringContaining("DEFAULT_MAP_ZOOM"),
      ]);
    }
  });

  it("treats an empty zoom as not set", () => {
    expect(ok({ ...minimal, DEFAULT_MAP_ZOOM: "" }).config.defaultMap.zoom).toBe(6);
  });
});

describe("INSTANCE_NAME", () => {
  it("is trimmed", () => {
    expect(ok({ ...minimal, INSTANCE_NAME: "  Isar Runners " }).config.instanceName).toBe(
      "Isar Runners",
    );
  });

  it("must be 1 to 60 characters", () => {
    expect(errors({ ...minimal, INSTANCE_NAME: "   " })).toEqual([
      expect.stringContaining("INSTANCE_NAME"),
    ]);
    expect(errors({ ...minimal, INSTANCE_NAME: "x".repeat(61) })).toEqual([
      expect.stringContaining("INSTANCE_NAME"),
    ]);
  });
});

describe("paths", () => {
  it("require absolute DATA_DIR and ENCRYPTION_KEY_FILE", () => {
    expect(errors({ ...minimal, DATA_DIR: "data" })).toEqual([expect.stringContaining("DATA_DIR")]);
    expect(errors({ ...minimal, ENCRYPTION_KEY_FILE: "keys/field.key" })).toEqual([
      expect.stringContaining("ENCRYPTION_KEY_FILE"),
    ]);
    const { config } = ok({
      ...minimal,
      DATA_DIR: "/srv/rr",
      ENCRYPTION_KEY_FILE: "/secrets/field.key",
    });
    expect(config.dataDir).toBe("/srv/rr");
    expect(config.encryptionKeyFile).toBe("/secrets/field.key");
  });
});

describe("CONTACT_EMAIL (spec section 10)", () => {
  it("must look like an email address", () => {
    expect(errors({ ...minimal, CONTACT_EMAIL: "owner" })).toEqual([
      expect.stringContaining("CONTACT_EMAIL"),
    ]);
  });

  it("when unset, disables geocoding and server-side tile fetching with a warning", () => {
    const { config, warnings } = ok({ BASE_URL: minimal.BASE_URL });
    expect(config.contactEmail).toBeUndefined();
    expect(config.geocoder.enabled).toBe(false);
    expect(config.maps.enabled).toBe(true);
    expect(config.maps.serverSideTiles).toBe(false);
    expect(warnings).toEqual([expect.stringContaining("CONTACT_EMAIL")]);
  });

  it("when unset, warns only about services that are enabled", () => {
    const { warnings } = ok({
      BASE_URL: minimal.BASE_URL,
      MAPS_ENABLED: "false",
      GEOCODER_ENABLED: "false",
    });
    expect(warnings).toEqual([]);
  });
});

describe("external services (spec 3.9)", () => {
  it("can each be disabled", () => {
    const { config } = ok({
      ...minimal,
      MAPS_ENABLED: "false",
      GEOCODER_ENABLED: "false",
      WEATHER_ENABLED: "false",
    });
    expect(config.maps.enabled).toBe(false);
    expect(config.maps.serverSideTiles).toBe(false);
    expect(config.geocoder.enabled).toBe(false);
    expect(config.weather.enabled).toBe(false);
  });

  it("can be redirected", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://tiles.example.org/osm/{z}/{x}/{y}.png",
      MAP_ATTRIBUTION: "© Example",
      GEOCODER_URL: "https://geo.example.org/nominatim",
      WEATHER_URL: "https://weather.example.org",
    });
    expect(config.maps.tileUrl).toBe("https://tiles.example.org/osm/{z}/{x}/{y}.png");
    expect(config.maps.tileCspSource).toBe("https://tiles.example.org");
    expect(config.maps.attribution).toBe("© Example");
    expect(config.geocoder.url.href).toBe("https://geo.example.org/nominatim");
    expect(config.weather.url.href).toBe("https://weather.example.org/");
  });

  it("supports a {s} subdomain placeholder in MAP_TILE_URL with a wildcard CSP source", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://{s}.tiles.example.org/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.tiles.example.org");
    expect(config.maps.tileHost).toBe("*.tiles.example.org");
  });

  it("wildcards the whole first host label when it contains {s}", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://tiles-{s}.example.com/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.example.com");
  });

  it("keeps a port in the CSP source", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://{s}.tiles.example.org:8443/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.tiles.example.org:8443");
  });

  it("rejects {s} outside the first host label", () => {
    expect(
      errors({ ...minimal, MAP_TILE_URL: "https://tiles.{s}.example.com/{z}/{x}/{y}.png" }),
    ).toEqual([expect.stringContaining("{s}")]);
  });

  it("rejects credentials in MAP_TILE_URL, which browsers see", () => {
    expect(
      errors({ ...minimal, MAP_TILE_URL: "https://key:secret@tiles.example.org/{z}/{x}/{y}.png" }),
    ).toEqual([expect.stringContaining("credentials")]);
  });

  it("requires {z}, {x} and {y} in MAP_TILE_URL", () => {
    expect(errors({ ...minimal, MAP_TILE_URL: "https://tiles.example.org/{z}/{x}.png" })).toEqual([
      expect.stringContaining("MAP_TILE_URL"),
    ]);
  });

  it("requires a MAP_ATTRIBUTION when maps are enabled", () => {
    expect(errors({ ...minimal, MAP_ATTRIBUTION: " " })).toEqual([
      expect.stringContaining("MAP_ATTRIBUTION"),
    ]);
  });

  it.each(["MAP_TILE_URL", "GEOCODER_URL", "WEATHER_URL"])(
    "%s must use HTTPS outside development mode",
    (name) => {
      const value =
        name === "MAP_TILE_URL" ? "http://tiles.local/{z}/{x}/{y}.png" : "http://service.local";
      expect(errors({ ...minimal, [name]: value })).toEqual([expect.stringContaining(name)]);
      expect(() =>
        ok({
          ...minimal,
          BASE_URL: "http://localhost:3000",
          ALLOW_INSECURE_DEV: "true",
          [name]: value,
        }),
      ).not.toThrow();
    },
  );
});

describe("IMPRINT_URL and PRIVACY_URL", () => {
  it("accept http(s) URLs", () => {
    const { config } = ok({
      ...minimal,
      IMPRINT_URL: "https://club.example.org/imprint",
      PRIVACY_URL: "http://club.example.org/privacy",
    });
    expect(config.imprintUrl?.href).toBe("https://club.example.org/imprint");
    expect(config.privacyUrl?.href).toBe("http://club.example.org/privacy");
  });

  it("reject other schemes", () => {
    expect(errors({ ...minimal, IMPRINT_URL: "javascript:alert(1)" })).toEqual([
      expect.stringContaining("IMPRINT_URL"),
    ]);
  });
});

const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };

describe("SMTP_* (spec 7 Optional notification channels, decision D31)", () => {
  it("is off unless SMTP_HOST is set", () => {
    expect(ok(minimal).config.smtp).toBeUndefined();
  });

  it("uses STARTTLS on port 587 by default, without login", () => {
    expect(ok({ ...minimal, ...SMTP }).config.smtp).toEqual({
      host: "mail.example.org",
      port: 587,
      tls: "starttls",
      auth: undefined,
      from: "runs@example.org",
    });
  });

  it("takes TLS from the start on port 465, another port, and a login", () => {
    expect(
      ok({
        ...minimal,
        ...SMTP,
        SMTP_TLS: "tls",
        SMTP_USER: "runs",
        SMTP_PASSWORD: "s3cret",
      }).config.smtp,
    ).toMatchObject({ port: 465, tls: "tls", auth: { user: "runs", password: "s3cret" } });
    expect(ok({ ...minimal, ...SMTP, SMTP_PORT: "2525" }).config.smtp?.port).toBe(2525);
  });

  it("refuses incomplete or invalid settings", () => {
    expect(errors({ ...minimal, SMTP_FROM: "runs@example.org" })).toEqual([
      "SMTP_FROM, SMTP_PORT, SMTP_TLS, SMTP_USER and SMTP_PASSWORD need SMTP_HOST.",
    ]);
    expect(errors({ ...minimal, SMTP_HOST: "mail.example.org" })).toEqual([
      "SMTP_FROM is required with SMTP_HOST: the address emails are sent from.",
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_FROM: "Runs <runs@example.org>" })).toEqual([
      'SMTP_FROM must be an email address, got "Runs <runs@example.org>".',
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_HOST: "smtp://mail.example.org" })).toEqual([
      'SMTP_HOST must be a host name or IP address, got "smtp://mail.example.org".',
    ]);
    for (const port of ["0", "65536", "25x"]) {
      expect(errors({ ...minimal, ...SMTP, SMTP_PORT: port })).toEqual([
        `SMTP_PORT must be a port number from 1 to 65535, got "${port}".`,
      ]);
    }
    expect(errors({ ...minimal, ...SMTP, SMTP_TLS: "ssl" })).toEqual([
      'SMTP_TLS must be starttls, tls or none, got "ssl".',
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_USER: "runs" })).toEqual([
      "SMTP_USER and SMTP_PASSWORD must be set together.",
    ]);
  });

  it("sends without TLS only in development", () => {
    expect(errors({ ...minimal, ...SMTP, SMTP_TLS: "none" })).toEqual([
      "SMTP_TLS=none needs ALLOW_INSECURE_DEV=true (development only).",
    ]);
    expect(
      ok({
        ...minimal,
        ...SMTP,
        SMTP_TLS: "none",
        ALLOW_INSECURE_DEV: "true",
        BASE_URL: "http://localhost:3000",
      }).config.smtp,
    ).toMatchObject({ port: 25, tls: "none" });
  });
});

describe("NTFY_URL and NTFY_TOKEN (spec 7 Optional notification channels, decision D33)", () => {
  it("is off unless NTFY_URL is set", () => {
    expect(ok(minimal).config.ntfy).toBeUndefined();
  });

  it("takes the server's URL, with a path, and a token for publishing", () => {
    expect(ok({ ...minimal, NTFY_URL: "https://ntfy.example.org" }).config.ntfy).toEqual({
      url: new URL("https://ntfy.example.org/"),
      token: undefined,
    });
    expect(
      ok({ ...minimal, NTFY_URL: "https://example.org/ntfy/", NTFY_TOKEN: "tk_secret" }).config
        .ntfy,
    ).toEqual({ url: new URL("https://example.org/ntfy/"), token: "tk_secret" });
  });

  it("refuses plain http outside development, credentials, a query, and a token alone", () => {
    expect(errors({ ...minimal, NTFY_URL: "http://ntfy.example.org" })).toEqual([
      "NTFY_URL must use HTTPS unless ALLOW_INSECURE_DEV=true (development only).",
    ]);
    expect(errors({ ...minimal, NTFY_URL: "https://user:pw@ntfy.example.org" })).toEqual([
      "NTFY_URL must not contain credentials (user:password@).",
    ]);
    expect(errors({ ...minimal, NTFY_URL: "https://ntfy.example.org/?x=1" })).toEqual([
      "NTFY_URL must not contain a query or fragment.",
    ]);
    expect(errors({ ...minimal, NTFY_TOKEN: "tk_secret" })).toEqual(["NTFY_TOKEN needs NTFY_URL."]);
  });
});

const BOT = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";

describe("TELEGRAM_BOT_TOKEN and TELEGRAM_API_URL (spec 7 Optional notification channels, D34)", () => {
  it("is off unless the bot's token is set, and uses Telegram's API by default", () => {
    expect(ok(minimal).config.telegram).toBeUndefined();
    expect(ok({ ...minimal, TELEGRAM_BOT_TOKEN: BOT }).config.telegram).toEqual({
      token: BOT,
      apiUrl: new URL("https://api.telegram.org/"),
    });
  });

  it("takes another API server, e.g. a local Bot API server", () => {
    expect(
      ok({ ...minimal, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_API_URL: "https://bot-api.example.org" })
        .config.telegram?.apiUrl,
    ).toEqual(new URL("https://bot-api.example.org/"));
  });

  it("refuses a token that is not one, an API URL alone, and plain http outside development", () => {
    expect(errors({ ...minimal, TELEGRAM_BOT_TOKEN: "secret" })).toEqual([
      "TELEGRAM_BOT_TOKEN must be a bot token from @BotFather, such as 123456:ABC-DEF….",
    ]);
    expect(errors({ ...minimal, TELEGRAM_API_URL: "https://bot-api.example.org" })).toEqual([
      "TELEGRAM_API_URL needs TELEGRAM_BOT_TOKEN.",
    ]);
    expect(
      errors({
        ...minimal,
        TELEGRAM_BOT_TOKEN: BOT,
        TELEGRAM_API_URL: "http://bot-api.example.org",
      }),
    ).toEqual([
      "TELEGRAM_API_URL must use HTTPS unless ALLOW_INSECURE_DEV=true (development only).",
    ]);
  });
});

describe("RATING_MIN_PARTICIPANTS", () => {
  it("is 3 unless set", () => {
    expect(ok(minimal).config.ratingMinParticipants).toBe(3);
    expect(ok({ ...minimal, RATING_MIN_PARTICIPANTS: "" }).config.ratingMinParticipants).toBe(3);
  });

  it("accepts whole numbers from 2 to 50", () => {
    for (const value of ["2", "3", "4", "50"]) {
      expect(ok({ ...minimal, RATING_MIN_PARTICIPANTS: value }).config.ratingMinParticipants).toBe(
        Number(value),
      );
    }
  });

  it("refuses to start with anything else, naming the setting", () => {
    for (const value of ["1", "0", "51", "-3", "3.5", "three", "1e1", "003x"]) {
      expect(errors({ ...minimal, RATING_MIN_PARTICIPANTS: value }).join(" ")).toContain(
        `RATING_MIN_PARTICIPANTS must be a whole number from 2 to 50, got "${value}".`,
      );
    }
  });
});
