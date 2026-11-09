import { describe, expect, it } from "vite-plus/test";
import { createGpxRouteParser } from "../../../../src/adapters/out/gpx/route-parser.ts";
import { toGpx } from "../../../../src/adapters/out/gpx/write-gpx.ts";
import { ROUTE_LIMITS } from "../../../../src/domain/route.ts";

const parser = createGpxRouteParser();
const bytes = (text: string) => new TextEncoder().encode(text);
const gpx = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="SENTINEL-device" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

/** Rejections must be quick, never a hang (spec 2b security tests). */
function quickly<T>(run: () => T): T {
  const start = performance.now();
  const result = run();
  expect(performance.now() - start).toBeLessThan(1000);
  return result;
}

describe("GPX parsing (spec 5 feature 2, 3.8 Uploads)", () => {
  it("reads track points with elevation and ignores times, sensor data and metadata", () => {
    const file = gpx(`
      <metadata><author><name>SENTINEL-author</name></author></metadata>
      <trk><name>Morning run</name><trkseg>
        <trkpt lat="48.1500" lon="11.5800"><ele>520.4</ele><time>2026-05-01T06:00:00Z</time>
          <extensions><hr>SENTINEL-142</hr></extensions></trkpt>
        <trkpt lat="48.1510" lon="11.5820"><ele>523.9</ele><time>2026-05-01T06:00:10Z</time></trkpt>
      </trkseg></trk>`);
    const result = parser.parse(bytes(file));
    expect(result).toEqual({
      ok: true,
      value: {
        segments: [
          [
            { lat: 48.15, lng: 11.58, ele: 520.4 },
            { lat: 48.151, lng: 11.582, ele: 523.9 },
          ],
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
  });

  it("reads routes (rtept) and multiple track segments", () => {
    const file = gpx(`
      <rte><rtept lat="1" lon="1"/><rtept lat="1" lon="2"/></rte>
      <trk><trkseg><trkpt lat="2" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
           <trkseg><trkpt lat="3" lon="1"/><trkpt lat="3" lon="2"/></trkseg></trk>`);
    const result = parser.parse(bytes(file));
    expect(result.ok && result.value.segments).toHaveLength(3);
  });

  it("rejects files over 5 MB before parsing", () => {
    const big = new Uint8Array(ROUTE_LIMITS.maxBytes + 1);
    expect(quickly(() => parser.parse(big))).toEqual({ ok: false, error: "route_too_large" });
  });

  it("rejects entity expansion (billion laughs) without expanding anything", () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${Array.from(
      { length: 9 },
      (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i === 0 ? "" : i};`.repeat(10)}">`,
    ).join("")}]><gpx><trk><name>&lol9;</name></trk></gpx>`;
    expect(quickly(() => parser.parse(bytes(laughs)))).toEqual({
      ok: false,
      error: "route_unsafe",
    });
  });

  it("rejects external entities (XXE)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx><trk><name>&xxe;</name></trk></gpx>`;
    expect(parser.parse(bytes(xxe))).toEqual({ ok: false, error: "route_unsafe" });
  });

  it("rejects deeply nested files without recursion problems", () => {
    const deep = gpx(`${"<x>".repeat(100_000)}${"</x>".repeat(100_000)}`);
    expect(quickly(() => parser.parse(bytes(deep)))).toEqual({ ok: false, error: "route_unsafe" });
  });

  it("does not count tags inside comments or CDATA as nesting", () => {
    const file = gpx(
      `<!-- ${"<x>".repeat(100)} --><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="2"/></trkseg></trk>`,
    );
    expect(parser.parse(bytes(file)).ok).toBe(true);
  });

  it("rejects malformed XML and files without a route", () => {
    expect(parser.parse(bytes("<gpx><trk>"))).toEqual({ ok: false, error: "route_unreadable" });
    expect(parser.parse(bytes("not xml at all"))).toEqual({ ok: false, error: "route_unreadable" });
    expect(parser.parse(bytes(gpx("<wpt lat='1' lon='1'/>")))).toEqual({
      ok: false,
      error: "route_empty",
    });
  });

  it("rejects files with far too many points before building a document", () => {
    // A broken tail makes any built document "unreadable"; counting the points first answers
    // "too many points" instead. This checks the order without timing it (user decision
    // 2026-11-09; the test used to require 200 ms, which failed on busy machines).
    const brokenTail = "<trk><trkseg><trkpt";
    const file = (count: number) =>
      bytes(
        gpx(`<trk><trkseg>${'<trkpt lat="1" lon="1"/>'.repeat(count)}</trkseg></trk>${brokenTail}`),
      );
    expect(parser.parse(file(3))).toEqual({ ok: false, error: "route_unreadable" });
    expect(parser.parse(file(200_000))).toEqual({ ok: false, error: "route_too_many_points" });
  });

  it("rejects more than 50,000 points", () => {
    const points = Array.from(
      { length: ROUTE_LIMITS.maxPoints + 1 },
      (_, i) => `<trkpt lat="1" lon="${(i / 1e5).toFixed(5)}"/>`,
    ).join("");
    expect(parser.parse(bytes(gpx(`<trk><trkseg>${points}</trkseg></trk>`)))).toEqual({
      ok: false,
      error: "route_too_many_points",
    });
  });
});

describe("toGpx (decision D10: regenerated downloads)", () => {
  const route = {
    segments: [
      [
        { lat: 48.15, lng: 11.58, ele: 520.4 },
        { lat: 48.151, lng: 11.582 },
      ],
      [
        { lat: 1, lng: 2 },
        { lat: 1.5, lng: 2.5 },
      ],
    ],
  };

  it("writes points, elevation and the title only, and parses back to the same route", () => {
    const file = toGpx(route, 'Easy <Sunday> & "run"');
    expect(file).toContain("<name>Easy &lt;Sunday&gt; &amp; &quot;run&quot;</name>");
    expect(file).not.toMatch(/<time>|<extensions>|<author>/);
    expect(parser.parse(bytes(file))).toEqual({ ok: true, value: route });
  });
});
