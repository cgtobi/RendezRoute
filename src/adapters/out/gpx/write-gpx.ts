// Regenerated route files (decisions D10, D12): points, elevation and the plan title, nothing else.
import type { Route } from "../../../domain/route.ts";

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function toGpx(route: Route, title: string): string {
  const name = escapeXml(title);
  const segments = route.segments
    .map((segment) => {
      const points = segment
        .map((point) => {
          const ele = point.ele === undefined ? "" : `<ele>${point.ele}</ele>`;
          return `<trkpt lat="${point.lat}" lon="${point.lng}">${ele}</trkpt>`;
        })
        .join("\n");
      return `<trkseg>\n${points}\n</trkseg>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RendezRoute" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${name}</name></metadata>
<trk><name>${name}</name>
${segments}
</trk>
</gpx>
`;
}

/** GeoJSON for the plan map: one line per segment, positions as [lng, lat, ele?] (RFC 7946). */
export function toGeoJson(route: Route): { type: "MultiLineString"; coordinates: number[][][] } {
  return {
    type: "MultiLineString",
    coordinates: route.segments.map((segment) =>
      segment.map((point) =>
        point.ele === undefined ? [point.lng, point.lat] : [point.lng, point.lat, point.ele],
      ),
    ),
  };
}
