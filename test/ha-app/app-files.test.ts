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

  it("keeps secrets as password fields, and only secrets", () => {
    const passwords = Object.keys(schema).filter((name) => typeOf(name).startsWith("password"));
    expect(passwords.sort()).toEqual([...SECRETS].sort());
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
    expect(typeOf("smtp_tls")).toBe("list(starttls|tls)?");
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
    // An SQLite database is not backed up while it is written, and the app is not yet proven.
    expect(config.backup).toBe("cold");
    expect(config.stage).toBe("experimental");
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
    const files = ["README.md", "DOCS.md", "CHANGELOG.md", "icon.png", "logo.png"];
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
