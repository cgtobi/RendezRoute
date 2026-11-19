// The full-screen plan map's views and key (ADR 008), without a browser.
import { describe, expect, it } from "vite-plus/test";
import { AREA_RADIUS_M, distanceMeters } from "../../src/client/geo.ts";
import {
  legendEntries,
  locateView,
  NEAR_METRES,
  PLAN_ZOOM,
  planFocus,
} from "../../src/client/plan-view.ts";

const AREA = { lat: 48.16, lng: 11.6 };
const EXACT = { lat: 48.16321, lng: 11.60147 };

describe("distanceMeters", () => {
  it("measures a degree of latitude as about 111 km and a point to itself as 0", () => {
    expect(distanceMeters({ lat: 48, lng: 11 }, { lat: 49, lng: 11 })).toBeCloseTo(111_195, -2);
    expect(distanceMeters(AREA, AREA)).toBe(0);
    // Symmetric.
    expect(distanceMeters(AREA, EXACT)).toBeCloseTo(distanceMeters(EXACT, AREA), 6);
  });
});

describe("planFocus", () => {
  it("opens on the area at the page map's zoom without an exact start", () => {
    expect(planFocus(AREA, undefined)).toEqual({ kind: "point", center: AREA, zoom: PLAN_ZOOM });
    expect(PLAN_ZOOM).toBe(14);
  });

  it("fits the whole area circle and the exact start when the page has the exact start", () => {
    const view = planFocus(AREA, EXACT);
    if (view.kind !== "bounds") throw new Error("expected bounds");
    // The circle's box: its radius north and south of the centre.
    expect(distanceMeters(AREA, { lat: view.southWest.lat, lng: AREA.lng })).toBeCloseTo(
      AREA_RADIUS_M,
      -1,
    );
    expect(distanceMeters(AREA, { lat: AREA.lat, lng: view.northEast.lng })).toBeCloseTo(
      AREA_RADIUS_M,
      -1,
    );
    expect(view.southWest.lat).toBeLessThan(EXACT.lat);
    expect(view.northEast.lat).toBeGreaterThanOrEqual(EXACT.lat);
  });

  it("stretches the box to an exact start outside the circle", () => {
    const far = { lat: 48.2, lng: 11.7 };
    const view = planFocus(AREA, far);
    if (view.kind !== "bounds") throw new Error("expected bounds");
    expect(view.northEast).toEqual(far);
  });

  it("stays finite at the pole", () => {
    const view = planFocus({ lat: 90, lng: 0 }, { lat: 89.99, lng: 0 });
    if (view.kind !== "bounds") throw new Error("expected bounds");
    expect(Number.isFinite(view.southWest.lng)).toBe(true);
    expect(Number.isFinite(view.northEast.lng)).toBe(true);
  });
});

describe("locateView (lead decision 6)", () => {
  it("fits the position and the plan's point within 20 km", () => {
    const me = { lat: 48.1, lng: 11.55 };
    expect(locateView(me, 30, EXACT)).toEqual({
      kind: "bounds",
      southWest: { lat: 48.1, lng: 11.55 },
      northEast: EXACT,
    });
  });

  it("centres on the position alone beyond 20 km, at the zoom its accuracy allows", () => {
    const berlin = { lat: 52.52, lng: 13.405 };
    expect(locateView(berlin, 30, EXACT)).toEqual({ kind: "point", center: berlin, zoom: 15 });
    expect(locateView(berlin, 5000, EXACT)).toEqual({ kind: "point", center: berlin, zoom: 13 });
  });

  it("draws the line at 20 km", () => {
    expect(NEAR_METRES).toBe(20_000);
    // 0.17° of latitude is about 18.9 km, 0.19° about 21.1 km.
    expect(locateView({ lat: AREA.lat + 0.17, lng: AREA.lng }, 30, AREA).kind).toBe("bounds");
    expect(locateView({ lat: AREA.lat + 0.19, lng: AREA.lng }, 30, AREA).kind).toBe("point");
  });
});

describe("legendEntries", () => {
  it("lists the area alone for a viewer", () => {
    expect(legendEntries({ hasExact: false, hasRoute: false })).toEqual(["area"]);
  });

  it("lists the exact start and the route when the page map has them", () => {
    expect(legendEntries({ hasExact: true, hasRoute: true })).toEqual(["area", "exact", "route"]);
    expect(legendEntries({ hasExact: true, hasRoute: true, routeLoaded: true })).toEqual([
      "area",
      "exact",
      "route",
    ]);
    expect(legendEntries({ hasExact: true, hasRoute: false })).toEqual(["area", "exact"]);
    expect(legendEntries({ hasExact: false, hasRoute: true })).toEqual(["area", "route"]);
  });

  it("drops the route once its file failed to load", () => {
    expect(legendEntries({ hasExact: true, hasRoute: true, routeLoaded: false })).toEqual([
      "area",
      "exact",
    ]);
    // Without a route there is nothing to load: a stray flag adds nothing.
    expect(legendEntries({ hasExact: false, hasRoute: false, routeLoaded: true })).toEqual([
      "area",
    ]);
  });
});
