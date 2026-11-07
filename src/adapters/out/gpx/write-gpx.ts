// Regenerated GPX downloads (decision D10): points, elevation and the plan title, nothing else.
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
