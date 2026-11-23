// The Home Assistant app folder (decisions D57, I76) against the code it configures: the schema
// names exactly the options the mapper accepts, secrets are password fields, the defaults and the
// limits agree with the configuration, the identity agrees everywhere, and nothing is set to a
// value the linter (frenck/action-addon-linter) rejects as a default. The Supervisor's schemas
// run in CI via scripts/validate-ha-app.py and the linter job; these tests cover what neither
// checks.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { loadConfig, MAX_INSTANCE_NAME_LENGTH, MAX_OIDC_NAME_LENGTH } from "../../src/config.ts";
import {
  FIXED_ENVIRONMENT,
  type HaOptionKind,
  HA_OPTION_KINDS,
  HA_OPTION_NAMES,
  mapHomeAssistantOptions,
} from "../../src/adapters/in/ha/options.ts";

const ROOT = join(import.meta.dirname, "../..");
const APP = join(ROOT, "homeassistant/rendezroute");

type Yaml = Record<string, unknown>;

function yamlFile(path: string): Yaml {
  const parsed: unknown = parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a mapping`);
  }
  return parsed as Yaml;
}

const config = yamlFile(join(APP, "config.yaml"));
const schema = config.schema as Record<string, string | string[]>;
const options = config.options as Record<string, unknown>;

/**
 * The linter's config.schema.json gives these keys a default, and the linter rejects a key that
 * is set to it. `hassio_api` is listed although the app sets it to true: only false is rejected.
 */
const LINTER_DEFAULTS: Readonly<Record<string, unknown>> = {
  advanced: false,
  apparmor: true,
  audio: false,
  auth_api: false,
  auto_uart: false,
  backup: "hot",
  boot: "auto",
  devicetree: false,
  docker_api: false,
  full_access: false,
  gpio: false,
  hassio_api: false,
  hassio_role: "default",
  homeassistant: false,
  homeassistant_api: false,
  host_dbus: false,
  host_ipc: false,
  host_network: false,
  host_pid: false,
  host_uts: false,
  ingress: false,
  ingress_port: 8099,
  ingress_stream: false,
  init: true,
  journald: false,
  kernel_modules: false,
  legacy: false,
  log_format: "plain",
  options: {},
  panel_admin: true,
  panel_icon: "mdi:puzzle",
  realtime: false,
  schema: {},
  stage: "stable",
  startup: "application",
  stdin: false,
  timeout: 10,
  tmpfs: false,
  uart: false,
  udev: false,
  ulimits: {},
  usb: false,
  video: false,
};

const SECRETS = ["oidc_client_secret", "smtp_password", "ntfy_token", "telegram_bot_token"];

/** The schema type of an option, as text: a list schema is `[element]`. */
const typeOf = (name: string): string => {
  const type = schema[name];
  return Array.isArray(type) ? `[${type.join(",")}]` : String(type);
};
/** Optional: the type (or a list's element type) ends in `?`. */
const isOptional = (name: string): boolean => /\?\]?$/.test(typeOf(name));
/** Required: not optional and no default (or a null one). */
const isRequired = (name: string): boolean =>
  !isOptional(name) && (options[name] === undefined || options[name] === null);

describe("config.yaml and the options mapper", () => {
  it("has a schema for exactly the options the mapper accepts", () => {
    expect(Object.keys(schema).sort()).toEqual([...HA_OPTION_NAMES].sort());
  });

  it("has defaults only for options in the schema, and none for optional (?) ones", () => {
    const names = Object.keys(options);
    expect(names.filter((name) => !(name in schema))).toEqual([]);
    // A default on a `?` option would make it required (developer docs, options).
    expect(names.filter(isOptional)).toEqual([]);
  });

  it("gives every option a type and a default that fit what the mapper expects", () => {
    const patterns: Record<HaOptionKind, RegExp> = {
      flag: /^bool$/,
      integer: /^(int(\(\d+,\d+\))?|port)$/,
      list: /^\[str\??\]$/,
      text: /^(str|url|email|password|list\([a-z_|]+\))(\(\d+,\d+\))?$/,
    };
    const defaultFits = (kind: HaOptionKind, given: unknown): boolean =>
      kind === "flag"
        ? typeof given === "boolean"
        : kind === "integer"
          ? Number.isInteger(given)
          : kind === "text"
            ? typeof given === "string"
            : false;
    const wrong = Object.entries(HA_OPTION_KINDS).flatMap(([name, kind]) => {
      const type = typeOf(name).replace(/\?$/, "");
      const given = options[name];
      const problems: string[] = [];
      if (!patterns[kind].test(type)) problems.push(`${name}: type ${typeOf(name)} for ${kind}`);
      if (given !== undefined && given !== null && !defaultFits(kind, given)) {
        problems.push(`${name}: default does not fit ${kind}`);
      }
      return problems;
    });
    expect(wrong).toEqual([]);
  });

  it("shows the options a self-hoster sets on day one, and hides the others (decision I78)", () => {
    // The Supervisor hides an optional option without a value behind "Show unused optional
    // configuration options". Pinned by name, so adding or removing one is deliberate.
    const shown = Object.keys(schema).filter((name) => !isOptional(name));
    expect(shown.toSorted()).toEqual(
      [
        "base_url",
        "instance_name",
        "contact_email",
        "imprint_url",
        "privacy_url",
        "default_timezone",
        "maps_enabled",
        "geocoder_enabled",
        "weather_enabled",
        "posting_mode",
        "palette",
        "public_requires_login",
        "nearby_enabled",
        "federation_enabled",
        "fediverse_login",
        "smtp_host",
        "smtp_tls",
        "smtp_user",
        "smtp_password",
        "smtp_from",
        "max_retention_days",
        "max_plan_horizon_days",
        "trust_proxy",
      ].sort(),
    );
    // Every shown option has a default (base_url is the one required option, with a null one).
    expect(shown.filter((name) => name !== "base_url" && options[name] === undefined)).toEqual([]);
  });

  it("gives the free-text options an empty default and a plain type that accepts it", () => {
    const empty = [
      "contact_email",
      "imprint_url",
      "privacy_url",
      "smtp_host",
      "smtp_user",
      "smtp_password",
      "smtp_from",
    ];
    for (const name of empty) expect([name, options[name]]).toEqual([name, ""]);
    // email and url reject "" in the Supervisor (scripts/validate-ha-app.py runs the defaults).
    expect(empty.map(typeOf).sort()).toEqual(["password", ...Array<string>(6).fill("str")].sort());
    expect(options.smtp_tls).toBe("starttls");
    expect(typeOf("smtp_tls")).toBe("list(starttls|tls)");
  });

  it("keeps the default map center and zoom advanced: optional, no default, limits of the configuration (D63)", () => {
    expect(HA_OPTION_KINDS.default_map_center).toBe("text");
    expect(HA_OPTION_KINDS.default_map_zoom).toBe("integer");
    expect(typeOf("default_map_center")).toBe("str?");
    expect(typeOf("default_map_zoom")).toBe("int(2,12)?");
    expect(options).not.toHaveProperty("default_map_center");
    expect(options).not.toHaveProperty("default_map_zoom");
    const set = (given: Record<string, string>) =>
      loadConfig({ BASE_URL: "https://x.example", ...given });
    expect(set({ DEFAULT_MAP_ZOOM: "2" }).ok && set({ DEFAULT_MAP_ZOOM: "12" }).ok).toBe(true);
    expect(set({ DEFAULT_MAP_ZOOM: "1" }).ok || set({ DEFAULT_MAP_ZOOM: "13" }).ok).toBe(false);
  });

  it("keeps the instance cap on new plans advanced: optional, no default, 0 to 200 (0.19.0)", () => {
    expect(HA_OPTION_KINDS.max_new_plans_per_day).toBe("integer");
    expect(typeOf("max_new_plans_per_day")).toBe("int(0,200)?");
    expect(options).not.toHaveProperty("max_new_plans_per_day");
    const loaded = loadConfig({ BASE_URL: "https://x.example", MAX_NEW_PLANS_PER_DAY: "0" });
    expect(loaded.ok && loaded.config.maxNewPlansPerDay).toBe(0);
    expect(loadConfig({ BASE_URL: "https://x.example", MAX_NEW_PLANS_PER_DAY: "201" }).ok).toBe(
      false,
    );
  });

  it("keeps the rating minimum advanced: optional, no default, limits of the configuration", () => {
    expect(HA_OPTION_KINDS.rating_min_participants).toBe("integer");
    expect(typeOf("rating_min_participants")).toBe("int(2,50)?");
    expect(options).not.toHaveProperty("rating_min_participants");
    const set = (given: Record<string, string>) =>
      loadConfig({ BASE_URL: "https://x.example", ...given });
    const ok = (value: string) => set({ RATING_MIN_PARTICIPANTS: value }).ok;
    expect(ok("2") && ok("50")).toBe(true);
    expect(ok("1") || ok("51")).toBe(false);
  });

  it("keeps secrets as password fields, and only secrets", () => {
    const passwords = Object.keys(schema).filter((name) => typeOf(name).startsWith("password"));
    expect(passwords.toSorted()).toEqual([...SECRETS].sort());
  });

  it("requires base_url and nothing else", () => {
    expect(Object.keys(schema).filter(isRequired)).toEqual(["base_url"]);
    expect(typeOf("base_url")).toBe("url");
  });

  it("defaults to what the configuration itself defaults to", () => {
    const mapped = mapHomeAssistantOptions({ ...options, base_url: "https://runs.example.org" });
    if (!mapped.ok) throw new Error(mapped.errors.join(" "));
    const fixed = new Set(Object.keys(FIXED_ENVIRONMENT));
    const fromOptions = Object.fromEntries(
      Object.entries(mapped.env).filter(([name]) => !fixed.has(name)),
    );
    const viaOptions = loadConfig(fromOptions);
    const plain = loadConfig({ BASE_URL: "https://runs.example.org" });
    if (!viaOptions.ok || !plain.ok) throw new Error("the defaults do not load");
    // Field by field, so a difference names the setting that drifted.
    for (const [field, value] of Object.entries(plain.config)) {
      const viaField = viaOptions.config[field as keyof typeof viaOptions.config];
      expect([field, viaField]).toEqual([field, value]);
    }
  });

  it("reports a wrong value of a field the form no longer checks, at start", () => {
    const start = (given: Record<string, string>) => {
      const mapped = mapHomeAssistantOptions({
        ...options,
        base_url: "https://runs.example.org",
        ...given,
      });
      if (!mapped.ok) throw new Error(mapped.errors.join(" "));
      const fixed = new Set(Object.keys(FIXED_ENVIRONMENT));
      const env = Object.fromEntries(Object.entries(mapped.env).filter(([k]) => !fixed.has(k)));
      const loaded = loadConfig(env);
      return loaded.ok ? [] : loaded.errors;
    };
    expect(start({})).toEqual([]);
    expect(start({ contact_email: "not-an-email" }).join(" ")).toMatch(/CONTACT_EMAIL.*email/);
    expect(start({ imprint_url: "not a url" }).join(" ")).toContain("IMPRINT_URL");
    expect(start({ privacy_url: "ftp://x.example" }).join(" ")).toContain("PRIVACY_URL");
    expect(start({ smtp_host: "mail.example.org", smtp_from: "nope" }).join(" ")).toContain(
      "SMTP_FROM must be an email address",
    );
    expect(start({ smtp_host: "mail.example.org" }).join(" ")).toContain("SMTP_FROM is required");
    expect(start({ smtp_user: "mailer" }).join(" ")).toContain("need SMTP_HOST");
    expect(
      start({ smtp_host: "mail.example.org", smtp_from: "a@example.org", smtp_tls: "tls" }),
    ).toEqual([]);
  });

  it("limits the numbers and the names as the configuration does", () => {
    const loaded = loadConfig({ BASE_URL: "https://runs.example.org" });
    if (!loaded.ok) throw new Error("the defaults do not load");
    expect(typeOf("max_retention_days")).toBe(`int(1,${loaded.config.maxRetentionDays})`);
    expect(typeOf("max_plan_horizon_days")).toBe(`int(1,${loaded.config.maxPlanHorizonDays})`);
    expect(typeOf("instance_name")).toBe(`str(1,${MAX_INSTANCE_NAME_LENGTH})`);
    expect(typeOf("oidc_name")).toBe(`str(1,${MAX_OIDC_NAME_LENGTH})?`);
  });

  it("is the only app configuration file in the repository", () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            walk(join(dir, entry.name));
          }
        } else if (/^config\.(ya?ml|json)$/.test(entry.name)) {
          found.push(relative(ROOT, join(dir, entry.name)));
        }
      }
    };
    walk(ROOT);
    // A second one would make the Supervisor list a second app (or a broken one).
    expect(found).toEqual(["homeassistant/rendezroute/config.yaml"]);
  });

  it("restricts the enumerated options to the values the configuration accepts", () => {
    expect(typeOf("posting_mode")).toBe("list(anyone|invite|logged_in)");
    expect(options.posting_mode).toBe("anyone");
  });

  it("agrees with the mapper on the admin port and the public port", () => {
    expect(config.ingress).toBe(true);
    // The Supervisor's default ingress port is left out (the linter rejects a default value).
    expect(config.ingress_port ?? 8099).toBe(Number(FIXED_ENVIRONMENT.ADMIN_PORT));
    expect(config.ports).toEqual({ "3000/tcp": 3000 });
    expect(config.ports_description).toHaveProperty(["3000/tcp"]);
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/HEALTHCHECK[^\n]*\\\n[^\n]*127\.0\.0\.1:3000\/healthz/);
  });

  it("maps only the app's own config folder, and needs the Supervisor API", () => {
    expect(config.map).toEqual(["app_config:rw"]);
    expect(config.hassio_api).toBe(true);
    // An SQLite database is not backed up while it is written.
    expect(config.backup).toBe("cold");
    // Stable is the default, so there is no `stage` line (it was "experimental" until the app ran on
    // a real device).
    expect(config.stage).toBeUndefined();
    expect(FIXED_ENVIRONMENT.ENCRYPTION_KEY_FILE).toMatch(/^\/config\//);
  });

  it("sets nothing the linter would reject as a default value or as obsolete", () => {
    const atDefault = Object.entries(LINTER_DEFAULTS)
      .filter(([key, value]) => key in config && isDeepStrictEqual(config[key], value))
      .map(([key]) => key);
    expect(atDefault).toEqual([]);
    expect(config).not.toHaveProperty("watchdog");
    expect(config).not.toHaveProperty("webui");
  });

  it("has the identity of decision I76", () => {
    expect(config.name).toBe("RendezRoute");
    expect(config.slug).toBe("rendezroute");
    expect(config.url).toBe("https://github.com/cgtobi/RendezRoute");
    expect(config.arch).toEqual(["aarch64", "amd64"]);
    expect(String(config.version)).toMatch(/^\d+\.\d+\.\d+$/);
    // A tag in `image` is rejected by the Supervisor; it appends the version itself.
    expect(config.image).toBe("ghcr.io/cgtobi/rendezroute-ha");
  });

  it("has a changelog entry for the version", () => {
    const changelog = readFileSync(join(APP, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## ${String(config.version)}`);
  });

  it("ships the files the store shows", () => {
    const files = ["README.md", "DOCS.md", "CHANGELOG.md", "apparmor.txt", "icon.png", "logo.png"];
    expect(files.filter((file) => !existsSync(join(APP, file)))).toEqual([]);
  });
});

describe("the image and its publish workflow (decisions I76, I77)", () => {
  const workflowText = readFileSync(join(ROOT, ".github/workflows/publish-ha.yml"), "utf8");
  const workflow = parse(workflowText) as {
    on: Record<string, unknown>;
    env: Record<string, string>;
    permissions: Record<string, string>;
    concurrency: { group?: string; "cancel-in-progress"?: boolean };
    jobs: Record<
      string,
      {
        if?: string;
        permissions?: Record<string, string>;
        steps?: {
          name?: string;
          uses?: string;
          with?: unknown;
          env?: Record<string, string>;
          run?: string;
        }[];
      }
    >;
  };
  const jobs = Object.entries(workflow.jobs);
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

  /** A workflow-level `${{ env.NAME }}` replaced by its value. */
  const resolve = (value: unknown): string =>
    String(value).replace(/\$\{\{ env\.(\w+) \}\}/g, (_, name: string) => workflow.env[name] ?? "");

  /** The `with:` inputs of every step that uses the named builder action. */
  const builderInputs = (action: string): Record<string, unknown>[] =>
    jobs
      .flatMap(([, job]) => job.steps ?? [])
      .filter((step) => (step.uses ?? "").startsWith(`home-assistant/builder/actions/${action}@`))
      .map((step) => step.with as Record<string, unknown>);

  it("publishes the image named in config.yaml, under the owner of the repository", () => {
    const names = [
      ...builderInputs("prepare-multi-arch-matrix"),
      ...builderInputs("publish-multi-arch-manifest"),
    ].map((inputs) => resolve(inputs["image-name"]));
    expect(names).toHaveLength(2);
    // The actions push `<registry-prefix>/<arch>-<name>` and the manifest `<prefix>/<name>`, with
    // the prefix `ghcr.io/${{ github.repository_owner }}` (the repository is cgtobi/RendezRoute).
    for (const name of names) expect(config.image).toBe(`ghcr.io/cgtobi/${name}`);
    expect(workflowText).not.toContain("registry-prefix");
  });

  it("builds the ha image for both architectures with the IMAGE_TARGET build argument", () => {
    const build = builderInputs("build-image");
    expect(build).toHaveLength(1);
    expect(String(build[0]?.["build-args"]).trim().split("\n")).toContain("IMAGE_TARGET=ha");
    expect(String(build[0]?.labels)).toContain("io.hass.type=app");
    expect(resolve(builderInputs("prepare-multi-arch-matrix")[0]?.architectures)).toMatch(
      /aarch64.*amd64|amd64.*aarch64/,
    );
  });

  it("publishes from tags only, one run at a time, and only if the repository variable is set", () => {
    // The manual trigger only re-runs a tag: the first step refuses a branch.
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(workflow.on.push).toEqual({ tags: ["v*"] });
    expect(workflow.concurrency.group).toBe("publish-ha");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    const [, check] = jobs[0] ?? [];
    const refusal = (check?.steps ?? []).findIndex((step) =>
      /ref_type|REF_TYPE/.test(step.run ?? ""),
    );
    expect(refusal, "the ref_type check is among the first steps").toBeGreaterThanOrEqual(0);
    expect(refusal).toBeLessThan(2);
    const guard = check?.steps?.[refusal];
    expect(guard?.env).toEqual({ REF_TYPE: "${{ github.ref_type }}" });
    expect(guard?.run).toContain('[ "$REF_TYPE" != tag ]');
    expect(guard?.run).toContain("exit 1");
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    const unguarded = jobs.filter(([, job]) => job.if !== "vars.PUBLISH_HA_IMAGE == 'true'");
    expect(unguarded.map(([name]) => name)).toEqual([]);
  });

  it("gives write access only to the jobs that push, and none at the top", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    const writers = jobs
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([name]) => name);
    expect(writers).toHaveLength(2);
    for (const [name, job] of jobs) {
      const signs = job.permissions?.["id-token"] === "write";
      expect(signs, `${name}: id-token only where packages: write`).toBe(writers.includes(name));
    }
  });

  it("checks the tag against the version in config.yaml before anything is built", () => {
    const [first, ...rest] = jobs;
    expect(first?.[1].steps?.map((step) => step.name ?? "")).toContainEqual(
      expect.stringMatching(/version.*tag|tag.*version/i),
    );
    for (const [, job] of rest) {
      expect((job as { needs?: unknown }).needs).toBeDefined();
    }
    expect(workflowText).toContain("homeassistant/rendezroute/config.yaml");
  });

  it("has a Dockerfile whose last stage is picked by IMAGE_TARGET, defaulting to the normal image", () => {
    expect(dockerfile).toMatch(/^ARG IMAGE_TARGET=runtime$/m);
    // The ARG comes before the first FROM (the only place a FROM line can read it from).
    expect(dockerfile.indexOf("ARG IMAGE_TARGET=runtime")).toBeLessThan(
      dockerfile.search(/^FROM /m),
    );
    const stages = [...dockerfile.matchAll(/^FROM \S+ AS (\S+)$/gm)].map((match) => match[1]);
    expect(stages).toEqual(expect.arrayContaining(["runtime", "ha", "final"]));
    expect(stages.at(-1)).toBe("final");
    expect(dockerfile).toMatch(/^FROM \$\{IMAGE_TARGET\} AS final$/m);
  });
});

describe("repository.yaml", () => {
  it("names the repository so the Supervisor loads it", () => {
    const repository = yamlFile(join(ROOT, "repository.yaml"));
    expect(repository).toEqual({
      name: "RendezRoute",
      url: "https://github.com/cgtobi/RendezRoute",
      maintainer: "cgtobi",
    });
  });
});

describe("translations", () => {
  const files = ["de.yaml", "en.yaml", "fr.yaml"];

  it("has one file per language", () => {
    expect(readdirSync(join(APP, "translations")).sort()).toEqual(files);
  });

  for (const file of files) {
    it(`${file} names and describes exactly the schema's options`, () => {
      const translation = yamlFile(join(APP, "translations", file));
      const configuration = translation.configuration as Record<
        string,
        { name?: unknown; description?: unknown }
      >;
      expect(Object.keys(configuration).sort()).toEqual(Object.keys(schema).sort());
      const blank = Object.entries(configuration)
        .filter(([, { name, description }]) => {
          const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
          return text(name) === "" || text(description) === "";
        })
        .map(([option]) => option);
      expect(blank).toEqual([]);
      expect(Object.keys(translation.network as Yaml)).toEqual(["3000/tcp"]);
    });
  }

  it("uses the narrow no-break space before a colon in French", () => {
    const french = readFileSync(join(APP, "translations/fr.yaml"), "utf8");
    // Before : ; ? ! and » (after a letter, a digit or a closing bracket) and after « there is no
    // ASCII space, and before a colon no U+00A0 either. The guillemets of "À proximité" use U+00A0,
    // which is allowed.
    expect(french).not.toMatch(/[\p{L}\p{N})] [:;?!»]/u);
    expect(french).not.toMatch(/[\p{L}\p{N})]\u00A0:/u);
    expect(french).not.toMatch(/« /u);
    expect(french).toMatch(/\p{L}\u202F:/u);
  });
});
