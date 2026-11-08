/** A small GPX track. Its first point is a recognizable sentinel coordinate. */
export function sampleGpx({ lat = 47.12345, extra = "", count = 5 } = {}): string {
  const points = Array.from(
    { length: count },
    (_, i) =>
      `<trkpt lat="${(lat + i * 0.001).toFixed(5)}" lon="10.98765"><ele>${800 + i * 10}</ele><time>2026-05-01T06:${String(i).padStart(2, "0")}:00Z</time></trkpt>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="SENTINEL-device" xmlns="http://www.topografix.com/GPX/1/1">${extra}<trk><name>Old run</name><trkseg>${points}</trkseg></trk></gpx>`;
}
