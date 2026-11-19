// The form map's tap, caption and status rules (decision D66, ADR 008), without a browser. The
// page map and its full-screen view both follow them; e2e/map-pick.spec.ts drives the real maps.
import { describe, expect, it } from "vite-plus/test";
import { captionFor, pointStatus, removeTarget, tapEffect } from "../../src/client/pick-rule.ts";

const POINT = { lat: 48.1107, lng: 11.5582 };

describe("tapEffect", () => {
  it("sets the point of the selected mode", () => {
    expect(tapEffect("area", false)).toBe("set");
    expect(tapEffect("exact", false)).toBe("set");
    expect(tapEffect("exact", true)).toBe("set");
  });

  it("ignores an area tap while the exact start is set: the public area follows it (spec 3.1)", () => {
    expect(tapEffect("area", true)).toBe("ignored");
  });
});

describe("captionFor", () => {
  it("says what a tap sets, and why an area tap does nothing with an exact start", () => {
    expect(captionFor("area", false)).toBe("area");
    expect(captionFor("area", true)).toBe("areaFollows");
    expect(captionFor("exact", false)).toBe("exact");
    expect(captionFor("exact", true)).toBe("exact");
  });
});

describe("pointStatus", () => {
  it("names the exact start first, then the public area, else none", () => {
    expect(pointStatus(POINT, POINT)).toBe("exact");
    expect(pointStatus(POINT, undefined)).toBe("exact");
    expect(pointStatus(undefined, POINT)).toBe("area");
    expect(pointStatus(undefined, undefined)).toBe("none");
  });
});

describe("removeTarget (lead decision 2)", () => {
  it("removes the point the status names, whatever mode is selected", () => {
    expect(removeTarget("exact")).toBe("exact");
    expect(removeTarget("area")).toBe("area");
    expect(removeTarget("none")).toBeUndefined();
  });

  it("removes the exact start while the area is set as well, so the area is next", () => {
    const first = removeTarget(pointStatus(POINT, POINT));
    expect(first).toBe("exact");
    expect(removeTarget(pointStatus(undefined, POINT))).toBe("area");
  });
});
