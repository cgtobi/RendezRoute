// The creation form's structure (decision D61, step 0.12-3): essentials first, the optional
// controls in folds that are closed unless something inside has an error. The form is shared by
// the create page, the host edit page and the template edit page.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import {
  onQuarterHour,
  PlanForm,
  type PlanFormProps,
  type VisibilityChoice,
} from "../../../src/adapters/in/http/views/plan-form.tsx";
import type { FieldError, PlanField } from "../../../src/domain/plan-input.ts";
import { escaped } from "../../support/html.ts";
import { sampleInput } from "../../fixtures/plans.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";

const t = translator("en");

interface Node {
  tag: string;
  attributes: string;
  parent: Node | undefined;
  children: Node[];
  /** Text of this element and everything inside it. */
  text: string;
}

const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);

/** A small tree of the rendered markup: enough to ask what sits inside which `<details>`. */
function parse(html: string): Node {
  const root: Node = { tag: "#root", attributes: "", parent: undefined, children: [], text: "" };
  let current = root;
  let last = 0;
  const addText = (text: string) => {
    for (let node: Node | undefined = current; node !== undefined; node = node.parent) {
      node.text += text;
    }
  };
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    addText(html.slice(last, match.index));
    last = match.index + match[0].length;
    const [, closing, name = "", attributes = ""] = match;
    if (closing === "/") {
      current = current.parent ?? root;
      continue;
    }
    const node: Node = { tag: name, attributes, parent: current, children: [], text: "" };
    current.children.push(node);
    if (!VOID.has(name) && !attributes.endsWith("/")) current = node;
  }
  return root;
}

function all(node: Node): Node[] {
  return node.children.flatMap((child) => [child, ...all(child)]);
}

const attr = (node: Node, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?(?=\\s|/|$)`).exec(node.attributes.trim())?.[1] ??
  (new RegExp(`(?:^|\\s)${name}(?=\\s|$|=)`).test(node.attributes) ? "" : undefined);

const hasAttr = (node: Node, name: string) => attr(node, name) !== undefined;
const classes = (node: Node) => (attr(node, "class") ?? "").split(" ");
const isOpen = (node: Node) => / open(=|\s|$)/.test(` ${node.attributes}`);
const controls = (root: Node) =>
  all(root).filter((node) => ["input", "select", "textarea"].includes(node.tag));
const inDetails = (node: Node): Node | undefined => {
  for (let up = node.parent; up !== undefined; up = up.parent) if (up.tag === "details") return up;
  return undefined;
};
const folds = (root: Node) =>
  all(root).filter((node) => node.tag === "details" && classes(node).includes("fold"));
const foldTitle = (fold: Node) =>
  all(fold).find((node) => classes(node).includes("fold-title"))?.text ?? "";
const foldValue = (fold: Node) =>
  all(fold).find((node) => classes(node).includes("fold-value"))?.text ?? "";
const foldByTitle = (root: Node, title: string) => {
  const found = folds(root).find((fold) => foldTitle(fold) === title);
  if (found === undefined) throw new Error(`no fold "${title}"`);
  return found;
};
const named = (root: Node, name: string) =>
  controls(root).filter((node) => attr(node, "name") === name);

const linkOnly: VisibilityChoice = {
  publicAllowed: false,
  loginHref: undefined,
  hasAccount: false,
  followers: undefined,
  sharedBy: undefined,
  nearby: false,
};
const everything: VisibilityChoice = {
  publicAllowed: true,
  loginHref: undefined,
  hasAccount: true,
  followers: { allowed: true },
  sharedBy: "@anna@runs.example.org",
  nearby: true,
};

const emptyValues = {
  ...Object.fromEntries(Object.keys(sampleInput).map((key) => [key, ""])),
  activity: "run",
  timeZone: "UTC",
  dropPolicy: "no_drop",
  shareCopy: "1",
  shareNative: "1",
  shareWhatsApp: "1",
  primaryColor: "#2E5BFF",
  secondaryColor: "#FF7A45",
} as PlanFormProps["values"];

function render(
  overrides: Omit<Partial<PlanFormProps>, "values"> & { values?: Partial<PlanFormProps["values"]> },
) {
  const { values, ...rest } = overrides;
  const props: PlanFormProps = {
    t,
    values: { ...emptyValues, ...values },
    errors: [],
    csrfToken: "csrf",
    nonce: "nonce",
    timeZones: ["Europe/Berlin", "UTC"],
    maxRetentionDays: 30,
    action: "/new",
    heading: "Plan",
    submitLabel: "Create plan",
    withGpx: true,
    map: undefined,
    placeSearch: false,
    routeTrim: "",
    units: "metric",
    visibility: linkOnly,
    ...rest,
  };
  // oxlint-disable-next-line typescript/no-base-to-string
  const html = (<PlanForm {...props} />).toString();
  return { html, root: parse(html) };
}

const errorOn = (field: PlanField | "gpx"): FieldError[] => [{ field, code: "required" }];

describe("field order", () => {
  it("puts Title and Activity before Date and Start time, the zone line, Where and the folds", () => {
    const { html } = render({ values: { posterName: "Anna" } });
    const order = [
      'name="title"',
      'name="activity"',
      'name="date"',
      'name="time"',
      'class="zone-line"',
      '<section class="where">',
      'name="areaLabel"',
      'name="exactDescription"',
      'class="host-name"',
      'class="folds"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(`<h2>${en["form.where"]}</h2>`);
  });

  it("orders the folds: exact point in Where, then route, who, look, after the run", () => {
    const { root } = render({});
    expect(folds(root).map(foldTitle)).toEqual([
      en["fold.exact"],
      en["fold.route"],
      en["fold.who"],
      en["fold.look"],
      en["fold.after"],
    ]);
  });

  it("holds the exact point inside the Where block, with the description and both coordinates", () => {
    const { root } = render({});
    const exact = foldByTitle(root, en["fold.exact"]);
    expect(all(root).find((node) => classes(node).includes("where"))).toBeDefined();
    expect(
      controls(exact)
        .map((node) => attr(node, "name"))
        .toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["exactDescription", "exactLat", "exactLng"]);
    expect(exact.text).toContain(en["form.exactDescription"]);
    expect(all(exact).filter((node) => node.tag === "details")).toHaveLength(0);
  });
});

describe("folds", () => {
  it("are closed by default and still hold their inputs, so they are submitted", () => {
    const { root } = render({});
    expect(folds(root).map(isOpen)).toEqual([false, false, false, false, false]);
    const inside = new Set(
      folds(root).flatMap((fold) => controls(fold).map((node) => attr(node, "name"))),
    );
    for (const name of [
      "exactDescription",
      "exactLat",
      "exactLng",
      "distanceKm",
      "elevationGainM",
      "paceFrom",
      "paceTo",
      "dropPolicy",
      "gpx",
      "gpxTrim",
      "note",
      "joinMode",
      "shareCopy",
      "shareNative",
      "shareWhatsApp",
      "primaryColor",
      "secondaryColor",
      "retentionDays",
      "recapWindow",
      "keepAsTemplate",
      "templateIncludePrivate",
    ]) {
      expect(inside).toContain(name);
    }
  });

  it("holds join mode even where the visibility choice is not offered", () => {
    const { root, html } = render({ visibility: linkOnly });
    expect(named(foldByTitle(root, en["fold.who"]), "joinMode")).toHaveLength(2);
    expect(html).not.toContain('name="visibility"');
  });

  const cases: [string, PlanField | "gpx", string][] = [
    ["distance", "distanceKm", "fold.route"],
    ["elevation", "elevationGainM", "fold.route"],
    ["pace", "paceFrom", "fold.route"],
    ["group policy", "dropPolicy", "fold.route"],
    ["GPX file", "gpx", "fold.route"],
    ["note", "note", "fold.route"],
    ["exact description", "exactDescription", "fold.exact"],
    ["exact latitude", "exactLat", "fold.exact"],
    ["join mode", "joinMode", "fold.who"],
    ["visibility", "visibility", "fold.who"],
    ["share buttons", "shareWhatsApp", "fold.look"],
    ["colours", "primaryColor", "fold.look"],
    ["retention", "retentionDays", "fold.after"],
    ["recap window", "recapWindow", "fold.after"],
    ["template options", "keepAsTemplate", "fold.after"],
  ];
  for (const [name, field, title] of cases) {
    it(`render open, and only that one, when ${name} has an error`, () => {
      const { root } = render({ errors: errorOn(field), visibility: everything });
      const open = folds(root).filter(isOpen).map(foldTitle);
      expect(open).toEqual([en[title as keyof typeof en] as string]);
    });
  }

  it("stay closed when only the title, date, time, activity or area have errors", () => {
    for (const field of ["title", "date", "time", "activity", "areaLabel", "posterName"] as const) {
      const { root } = render({ errors: errorOn(field), values: { posterName: "Anna" } });
      expect(folds(root).filter(isOpen)).toEqual([]);
    }
  });

  it("open the exact point when a description or coordinates are set", () => {
    expect(isOpen(foldByTitle(render({}).root, en["fold.exact"]))).toBe(false);
    for (const values of [{ exactDescription: "Gate" }, { exactLat: "48.1" }, { exactLng: "11" }]) {
      expect(isOpen(foldByTitle(render({ values }).root, en["fold.exact"]))).toBe(true);
    }
  });
});

describe("required fields", () => {
  const REQUIRED = ["posterName", "title", "date", "time", "timeZone", "areaLabel"];

  it("sit in no details, except the time zone select and a prefilled host name", () => {
    const { root } = render({ values: { posterName: "Anna" } });
    const hidden = controls(root)
      .filter((node) => REQUIRED.includes(attr(node, "name") ?? ""))
      .filter((node) => inDetails(node) !== undefined)
      .map((node) => attr(node, "name"))
      .toSorted((a, b) => (a ?? "").localeCompare(b ?? ""));
    expect(hidden).toEqual(["posterName", "timeZone"]);
    for (const name of REQUIRED) expect(named(root, name)).toHaveLength(1);
    const inClosedDetails = controls(root).filter((node) => {
      const details = inDetails(node);
      return details !== undefined && !isOpen(details) && attr(node, "required") !== undefined;
    });
    expect(inClosedDetails.map((node) => attr(node, "name"))).toEqual(["posterName"]);
  });

  it("have no required control inside any fold, and the host name is outside every details when empty", () => {
    const { root } = render({});
    const hidden = controls(root)
      .filter((node) => REQUIRED.includes(attr(node, "name") ?? ""))
      .filter((node) => inDetails(node) !== undefined)
      .map((node) => attr(node, "name"));
    expect(hidden).toEqual(["timeZone"]);
    const requiredInFolds = folds(root).flatMap((fold) =>
      controls(fold).filter((node) => attr(node, "required") !== undefined),
    );
    expect(requiredInFolds).toEqual([]);
  });
});

describe("time zone line", () => {
  it("shows the zone and Change, closed, with the select inside it", () => {
    const { root } = render({ values: { timeZone: "Europe/Berlin" } });
    const line = all(root).find((node) => classes(node).includes("zone-line"));
    expect(line).toBeDefined();
    const zoneLine = line as Node;
    expect(isOpen(zoneLine)).toBe(false);
    const summary = zoneLine.children.find((node) => node.tag === "summary");
    expect(summary?.text).toBe(
      `Time zone: Europe/Berlin · ${en["layout.change"]}${en["layout.done"]}`,
    );
    expect(all(zoneLine).some((node) => attr(node, "data-zone-name") !== undefined)).toBe(true);
    expect(named(zoneLine, "timeZone")).toHaveLength(1);
    expect(zoneLine.text).toContain(en["form.timeZone"]);
  });

  it("starts with a visible title in every language, one summary, and no hidden prefix (D80)", () => {
    for (const lang of ["en", "de", "fr"] as const) {
      const tl = translator(lang);
      const { html, root } = render({ t: tl, values: { timeZone: "Europe/Berlin" } });
      const line = all(root).find((node) => classes(node).includes("zone-line")) as Node;
      expect(line.children.filter((node) => node.tag === "summary")).toHaveLength(1);
      const title = all(line).find((node) => classes(node).includes("zone-title")) as Node;
      expect(title.text).toBe(tl("form.timeZoneLine"));
      expect(classes(title)).not.toContain("visually-hidden");
      expect(html).toContain(
        `<span class="zone-title">${tl("form.timeZoneLine")}</span> <span data-zone-name`,
      );
    }
    expect(translator("fr")("form.timeZoneLine")).toBe("Fuseau horaire\u202f:");
  });

  it("renders open when the time zone has an error", () => {
    const { root } = render({ errors: errorOn("timeZone") });
    const line = all(root).find((node) => classes(node).includes("zone-line"));
    expect(line !== undefined && isOpen(line)).toBe(true);
  });
});

describe("host name", () => {
  const hostName = (root: Node) => all(root).find((node) => classes(node).includes("host-name"));

  it("is collapsed to 'Hosting as <name> · Change' when prefilled, and still submitted", () => {
    const { root } = render({ values: { posterName: "Anna" } });
    const line = hostName(root);
    expect(line !== undefined && !isOpen(line)).toBe(true);
    const summary = (line as Node).children.find((node) => node.tag === "summary");
    expect(summary?.text).toBe(`Hosting as Anna · ${en["layout.change"]}${en["layout.done"]}`);
    const [field] = named(line as Node, "posterName");
    expect(attr(field as Node, "value")).toBe("Anna");
    expect(attr(field as Node, "required")).toBeDefined();
  });

  it("is the open, empty, required field when no name is known", () => {
    const { root } = render({});
    expect(hostName(root)).toBeUndefined();
    const [field] = named(root, "posterName");
    expect(field && inDetails(field)).toBeUndefined();
    expect(attr(field as Node, "value")).toBe("");
    expect(attr(field as Node, "required")).toBeDefined();
  });

  it("is the open field, not a collapse, when the name has an error", () => {
    const { root, html } = render({
      values: { posterName: "Anna" },
      errors: errorOn("posterName"),
    });
    expect(hostName(root)).toBeUndefined();
    const [field] = named(root, "posterName");
    expect(field && inDetails(field)).toBeUndefined();
    expect(html).toContain(en["field.required"]);
  });
});

describe("fold summaries", () => {
  const summary = (title: string, props: Parameters<typeof render>[0] = {}) =>
    foldValue(foldByTitle(render({ visibility: everything, ...props }).root, title));

  it("exact point in open mode (also an empty join mode): anyone who joins sees it", () => {
    expect(summary(en["fold.exact"])).toBe("Optional · anyone who joins sees it");
    expect(summary(en["fold.exact"], { values: { joinMode: "open" } })).toBe(
      "Optional · anyone who joins sees it",
    );
    expect(summary(en["fold.exact"], { values: { exactDescription: "Gate" } })).toBe(
      "Set · anyone who joins sees it",
    );
    expect(summary(en["fold.exact"], { values: { exactLat: "48", exactLng: "11" } })).toBe(
      "Set · anyone who joins sees it",
    );
  });

  it("exact point in approval mode: only people you accept see it", () => {
    const approval = { joinMode: "approval" };
    expect(summary(en["fold.exact"], { values: approval })).toBe(
      "Optional · only people you accept see it",
    );
    expect(summary(en["fold.exact"], { values: { ...approval, exactLat: "48" } })).toBe(
      "Set · only people you accept see it",
    );
  });

  it("renders every variant for the browser script, escaped, under the keys it uses", () => {
    const { root } = render({ visibility: everything });
    const read = (title: string) =>
      JSON.parse(
        (attr(foldByTitle(root, title), "data-summaries") ?? "{}")
          .replaceAll("&quot;", '"')
          .replaceAll("&amp;", "&"),
      ) as Record<string, string>;
    expect(Object.keys(read(en["fold.exact"])).toSorted()).toEqual([
      "approval:none",
      "approval:set",
      "open:none",
      "open:set",
    ]);
    const who = read(en["fold.who"]);
    expect(Object.keys(who).toSorted()).toEqual([
      "approval:followers",
      "approval:link",
      "approval:public",
      "open:followers",
      "open:link",
      "open:public",
    ]);
    expect(who["approval:public"]).toBe("Public · Join: after your approval · Find: anyone");
    expect(who["open:followers"]).toBe("Join: anyone with the link · Find: followers");
    expect(attr(foldByTitle(root, en["fold.route"]), "data-summaries")).toBeUndefined();
  });

  it("route: nothing set, then the set parts", () => {
    expect(summary(en["fold.route"])).toBe("No route · distance and pace not set · no note");
    expect(
      summary(en["fold.route"], {
        values: { distanceKm: "12", paceFrom: "5:30", paceTo: "6:00", note: "Bring water" },
      }),
    ).toBe("No route · 12 km · 5:30–6:00 min/km · note added");
  });

  it("route: speed for rides, miles for imperial, and no route word on edit forms", () => {
    expect(
      summary(en["fold.route"], {
        withGpx: false,
        units: "imperial",
        values: { activity: "ride", distanceKm: "8", paceFrom: "15", paceTo: "17" },
      }),
    ).toBe("8 mi · 15–17 mph · no note");
    expect(summary(en["fold.route"], { withGpx: false })).toBe(
      "Distance and pace not set · no note",
    );
  });

  it("route: pace per km for hikes", () => {
    expect(
      summary(en["fold.route"], {
        values: { activity: "hike", distanceKm: "9", paceFrom: "11:00", paceTo: "12:30" },
      }),
    ).toBe("No route · 9 km · 11:00–12:30 min/km · no note");
  });

  it("who: link only and anyone with the link by default, also where visibility is not offered", () => {
    expect(summary(en["fold.who"])).toBe("Join: anyone with the link · Find: link only");
    expect(summary(en["fold.who"], { visibility: linkOnly })).toBe(
      "Join: anyone with the link · Find: link only",
    );
    expect(
      summary(en["fold.who"], { visibility: linkOnly, values: { visibility: "public" } }),
    ).toBe("Join: anyone with the link · Find: link only");
  });

  it("who: approval and followers", () => {
    expect(
      summary(en["fold.who"], { values: { joinMode: "approval", visibility: "followers" } }),
    ).toBe("Join: after your approval · Find: followers");
  });

  it("who: public starts with 'Public', carries the warning class and no strong marker (D81)", () => {
    const { root } = render({ visibility: everything, values: { visibility: "public" } });
    const fold = foldByTitle(root, en["fold.who"]);
    expect(foldValue(fold)).toBe("Public · Join: anyone with the link · Find: anyone");
    expect(classes(fold)).toContain("fold-warning");
    expect(classes(fold)).not.toContain("fold-strong");
    const approval = render({
      visibility: everything,
      values: { visibility: "public", joinMode: "approval" },
    });
    expect(foldValue(foldByTitle(approval.root, en["fold.who"]))).toBe(
      "Public · Join: after your approval · Find: anyone",
    );
  });

  it("who: no warning class unless public, and public chosen but not allowed counts as link", () => {
    const link = foldByTitle(render({ visibility: everything }).root, en["fold.who"]);
    expect(classes(link)).not.toContain("fold-warning");
    const notAllowed = render({
      visibility: { ...everything, publicAllowed: false, loginHref: "/account" },
      values: { visibility: "public" },
    });
    const fold = foldByTitle(notAllowed.root, en["fold.who"]);
    expect(classes(fold)).not.toContain("fold-warning");
    expect(foldValue(fold)).toBe("Join: anyone with the link · Find: link only");
  });

  it("look: share buttons and colours", () => {
    expect(summary(en["fold.look"])).toBe("Share buttons on · colors default");
    expect(
      summary(en["fold.look"], {
        values: { shareCopy: "", shareNative: "", shareWhatsApp: "", primaryColor: "#112233" },
      }),
    ).toBe("Share buttons off · colors custom");
    expect(summary(en["fold.look"], { values: { primaryColor: "#2e5bff" } })).toBe(
      "Share buttons on · colors default",
    );
  });

  it("after the run: retention and recap in days", () => {
    expect(summary(en["fold.after"])).toBe("Delete after 14 days · recap 7 days");
    expect(summary(en["fold.after"], { values: { retentionDays: "1", recapWindow: "1d" } })).toBe(
      "Delete after 1 day · recap 1 day",
    );
    expect(summary(en["fold.after"], { values: { retentionDays: "3", recapWindow: "now" } })).toBe(
      "Delete after 3 days · no recap",
    );
  });

  it("keeps the title, a hidden comma and the value in one summary", () => {
    const { html } = render({});
    expect(html).toContain(
      `<span class="fold-title">${en["fold.who"]}</span><span class="visually-hidden fold-sep">, </span>`,
    );
  });
});

describe("template edit form", () => {
  it("has no date and no template options, but keeps retention and recap", () => {
    const { root } = render({ forTemplate: true, withGpx: false });
    expect(named(root, "date")).toHaveLength(0);
    expect(named(root, "keepAsTemplate")).toHaveLength(0);
    expect(named(root, "templateIncludePrivate")).toHaveLength(0);
    expect(named(root, "retentionDays")).toHaveLength(1);
    expect(named(root, "recapWindow")).toHaveLength(1);
  });
});

describe("the three pages that share the form", () => {
  it("GET /new: open empty name, closed folds, title before date", async () => {
    const test = await createTestApp();
    const html = await (await new TestClient(test.app).get("/new")).text();
    const root = parse(html);
    const [field] = named(root, "posterName");
    expect(field && inDetails(field)).toBeUndefined();
    expect(folds(root)).toHaveLength(5);
    expect(folds(root).some(isOpen)).toBe(false);
    expect(html.indexOf('name="title"')).toBeLessThan(html.indexOf('name="date"'));
    expect(html).not.toContain("Exact start (optional)");
  });

  it("a re-render after an error keeps the entered values and opens the failing fold", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    const hidden = await client.hiddenFields("/new");
    const response = await client.postForm("/new", {
      ...hidden,
      ...sampleInput,
      distanceKm: "far away",
    });
    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain('value="far away"');
    const root = parse(html);
    expect(folds(root).filter(isOpen).map(foldTitle)).toEqual([en["fold.exact"], en["fold.route"]]);
  });

  it("host edit page: the saved name is collapsed and the exact point shows what was saved", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    const root = parse(await (await host.get(`/p/${planId}/host`)).text());
    const line = all(root).find((node) => classes(node).includes("host-name"));
    expect(line !== undefined && !isOpen(line)).toBe(true);
    expect(line?.children.find((node) => node.tag === "summary")?.text).toContain(
      "Hosting as Anna",
    );
    const exact = foldByTitle(root, en["fold.exact"]);
    expect(foldValue(exact)).toBe("Set · anyone who joins sees it");
    expect(isOpen(exact)).toBe(true);
    expect(folds(root)).toHaveLength(5);
    expect(
      folds(root).flatMap((fold) => named(fold, "gpx")),
      "the route has its own section on the host page, not in a fold",
    ).toHaveLength(0);
  });
});

describe("the title on the three pages (decision D71)", () => {
  const titleTag = (html: string) => /<input[^>]*name="title"[^>]*>/.exec(html)?.[0] ?? "";
  const valueOf = (tag: string) => /\svalue="([^"]*)"/.exec(tag)?.[1];

  it("GET /new prefills the default title in the request language, selected on first focus", async () => {
    const test = await createTestApp();
    for (const [language, header] of [
      ["en", "en-US,en;q=0.9"],
      ["de", "de-DE,de;q=0.9,en;q=0.8"],
      ["fr", "fr-FR,fr;q=0.9,en;q=0.8"],
    ] as const) {
      const response = await new TestClient(test.app).request("/new", {
        headers: { "accept-language": header },
      });
      const tag = titleTag(await response.text());
      expect([language, valueOf(tag)]).toEqual([
        language,
        translator(language)("form.defaultTitle"),
      ]);
      expect(tag).toContain("data-select-on-focus");
    }
    expect(translator("en")("form.defaultTitle")).toBe("My plan");
    expect(translator("de")("form.defaultTitle")).toBe("Mein Treffen");
    expect(translator("fr")("form.defaultTitle")).toBe("Ma sortie");
  });

  it("POST /new with an empty title is refused and re-renders it empty, with its error", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    const hidden = await client.hiddenFields("/new");
    const response = await client.postForm("/new", { ...hidden, ...sampleInput, title: "" });
    expect(response.status).toBe(422);
    const html = await response.text();
    const tag = titleTag(html);
    expect(valueOf(tag)).toBe("");
    expect(tag).not.toContain("data-select-on-focus");
    expect(tag).toContain('aria-describedby="field-title-error"');
    expect(html).toContain('id="field-title-error"');
    expect(html).not.toContain(en["form.defaultTitle"]);
  });

  it("host edit shows the stored title in the input and no separate title line", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expect(valueOf(titleTag(html))).toBe("Easy Sunday run");
    expect(titleTag(html)).not.toContain("data-select-on-focus");
    expect(html).not.toContain('<p class="plan-context">');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("the retention form of a started plan keeps the static title line and has no title input", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    test.clock.set("2026-06-09T00:00:00Z");
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expect(html).toContain('<p class="plan-context">Easy Sunday run</p>');
    expect(titleTag(html)).toBe("");
  });

  it("the template edit form shows the stored title, and the repeat page names it as its heading", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1", title: "Tuesday tempo" });
    const confirm = await (await host.get(`/p/${planId}/host/delete`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
    const templateId = /\/templates\/([A-Za-z0-9_-]+)/.exec(
      await (await host.get("/")).text(),
    )?.[1];
    const edit = await (await host.get(`/templates/${templateId}/edit`)).text();
    expect(valueOf(titleTag(edit))).toBe("Tuesday tempo");
    expect(titleTag(edit)).not.toContain("data-select-on-focus");
    expect(edit.match(/name="title"/g)).toHaveLength(1);
    const page = await (await host.get(`/templates/${templateId}`)).text();
    expect(page).toContain("<h1>Tuesday tempo</h1>");
  });
});

describe("further form behaviour", () => {
  it("shows an activity error with its message and the invalid class", () => {
    const { root, html } = render({ errors: [{ field: "activity", code: "choice_invalid" }] });
    const field = all(root).find(
      (node) => classes(node).includes("field") && named(node, "activity").length === 1,
    );
    expect(field && classes(field)).toEqual(["field", "field-compact", "field-invalid"]);
    expect(html).toContain(escaped(en["field.choice_invalid"]));
    expect(html).toContain('id="field-activity-error"');
  });

  it("opens the who fold while an acceptance of pending requests is asked for", () => {
    const { root } = render({ confirmAcceptPending: 2 });
    expect(folds(root).filter(isOpen).map(foldTitle)).toEqual([en["fold.who"]]);
  });

  it("names the zone the select submits when the value is not offered", () => {
    const { root } = render({ values: { timeZone: "Mars/Olympus" } });
    const line = all(root).find((node) => classes(node).includes("zone-line")) as Node;
    expect(line.children.find((node) => node.tag === "summary")?.text).toBe(
      `Time zone: Europe/Berlin · ${en["layout.change"]}${en["layout.done"]}`,
    );
  });
});

describe("open and closed summary texts", () => {
  it("renders both texts in the zone line and the host name summaries", () => {
    const { root } = render({ values: { posterName: "Anna" } });
    for (const name of ["zone-line", "host-name"]) {
      const line = all(root).find((node) => classes(node).includes(name)) as Node;
      const summary = line.children.find((node) => node.tag === "summary") as Node;
      const spans = all(summary).filter((node) => classes(node).includes("zone-change"));
      expect(
        spans.map((node) => [classes(node).includes("zone-change-closed"), node.text]),
      ).toEqual([
        [true, en["layout.change"]],
        [false, en["layout.done"]],
      ]);
      expect(classes(spans[1] as Node)).toContain("zone-change-open");
    }
  });
});

describe("inline title (decision D71, step 0.12-9)", () => {
  const own = (node: Node, name: string) =>
    new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?(?=\\s|/|$)`).exec(node.attributes)?.[1] ??
    (new RegExp(`(?:^|\\s)${name}(?=\\s|/|$)`).test(node.attributes) ? "" : undefined);
  const titleInput = (root: Node) => {
    const [input] = named(root, "title");
    if (input === undefined) throw new Error("no title input");
    return input;
  };

  it("has exactly one control named title, no visible Title field and a hidden label", () => {
    const { root, html } = render({ values: { title: "Sunday run" } });
    expect(named(root, "title")).toHaveLength(1);
    const labels = all(root).filter(
      (node) => node.tag === "label" && own(node, "for") === "field-title",
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]?.text).toBe(en["form.title"]);
    expect(classes(labels[0] as Node)).toEqual(["visually-hidden"]);
    expect(html).not.toMatch(/<label for="field-title">/);
    const field = labels[0]?.parent as Node;
    expect(classes(field)).toEqual(["field", "field-title"]);
  });

  it("is the first control after the purpose line h1 and before the Activity select", () => {
    const { root } = render({ values: { title: "Sunday run" } });
    const form = all(root).find((node) => node.tag === "form") as Node;
    const h1 = form.children.find((node) => node.tag === "h1") as Node;
    expect(h1.text).toBe("Plan");
    const names = controls(form)
      .map((node) => own(node, "name"))
      .filter((name) => name !== "_csrf" && name !== "nonce");
    expect(names.slice(0, 2)).toEqual(["title", "activity"]);
    expect(all(form).indexOf(h1)).toBeLessThan(all(form).indexOf(titleInput(root)));
  });

  it("is required, limited to 100 characters, without autocomplete, styled by title-input", () => {
    const input = titleInput(render({ values: { title: "Sunday run" } }).root);
    expect(own(input, "required")).toBe("");
    expect(own(input, "maxlength")).toBe("100");
    expect(own(input, "autocomplete")).toBe("off");
    expect(own(input, "class")).toBe("title-input");
    expect(own(input, "value")).toBe("Sunday run");
  });

  it("asks to select on focus only while the value is the default title", () => {
    const withDefault = render({ values: { title: en["form.defaultTitle"] } }).root;
    expect(own(titleInput(withDefault), "data-select-on-focus")).toBe("");
    for (const title of ["", "Sunday run"]) {
      expect(own(titleInput(render({ values: { title } }).root), "data-select-on-focus")).toBe(
        undefined,
      );
    }
  });

  it("shows the error under the input, visible, with aria-invalid and aria-describedby", () => {
    const { root, html } = render({ values: { title: "" }, errors: errorOn("title") });
    const input = titleInput(root);
    expect(own(input, "aria-invalid")).toBe("true");
    expect(own(input, "aria-describedby")).toBe("field-title-error");
    expect(html).toContain('id="field-title-error"');
    const field = input.parent as Node;
    expect(classes(field)).toEqual(["field", "field-title", "field-invalid"]);
    expect(field.children.map((node) => node.tag)).toEqual(["label", "input", "p"]);
    expect(own(field.children[2] as Node, "hidden")).toBeUndefined();
  });

  it("has no wrapper and no pencil: the input sits right in the field, the hint after it", () => {
    const { root, html } = render({ values: { title: "Sunday run" } });
    const input = titleInput(root);
    const field = input.parent as Node;
    expect(classes(field)).toEqual(["field", "field-title"]);
    expect(field.children.map((node) => node.tag)).toEqual(["label", "input", "p"]);
    expect(classes(field.children[2] as Node)).toEqual(["required-hint"]);
    expect(html).not.toMatch(/pencil|line-pen|line-field|title-field/);
  });

  it("is there on the template form too", () => {
    const { root } = render({ forTemplate: true, withGpx: false, values: { title: "Tempo" } });
    expect(named(root, "title")).toHaveLength(1);
    expect(own(titleInput(root), "class")).toBe("title-input");
  });
});

describe("start time step", () => {
  const timeStep = (overrides: Parameters<typeof render>[0]) => {
    const [time] = named(render(overrides).root, "time");
    expect(time).toBeDefined();
    // Own pattern: `attr` misses a last attribute that is followed by the self-closing slash.
    return /\sstep="([^"]*)"/.exec((time as Node).attributes)?.[1];
  };

  it("offers 15-minute steps on a new form, a host edit on the grid and a template form", () => {
    expect(timeStep({})).toBe("900");
    expect(timeStep({ values: { time: "09:15" } })).toBe("900");
    expect(timeStep({ forTemplate: true, withGpx: false })).toBe("900");
    expect(timeStep({ forTemplate: true, withGpx: false, values: { time: "18:45" } })).toBe("900");
  });

  it("leaves the step off for a time that is not on the grid, so it stays editable", () => {
    expect(timeStep({ values: { time: "09:07" } })).toBeUndefined();
    expect(
      timeStep({ forTemplate: true, withGpx: false, values: { time: "09:07" } }),
    ).toBeUndefined();
  });

  it("decides by the quarter hour, an empty value counting as on the grid", () => {
    expect(onQuarterHour("")).toBe(true);
    expect(onQuarterHour("00:00")).toBe(true);
    expect(onQuarterHour("09:15")).toBe(true);
    expect(onQuarterHour("23:45")).toBe(true);
    expect(onQuarterHour("09:07")).toBe(false);
    expect(onQuarterHour("09:16")).toBe(false);
    expect(onQuarterHour("nonsense")).toBe(false);
  });
});

describe("exact point on the map (decision D66)", () => {
  const map = {
    tileUrl: "https://tiles.example/{z}/{x}/{y}.png",
    attribution: "Test",
    defaultZoom: 6,
  };
  const rowOf = (root: Node, name: string) =>
    all(root).find(
      (node) =>
        attr(node, "data-exact-fields") !== undefined &&
        all(node).some((child) => attr(child, "name") === name),
    );

  it("renders the readout hidden, with both lines and a Remove button, for the script to reveal", () => {
    const { root, html } = render({ map });
    const readout = all(root).find((node) => attr(node, "data-exact-readout") !== undefined);
    expect(readout && hasAttr(readout, "hidden")).toBe(true);
    expect(readout?.text).toContain(en["map.exactSet"]);
    expect(readout?.text).toContain(en["map.exactNone"]);
    const set = all(root).find((node) => attr(node, "data-exact-set") !== undefined);
    expect(set && hasAttr(set, "hidden")).toBe(true);
    expect(html).toContain('data-exact-remove=""');
    expect(html).toContain(
      `<button type="button" class="icon-button" data-exact-remove=""><span class="icon icon-close" aria-hidden="true"></span><span class="visually-hidden">${en["map.exactRemove"]}</span></button>`,
    );
    expect(html).not.toMatch(/<button[^>]*class="secondary"[^>]*data-exact-remove/);
  });

  it("keeps the latitude and longitude inputs rendered and visible in the markup", () => {
    const { root } = render({ map, values: { exactLat: "48.1", exactLng: "11.5" } });
    const row = rowOf(root, "exactLat");
    expect(row && hasAttr(row, "hidden")).toBe(false);
    expect(named(root, "exactLat")).toHaveLength(1);
    expect(named(root, "exactLng")).toHaveLength(1);
    expect(named(root, "areaLat")).toHaveLength(1);
    // Hidden only by the script, after it has set itself up (progressive enhancement).
    const area = all(root).find((node) => attr(node, "data-area-fields") !== undefined);
    expect(area && hasAttr(area, "hidden")).toBe(false);
  });

  it("has no readout when maps are off, so nothing changes without the map", () => {
    const { html } = render({});
    expect(html).not.toContain("data-exact-readout");
    expect(html).toContain('name="exactLat"');
  });

  it("keeps a coordinate error in the row it belongs to, which the script then leaves visible", () => {
    const { root, html } = render({ map, errors: errorOn("exactLat") });
    const row = rowOf(root, "exactLat");
    expect(row && hasAttr(row, "hidden")).toBe(false);
    expect(row && all(row).some((node) => classes(node).includes("field-invalid"))).toBe(true);
    expect(html).toContain('aria-describedby="field-exactLat-error"');
    expect(html).toContain('id="field-exactLat-error"');
    const area = render({ map, errors: errorOn("areaLng") });
    expect(area.html).toContain('id="field-areaLng-error"');
    const details = all(area.root).find((node) => attr(node, "data-area-fields") !== undefined);
    expect(details && isOpen(details)).toBe(true);
  });
});

describe("the line and pen style and the required hint (decision D73)", () => {
  const REQUIRED_HINT = `<p class="required-hint" id="`;
  const hintOf = (root: Node, id: string) =>
    all(root).find((node) => node.tag === "p" && attr(node, "id") === id);

  it("gives every required control aria-required, and a visual hint after it except date and time", () => {
    const { root } = render({ values: { title: "Run", posterName: "" } });
    const required = controls(root).filter((node) => hasAttr(node, "required"));
    expect(required.map((node) => attr(node, "name"))).toEqual([
      "title",
      "date",
      "time",
      "areaLabel",
      "posterName",
    ]);
    for (const control of required) {
      const name = attr(control, "name") ?? "";
      const hintId = `field-${name}-required`;
      expect(attr(control, "aria-required")).toBe("true");
      // The hint is purely visual: never named in aria-describedby.
      expect(attr(control, "aria-describedby") ?? "").not.toContain("-required");
      const hint = hintOf(root, hintId);
      const dateOrTime = name === "date" || name === "time";
      expect(hint === undefined).toBe(dateOrTime);
      expect(hint === undefined ? [] : classes(hint)).toEqual(dateOrTime ? [] : ["required-hint"]);
      expect(hint === undefined ? "true" : attr(hint, "aria-hidden")).toBe("true");
      expect(hint === undefined ? en["field.requiredHint"] : hint.text).toBe(
        en["field.requiredHint"],
      );
    }
  });

  it("puts the hint right after the control", () => {
    const { root } = render({});
    const after = (name: string) => {
      const control = named(root, name)[0] as Node;
      const siblings = (control.parent as Node).children;
      return siblings[siblings.indexOf(control) + 1];
    };
    for (const name of ["title", "areaLabel", "posterName"]) {
      expect(attr(after(name) as Node, "id")).toBe(`field-${name}-required`);
    }
  });

  it("renders the text-like fields with a placeholder so CSS can tell when they are empty", () => {
    const { root } = render({});
    for (const name of ["title", "posterName"]) {
      expect(attr(named(root, name)[0] as Node, "placeholder")).toBe(" ");
    }
    // The meeting area has a real example instead (decision D74); it works the same way.
    expect(attr(named(root, "areaLabel")[0] as Node, "placeholder")).toBe(
      en["placeholder.areaLabel"],
    );
    // Date and time have no placeholder: CSS uses :invalid for them.
    for (const name of ["date", "time"]) {
      expect(hasAttr(named(root, name)[0] as Node, "placeholder")).toBe(false);
    }
  });

  it("has no line wrapper and no pencil on any field", () => {
    const { html } = render({ values: { title: "Run" } });
    expect(html).not.toMatch(/pencil|line-pen|line-field/);
  });

  it("shows an error instead of the hint, never both", () => {
    for (const field of ["title", "date", "time", "areaLabel", "posterName"] as const) {
      const { root, html } = render({ errors: errorOn(field) });
      expect(hintOf(root, `field-${field}-required`)).toBeUndefined();
      expect(html).not.toContain(`id="field-${field}-required"`);
      const control = named(root, field)[0] as Node;
      expect(attr(control, "aria-invalid")).toBe("true");
      // A field with a hint names it first (decision D74), then the error; never the required hint.
      const hint = field === "areaLabel" || field === "posterName" ? `field-${field}-hint ` : "";
      expect(attr(control, "aria-describedby")).toBe(`${hint}field-${field}-error`);
      expect(attr(control, "aria-required")).toBe("true");
    }
  });

  it("keeps the hint element for a prefilled field, hidden by CSS only because it has text", () => {
    const { html } = render({ values: { title: "Run", areaLabel: "Park" } });
    expect(html.split(REQUIRED_HINT)).toHaveLength(4);
  });

  it("leaves optional fields without hint, aria-required and placeholder", () => {
    const { root } = render({});
    // (distance, note and exact description got example placeholders in D74: see below.)
    for (const name of ["paceFrom", "paceTo", "areaLat", "exactLat"]) {
      const control = named(root, name)[0] as Node;
      expect(hasAttr(control, "aria-required")).toBe(false);
      expect(hasAttr(control, "placeholder")).toBe(false);
      expect(hintOf(root, `field-${name}-required`)).toBeUndefined();
    }
  });

  it("has the template form's required fields too, without a date", () => {
    const { root } = render({ forTemplate: true, withGpx: false });
    expect(hintOf(root, "field-time-required")).toBeUndefined();
    expect(hintOf(root, "field-date-required")).toBeUndefined();
  });
});

describe("errors that were missing aria-invalid and aria-describedby", () => {
  const field = (html: string, name: string) =>
    parse(html).children.length > 0 ? named(parse(html), name) : [];

  it("marks the drop policy group, its radios and the message", () => {
    const { root, html } = render({ errors: errorOn("dropPolicy") });
    expect(html).toContain('id="field-dropPolicy-error"');
    const radios = field(html, "dropPolicy");
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) expect(attr(radio, "aria-invalid")).toBe("true");
    const group = radios[0]?.parent?.parent as Node;
    expect(group.tag).toBe("fieldset");
    expect(attr(group, "aria-describedby")).toBe("field-dropPolicy-error");
    expect(all(root).filter((node) => hasAttr(node, "aria-invalid"))).toHaveLength(radios.length);
  });

  it("marks the join mode group", () => {
    const { html } = render({ errors: errorOn("joinMode") });
    expect(html).toContain('id="field-joinMode-error"');
    const radios = field(html, "joinMode");
    for (const radio of radios) expect(attr(radio, "aria-invalid")).toBe("true");
    expect(attr(radios[0]?.parent?.parent as Node, "aria-describedby")).toBe(
      "field-joinMode-hint field-joinMode-error",
    );
  });

  it("marks the GPX file field and its message", () => {
    const { html } = render({ errors: errorOn("gpx") });
    const [file] = field(html, "gpx");
    expect(attr(file as Node, "aria-invalid")).toBe("true");
    expect(attr(file as Node, "aria-describedby")).toBe("field-gpx-hint field-gpx-error");
    expect(html).toContain('id="field-gpx-error"');
  });

  it("marks the retention and recap selects", () => {
    const { html } = render({ errors: [...errorOn("retentionDays"), ...errorOn("recapWindow")] });
    for (const name of ["retentionDays", "recapWindow"]) {
      const [select] = field(html, name);
      expect(attr(select as Node, "aria-invalid")).toBe("true");
      const hint = name === "recapWindow" ? "field-recapWindow-hint " : "";
      expect(attr(select as Node, "aria-describedby")).toBe(`${hint}field-${name}-error`);
      expect(html).toContain(`id="field-${name}-error"`);
    }
  });

  it("marks the template options group when it has an error", () => {
    const { html } = render({ errors: errorOn("keepAsTemplate") });
    expect(html).toContain('id="field-template-error"');
    const [box] = field(html, "keepAsTemplate");
    expect(attr(box as Node, "aria-invalid")).toBe("true");
    expect(attr(box?.parent?.parent as Node, "aria-describedby")).toBe(
      "field-template-hint field-template-error",
    );
  });

  it("adds none of it without an error", () => {
    const { html } = render({});
    expect(html).not.toContain("field-dropPolicy-error");
    expect(html).not.toContain("field-joinMode-error");
    expect(html).not.toContain("field-gpx-error");
    expect(html).not.toContain("field-template-error");
    expect(html).not.toMatch(/aria-invalid/);
  });
});

describe("example placeholders (decision D74)", () => {
  describe.each(["en", "de", "fr"] as const)("in %s", (language) => {
    const tl = translator(language);
    const catalog = (key: Parameters<typeof tl>[0]) => tl(key);
    const withLanguage = (overrides: Parameters<typeof render>[0] = {}) =>
      render({ ...overrides, t: tl });

    it("shows the translated examples in the text fields and the note", () => {
      const { root } = withLanguage({ values: { posterName: "Anna" } });
      const expected = {
        areaLabel: "placeholder.areaLabel",
        distanceKm: "placeholder.distance",
        elevationGainM: "placeholder.elevation",
        exactDescription: "placeholder.exactDescription",
        note: "placeholder.note",
      } as const;
      for (const [name, key] of Object.entries(expected)) {
        const control = named(root, name)[0] as Node;
        expect(attr(control, "placeholder")).toBe(catalog(key as keyof typeof en));
      }
    });

    it("keeps the blank placeholder on required fields without an example", () => {
      const { root } = withLanguage({});
      for (const name of ["title", "posterName"]) {
        expect(attr(named(root, name)[0] as Node, "placeholder")).toBe(" ");
      }
    });

    it("leaves the pace fields without a placeholder: their unit depends on the activity", () => {
      const { root } = withLanguage({});
      for (const name of ["paceFrom", "paceTo"]) {
        expect(hasAttr(named(root, name)[0] as Node, "placeholder")).toBe(false);
      }
    });

    it("no longer has the meeting-area example in the hint under the field", () => {
      const { html } = withLanguage({});
      const example = catalog("placeholder.areaLabel");
      const hint = new RegExp(`<p class="hint"[^>]*>([^<]*)</p>`, "g");
      const hints = [...html.matchAll(hint)].map((m) => m[1] ?? "");
      expect(hints.join("\n")).not.toContain(example);
      expect(html).toContain(escaped(catalog("form.areaLabelHint")));
    });
  });

  it("keeps the example out of the value: an empty field has no value attribute text", () => {
    const { root } = render({});
    expect(attr(named(root, "areaLabel")[0] as Node, "value")).toBe("");
  });
});

describe("hints named by aria-describedby (decision D74)", () => {
  const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const describedby = (node: Node) => (attr(node, "aria-describedby") ?? "").split(" ");

  it("gives the Field hint an id and lists it alone, never the required hint", () => {
    const { root } = render({});
    for (const name of ["areaLabel", "posterName"]) {
      const hint = all(root).find((node) => attr(node, "id") === `field-${name}-hint`);
      expect(hint?.tag).toBe("p");
      expect(classes(hint as Node)).toContain("hint");
      expect(describedby(named(root, name)[0] as Node)).toEqual([`field-${name}-hint`]);
    }
  });

  it("lists the hint and the error for a hinted field with an error, without the required hint", () => {
    const { root } = render({ errors: errorOn("areaLabel") });
    expect(describedby(named(root, "areaLabel")[0] as Node)).toEqual([
      "field-areaLabel-hint",
      "field-areaLabel-error",
    ]);
  });

  it("names the hint of an optional field, the note and the recap window select", () => {
    const { root } = render({});
    expect(describedby(named(root, "note")[0] as Node)).toEqual(["field-note-hint"]);
    expect(describedby(named(root, "recapWindow")[0] as Node)).toEqual(["field-recapWindow-hint"]);
  });

  it("leaves a field without a hint without aria-describedby", () => {
    const { root } = render({ values: { posterName: "Anna" } });
    expect(hasAttr(named(root, "distanceKm")[0] as Node, "aria-describedby")).toBe(false);
    expect(hasAttr(named(root, "retentionDays")[0] as Node, "aria-describedby")).toBe(false);
  });

  it("names the hint of the pace, join mode, share buttons, visibility and template fieldsets", () => {
    const { root } = render({ visibility: everything });
    const fieldsetOf = (name: string) => {
      const control = named(root, name)[0] as Node;
      for (let up = control.parent; up !== undefined; up = up.parent) {
        if (up.tag === "fieldset") return up;
      }
      throw new Error(`no fieldset around ${name}`);
    };
    expect(describedby(fieldsetOf("paceFrom"))).toEqual(["field-pace-hint"]);
    expect(describedby(fieldsetOf("joinMode"))).toEqual(["field-joinMode-hint"]);
    expect(describedby(fieldsetOf("shareCopy"))).toEqual(["field-shareButtons-hint"]);
    expect(describedby(fieldsetOf("visibility"))).toEqual(["field-visibility-hint"]);
    expect(describedby(fieldsetOf("keepAsTemplate"))).toEqual(["field-template-hint"]);
    const [file] = named(root, "gpx");
    expect(describedby(file as Node)).toEqual(["field-gpx-hint"]);
  });

  it("never names a required hint id in aria-describedby", () => {
    for (const errors of [[], errorOn("areaLabel"), errorOn("title")]) {
      const { root } = render({ errors, values: { title: "Run" } });
      const named_ = all(root)
        .filter((node) => hasAttr(node, "aria-describedby"))
        .flatMap((node) => describedby(node));
      expect(named_.filter((id) => id.endsWith("-required"))).toEqual([]);
    }
  });

  it("only names ids that exist in the page, for a form with and without errors", () => {
    for (const errors of [[], errorOn("areaLabel"), errorOn("joinMode"), errorOn("gpx")]) {
      const { root, html } = render({ errors, visibility: everything });
      const present = ids(html);
      const missing = all(root)
        .filter((node) => hasAttr(node, "aria-describedby"))
        .flatMap((node) => describedby(node))
        .filter((id) => !present.has(id));
      expect(missing).toEqual([]);
    }
  });
});

describe("the Where section (decision D77)", () => {
  const withSearch = { placeSearch: true } as const;

  it("labels the area field Area, the heading Where and the description Description of the meeting point", () => {
    const { html } = render({});
    expect(html).toContain(`<h2>${en["form.where"]}</h2>`);
    expect(html).toContain('<label for="field-areaLabel">Area</label>');
    expect(html).toContain(
      '<label for="field-exactDescription">Description of the meeting point</label>',
    );
    expect(html).toContain(en["fold.exact"]);
    expect(html).not.toContain("Meeting area</label>");
    expect(html).not.toContain("Where exactly?");
  });

  it("without the place search the area stays a plain required text field", () => {
    const { html, root } = render({});
    const [area] = named(root, "areaLabel");
    expect(attr(area as Node, "required")).toBeDefined();
    expect(attr(area as Node, "autocomplete")).toBeUndefined();
    expect(html).not.toContain("line-action");
    expect(html).not.toContain("data-place-search");
    expect(html).toContain('id="field-areaLabel-required"');
  });

  it("with the place search the area input sits in a line-action row with the magnifier button", () => {
    const { html, root } = render(withSearch);
    expect(named(root, "areaLabel")).toHaveLength(1);
    const row =
      /<div class="inline-input line-action">[\s\S]*?<\/button><\/div>/.exec(html)?.[0] ?? "";
    expect(row).toContain('name="areaLabel"');
    expect(row).toContain('autocomplete="off"');
    expect(row).toContain('aria-required="true"');
    expect(row).toContain('<span class="visually-hidden">Search</span>');
    expect(row).not.toContain("required-hint");
    // The "Required" hint follows the row, and the field's own hint is still named by the input.
    expect(html).toMatch(/<\/button><\/div><p class="required-hint" id="field-areaLabel-required"/);
    expect(row).toContain('aria-describedby="field-areaLabel-hint"');
    expect(html).toContain('id="field-areaLabel-hint"');
    expect(html).toContain('data-placeholder="Search or type a name"');
    expect(html).not.toContain('id="place-search"');
  });

  it("keeps an area error under the field with the search", () => {
    const { html } = render({ ...withSearch, errors: errorOn("areaLabel") });
    expect(html).toContain('id="field-areaLabel-error"');
    expect(html).not.toContain('id="field-areaLabel-required"');
  });

  it("says who sees the exact point once, in the fold's subtitle and not again in its body", () => {
    const { root } = render({});
    const exact = foldByTitle(root, en["fold.exact"]);
    expect(exact.text).not.toContain("Only you and people who join can see this.");
    expect(en["fold.exactNone"]).toContain("only people you accept see it");
  });

  it("offers the description suggestion line only with the map and the place search", () => {
    const map = { tileUrl: "https://t/{z}/{x}/{y}.png", attribution: "a", defaultZoom: 12 };
    expect(render({ map, ...withSearch }).html).toContain(
      '<p class="hint" data-description-suggested="" data-text="Suggested from the map point. Change it if you like." role="status"></p>',
    );
    expect(render({ map }).html).not.toContain("data-description-suggested");
    expect(render(withSearch).html).not.toContain("data-description-suggested");
  });
});

describe("fewer words (decision D79)", () => {
  it("builds the Area hint from its own sentence only; the Note keeps the public hint", () => {
    const { html } = render({});
    const area = /id="field-areaLabel-hint">([^<]*)</.exec(html)?.[1] ?? "";
    expect(area).toBe(escaped(en["form.areaLabelHint"]));
    expect(area).not.toContain("exact meeting point here");
    const note = /id="field-note-hint">([^<]*)</.exec(html)?.[1] ?? "";
    expect(note).toBe(escaped(en["form.publicHint"]));
  });

  it("drops the privacy sentence from the search hint in every language", () => {
    for (const lang of ["en", "de", "fr"] as const) {
      const hint = translator(lang)("map.searchHint");
      expect(hint).not.toMatch(/search service|Suchdienst|service de recherche/);
    }
  });

  it("marks only the who fold to hide its summary when open", () => {
    const { html } = render({});
    expect(html.match(/fold-hide-open/g)).toHaveLength(1);
    const { root } = render({});
    const who = foldByTitle(root, en["fold.who"]);
    expect(classes(who)).toContain("fold-hide-open");
    for (const title of [en["fold.exact"], en["fold.route"], en["fold.look"], en["fold.after"]]) {
      expect(classes(foldByTitle(root, title))).not.toContain("fold-hide-open");
    }
    expect(html).toContain('<span class="visually-hidden fold-sep">, </span>');
  });

  it("gives every fold the same look: none carries a strong marker (D81)", () => {
    const { html } = render({ visibility: everything, values: { visibility: "public" } });
    expect(html).not.toContain("fold-strong");
    expect(html).toContain("fold-warning");
  });

  it("keeps both legends, the join one visually hidden and the find one visible", () => {
    const { root } = render({ visibility: everything });
    const legends = all(foldByTitle(root, en["fold.who"])).filter((node) => node.tag === "legend");
    const byText = (text: string) => legends.find((node) => node.text === text);
    expect(classes(byText(en["form.joinMode"]) as Node)).toContain("visually-hidden");
    expect(byText(en["form.visibility"])).toBeDefined();
    expect(classes(byText(en["form.visibility"]) as Node)).not.toContain("visually-hidden");
  });
});
