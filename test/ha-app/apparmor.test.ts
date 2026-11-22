// The Home Assistant app's AppArmor profile (decision D60) as text. Whether it parses is checked
// in CI (the home-assistant-apparmor job, apparmor_parser); what the rules allow is checked on
// real devices. These tests pin the properties the Supervisor and the hardening rely on.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "../..");
const APP = join(ROOT, "homeassistant/rendezroute");
const FILE = join(APP, "apparmor.txt");

/**
 * Step 11c (enforcement) sets this to false and removes `complain` from the profile's flags. It is
 * the only place a test assertion changes: the documentation expectations follow it too.
 */
const COMPLAIN_MODE = false;

/** The prefix of an enforced deny: plain while complain mode would turn `audit deny` into ALLOWED. */
const DENY = COMPLAIN_MODE ? "deny" : "audit deny";

/**
 * Network families denied besides alg and vsock: the first group is what Docker's default profile
 * denies, the second are extra denies. Docker also denies decnet, and mctp is not in its profile;
 * one of the three parsers rejects each of them, so neither is used.
 */
const DOCKER_DEFAULT_FAMILIES = [
  "ax25",
  "ipx",
  "appletalk",
  "netrom",
  "rose",
  "econet",
  "atmsvc",
  "irda",
  "wanpipe",
  "isdn",
  "caif",
];
const EXTRA_FAMILIES = [
  "bridge",
  "x25",
  "netbeui",
  "rds",
  "sna",
  "pppox",
  "llc",
  "ib",
  "mpls",
  "can",
  "tipc",
  "bluetooth",
  "iucv",
  "rxrpc",
  "phonet",
  "ieee802154",
  "nfc",
  "kcm",
  "smc",
  "xdp",
];

const exists = existsSync(FILE);
const text = exists ? readFileSync(FILE, "utf8") : "";
/** The rules only: comments and include lines dropped, so prose cannot satisfy an assertion. */
const rules = text
  .split("\n")
  .map((line) => line.replace(/#.*$/, "").trim())
  .filter((line) => line !== "" && !line.startsWith("profile ") && line !== "}");
const hasRule = (rule: string): boolean => rules.includes(rule);

interface FileRule {
  deny: boolean;
  glob: string;
  perms: string;
}

/** `[audit] [deny] [owner] <path> <perms>,` rules (a path starts with / or @{). */
const fileRules: FileRule[] = rules.flatMap((line) => {
  const match = /^(?:audit\s+)?(deny\s+)?(?:owner\s+)?(\/\S*|@\{\S+)\s+([a-zA-Z]+),$/.exec(line);
  return match
    ? [{ deny: match[1] !== undefined, glob: match[2] ?? "", perms: match[3] ?? "" }]
    : [];
});

/** AppArmor globs: ** crosses slashes, * does not; @{PROC} is /proc/ and @{pid} a number. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace("@{PROC}/", "/proc/")
    .replace("@{pid}", "123")
    .replace("@{tid}", "123")
    .replace(/[.+^$()|\\]/g, (c) => `\\${c}`)
    .replace(/\*\*/g, "<<ANY>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<ANY>>/g, ".*")
    .replace(/\{([^}]*)\}/g, (_, list: string) => `(${list.split(",").join("|")})`);
  return new RegExp(`^${source}$`);
}
/** Whether some deny rule forbids `permission` on `path`. */
const denied = (path: string, permission: string): boolean =>
  fileRules.some(
    (rule) => rule.deny && rule.perms.includes(permission) && globToRegExp(rule.glob).test(path),
  );
/** Whether some allow rule grants `permission` on `path`. */
const allowed = (path: string, permission: string): boolean =>
  fileRules.some(
    (rule) => !rule.deny && rule.perms.includes(permission) && globToRegExp(rule.glob).test(path),
  );

describe("the AppArmor profile", () => {
  it("is in the app folder, which the Supervisor reads from the store repository", () => {
    expect(exists).toBe(true);
  });

  it("starts with the tunables include", () => {
    expect(text.split("\n").find((line) => !/^#(?!include)/.test(line) && line.trim() !== "")).toBe(
      "#include <tunables/global>",
    );
  });

  it("has exactly one top-level profile, named rendezroute, and no nested ones", () => {
    expect(text.match(/^profile /gm)).toHaveLength(1);
    expect(text).toMatch(/^profile rendezroute flags=\([a-z_,]*attach_disconnected[a-z_,]*\) \{$/m);
    expect(text).toMatch(/^profile rendezroute flags=\([a-z_,]*mediate_deleted[a-z_,]*\) \{$/m);
    // A nested profile must be indented; there is none (the Supervisor needs a single name).
    expect(text.match(/^[ \t]+profile /gm)).toBeNull();
    expect(text.match(/^[ \t]*\^/gm)).toBeNull();
  });

  it("is in complain mode exactly as long as COMPLAIN_MODE says (step 11c flips it)", () => {
    const flags = /^profile rendezroute flags=\(([^)]*)\)/m.exec(text)?.[1]?.split(",") ?? [];
    expect(flags.includes("complain")).toBe(COMPLAIN_MODE);
    expect(flags).not.toContain("unconfined");
    expect(flags).not.toContain("audit");
  });

  it("allows executing Node only, and has no s6, shell or profile-transition rule", () => {
    // Every non-deny file rule whose permissions contain x (any case: ix, rix, mrix, Px, cx ...)
    // must be Node's.
    const executable = fileRules.filter((rule) => !rule.deny && /x/i.test(rule.perms));
    expect(executable.map((rule) => rule.glob)).toEqual(["/usr/local/bin/node"]);
    expect(executable[0]?.perms).toBe("ix");
    expect(rules.filter((line) => /\bchange_profile\b|->/.test(line))).toEqual([]);
    expect(rules.filter((line) => /\/init|bashio|\bs6|\/bin\/(ba)?sh/.test(line))).toEqual([]);
  });

  it("allows no blanket rule: no bare file, network, unix or capability, and no /** write", () => {
    for (const bare of ["file,", "network,", "unix,", "capability,", "mount,", "ptrace,"]) {
      expect(rules.filter((line) => line.replace(/^(audit\s+)?/, "") === bare)).toEqual([]);
    }
    const open = fileRules.filter(
      (rule) => !rule.deny && /^\/\*\*|^\/\*$/.test(rule.glob) && /[wal]/.test(rule.perms),
    );
    expect(open).toEqual([]);
  });

  it("asks for no dangerous capability and no allow rule for ptrace", () => {
    const allow = rules.filter((line) => !/^(audit\s+)?deny /.test(line));
    expect(allow.filter((line) => line.startsWith("ptrace"))).toEqual([]);
    const capabilities = allow
      .filter((line) => line.startsWith("capability "))
      .map((line) => line.replace(/,$/, "").replace("capability ", ""))
      .sort();
    // setuid, setgid, chown, fowner and dac_override for the start as root; kill because Docker's
    // init (root) forwards SIGTERM to node (uid 1000). This pins the profile's own lines: the
    // compiled profile also grants net_bind_service through abstractions/nameservice (apparmor_parser
    // -d lists chown dac_override fowner kill net_bind_service setgid setuid), which is harmless.
    expect(capabilities).toEqual(["chown", "dac_override", "fowner", "kill", "setgid", "setuid"]);
  });

  it("only reads the application and its native addons, and denies writing it", () => {
    for (const path of ["/app/x", "/app/dist/server.js", "/app/node_modules/a/b/c.node"]) {
      expect([path, allowed(path, "r")]).toEqual([path, true]);
      for (const permission of ["w", "a", "l", "x", "k"]) {
        expect([path, permission, allowed(path, permission)]).toEqual([path, permission, false]);
      }
      expect([path, denied(path, "w")]).toEqual([path, true]);
    }
    // Native addons are mapped as code, and only those.
    expect(allowed("/app/node_modules/better-sqlite3/build/Release/x.node", "m")).toBe(true);
    expect(allowed("/app/dist/server.js", "m")).toBe(false);
    expect(hasRule(`${DENY} /app/** w,`)).toBe(true);
  });

  it("denies what docker-default denies, which a custom profile would otherwise lose, and more", () => {
    const wanted = [
      // The ones docker-default has:
      "mount,",
      "umount,",
      "network alg,",
      "network vsock,",
      "@{PROC}/* w,",
      "@{PROC}/sys/** w,",
      "@{PROC}/sysrq-trigger rwklx,",
      "@{PROC}/kcore rwklx,",
      "/sys/firmware/** rwklx,",
      "/sys/kernel/security/** rwklx,",
      "/sys/devices/virtual/powercap/** rwklx,",
      // Extra ones:
      "pivot_root,",
      "ptrace,",
      "network inet raw,",
      "network inet6 raw,",
      "network packet,",
      "/app/** w,",
      ...[...DOCKER_DEFAULT_FAMILIES, ...EXTRA_FAMILIES].map((family) => `network ${family},`),
    ];
    for (const rule of wanted) {
      const present = hasRule(`${DENY} ${rule}`);
      expect([rule, present]).toEqual([rule, true]);
    }
    // The old, wider `network raw` is gone: it was not what docker-default has.
    expect(rules.filter((line) => /deny network raw,/.test(line))).toEqual([]);
  });

  it("audits the denies only when enforcing (in complain mode audit turns a deny into ALLOWED)", () => {
    const denies = rules.filter((line) => /(^|\s)deny\s/.test(line));
    expect(denies.length).toBeGreaterThan(20);
    const wrong = denies.filter((line) => line.startsWith("audit ") === COMPLAIN_MODE);
    expect(wrong).toEqual([]);
  });

  it("denies nothing the app writes or reads (a deny beats an allow)", () => {
    for (const path of [
      "/data/x.sqlite",
      "/data/x.sqlite-wal",
      "/config/keys/k",
      "/tmp/a",
      "/var/tmp/a",
    ]) {
      for (const permission of ["r", "w", "k"]) {
        expect([path, permission, denied(path, permission)]).toEqual([path, permission, false]);
      }
    }
    for (const path of ["/proc/meminfo", "/proc/123/mountinfo", "/sys/fs/cgroup/memory.max"]) {
      expect([path, denied(path, "r")]).toEqual([path, false]);
    }
    expect(denied("/proc/sys/vm/x", "w")).toBe(true);
    expect(denied("/proc/sysrq-trigger", "w")).toBe(true);
  });

  it("lets the app write its data and config folders, with locks and no mapped files", () => {
    for (const rule of ["/data/ rw,", "/data/** rwk,", "/config/ rw,", "/config/** rwk,"]) {
      expect([rule, hasRule(rule)]).toEqual([rule, true]);
    }
    for (const path of ["/data/x", "/config/x"]) {
      expect([path, allowed(path, "m")]).toEqual([path, false]);
    }
  });

  it("lets the process read its own mounts after the drop to uid 1000, without an owner rule", () => {
    // After setuid the process is not dumpable and its /proc/<pid> files show uid 0, so an
    // `owner` rule on them would stop matching.
    for (const file of ["mountinfo", "cgroup", "stat", "statm", "status", "limits"]) {
      expect([file, allowed(`/proc/123/${file}`, "r")]).toEqual([file, true]);
    }
    expect(allowed("/proc/123/environ", "r")).toBe(false);
    expect(rules.filter((line) => /@\{PROC\}.*pid/.test(line) && /\bowner\b/.test(line))).toEqual(
      [],
    );
    expect(
      rules.filter((line) => line.includes("/proc/self") || line.includes("@{PROC}/self")),
    ).toEqual([]);
  });

  it("lets SQLite spill temporary files, for the owner only", () => {
    expect(hasRule("owner /tmp/** rwk,")).toBe(true);
    expect(hasRule("owner /var/tmp/** rwk,")).toBe(true);
    expect(fileRules.filter((rule) => !rule.deny && /^\/(var\/)?tmp/.test(rule.glob)).length).toBe(
      2,
    );
  });

  it("allows only the network families the app uses, and no raw sockets", () => {
    const network = rules
      .filter((line) => /^(audit\s+)?(deny\s+)?network /.test(line))
      .filter((line) => !/deny /.test(line));
    // netlink raw: the C library's address lookup (getaddrinfo, getifaddrs); not a packet socket.
    expect(network.sort()).toEqual([
      "network inet dgram,",
      "network inet stream,",
      "network inet6 dgram,",
      "network inet6 stream,",
      "network netlink raw,",
    ]);
  });

  it("allows the Supervisor's unix socket by its path, and says what is left to narrow", () => {
    expect(hasRule("unix (connect, send, receive) type=stream,")).toBe(true);
    // Connecting to a socket with a path is checked as opening it: rw, under both names (the
    // app's mount and the path the Supervisor bound), and nothing else in /run.
    expect(hasRule("/{run/supervisor/api,run/os/supervisor/apps/*}/supervisor.sock rw,")).toBe(
      true,
    );
    for (const path of [
      "/run/supervisor/api/supervisor.sock",
      "/run/os/supervisor/apps/f5d14dfb_rendezroute/supervisor.sock",
    ]) {
      expect([path, allowed(path, "r"), allowed(path, "w")]).toEqual([path, true, true]);
      for (const permission of ["x", "m", "a", "k"]) {
        expect([path, permission, allowed(path, permission)]).toEqual([path, permission, false]);
      }
    }
    for (const path of [
      "/run/other.sock",
      "/run/supervisor/other.sock",
      "/run/supervisor/api/other.sock",
      "/run/os/supervisor/apps/a/b/supervisor.sock",
      "/run/x/supervisor.sock",
    ]) {
      expect([path, allowed(path, "w")]).toEqual([path, false]);
    }
    expect(fileRules.filter((rule) => !rule.deny && /^\/(\{)?run/.test(rule.glob))).toHaveLength(1);
    expect(text).toMatch(/TODO: narrow the unix rule/);
  });

  it("reads what Node, libuv and the C library read at runtime, and writes little", () => {
    const reads = [
      "/etc/localtime",
      "/usr/share/zoneinfo/Europe/Berlin",
      "/proc/stat",
      "/proc/cpuinfo",
      "/proc/uptime",
      "/proc/loadavg",
      "/proc/meminfo",
      "/proc/sys/kernel/ngroups_max",
      "/proc/123/maps",
      "/proc/123/auxv",
      "/sys/devices/system/cpu/online",
      "/sys/fs/cgroup/cpu.max",
      "/etc/passwd",
      "/etc/group",
      "/etc/hosts",
      "/etc/nsswitch.conf",
      "/etc/ssl/openssl.cnf",
    ];
    for (const path of reads) {
      expect([path, "r", allowed(path, "r")]).toEqual([path, "r", true]);
      for (const permission of ["w", "a", "x", "m"]) {
        expect([path, permission, allowed(path, permission)]).toEqual([path, permission, false]);
      }
    }
    // The one write outside /data, /config and the temp folders: Node naming its threads.
    expect(allowed("/proc/123/task/123/comm", "w")).toBe(true);
    expect(allowed("/proc/123/oom_score_adj", "w")).toBe(false);
    expect(allowed("/proc/123/mem", "r")).toBe(false);
    const writes = fileRules.filter((rule) => !rule.deny && /[wa]/.test(rule.perms));
    expect(writes.map((rule) => rule.glob).sort()).toEqual(
      [
        "/config/",
        "/config/**",
        "/data/",
        "/data/**",
        "/tmp/**",
        "/var/tmp/**",
        "/{run/supervisor/api,run/os/supervisor/apps/*}/supervisor.sock",
        "@{PROC}/@{pid}/task/@{tid}/comm",
      ].sort(),
    );
  });

  it("pins the AppArmor ABI", () => {
    expect(text).toMatch(/^abi <abi\/3\.0>,$/m);
  });
});

describe("the profile and the rest of the app", () => {
  it("leaves the apparmor key out of config.yaml (the linter rejects the default true)", () => {
    const config = parse(readFileSync(join(APP, "config.yaml"), "utf8")) as Record<string, unknown>;
    expect(config).not.toHaveProperty("apparmor");
  });

  it("is not needed in the image: the Supervisor reads it from the store repository", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).not.toMatch(/apparmor/i);
    // The Docker build context excludes the app folder, which is fine for the same reason.
    expect(readFileSync(join(ROOT, ".dockerignore"), "utf8")).toMatch(/^homeassistant$/m);
  });

  it("describes the profile honestly in the documentation, as long as it says what it does", () => {
    const docs = readFileSync(join(APP, "DOCS.md"), "utf8").replace(/\s+/g, " ");
    const changelog = readFileSync(join(APP, "CHANGELOG.md"), "utf8").replace(/\s+/g, " ");
    // "Blocks nothing" is false in either mode: the deny rules are enforced even in complain mode.
    expect(docs).not.toContain("blocks nothing");
    expect(changelog).not.toContain("blocks nothing");
    expect(text).not.toMatch(/blocks nothing/i);
    expect(docs).not.toContain("Docker's default AppArmor profile");
    expect(docs).toContain("AppArmor profile");
    // The complain wording appears exactly while the profile is in complain mode, the enforcing
    // wording exactly when it is not.
    const complainWords = ["complain mode", "only logged", "not stricter than Docker's default"];
    const enforceWords = [
      "enforces",
      "DENIED",
      "learning-mode version of this profile ran on one device",
      "has not run anywhere yet",
      "restore the backup",
    ];
    const present = (words: string[]) => words.map((word) => docs.includes(word));
    expect(present(complainWords)).toEqual(complainWords.map(() => COMPLAIN_MODE));
    expect(present(enforceWords)).toEqual(enforceWords.map(() => !COMPLAIN_MODE));
    const section = changelog.slice(changelog.indexOf("## 0.11.1"), changelog.indexOf("## 0.11.0"));
    expect(section.includes("enforces")).toBe(!COMPLAIN_MODE);
  });

  it("is version 0.18.13 (the 0.11.1 flip to enforcement is kept) with its changelog", () => {
    const config = parse(readFileSync(join(APP, "config.yaml"), "utf8")) as Record<string, unknown>;
    expect(config.version).toBe("0.18.13");
  });
});
