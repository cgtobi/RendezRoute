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
import { TestClient } from "../../support/client.ts";
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
  new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?(?=\\s|$)`).exec(node.attributes.trim())?.[1] ??
  (new RegExp(`(?:^|\\s)${name}(?=\\s|$|=)`).test(node.attributes) ? "" : undefined);

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
    expect(summary?.text).toBe(`Time zone, Europe/Berlin · ${en["layout.change"]}`);
    expect(all(zoneLine).some((node) => attr(node, "data-zone-name") !== undefined)).toBe(true);
    expect(named(zoneLine, "timeZone")).toHaveLength(1);
    expect(zoneLine.text).toContain(en["form.timeZone"]);
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
    expect(summary?.text).toBe(`Hosting as Anna · ${en["layout.change"]}`);
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

  it("who: public starts with 'Public', carries the warning class and the strong weight", () => {
    const { root } = render({ visibility: everything, values: { visibility: "public" } });
    const fold = foldByTitle(root, en["fold.who"]);
    expect(foldValue(fold)).toBe("Public · Join: anyone with the link · Find: anyone");
    expect(classes(fold)).toContain("fold-warning");
    expect(classes(fold)).toContain("fold-strong");
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
      `<span class="fold-title">${en["fold.who"]}</span><span class="visually-hidden">, </span>`,
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
      `Time zone, Europe/Berlin · ${en["layout.change"]}`,
    );
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
