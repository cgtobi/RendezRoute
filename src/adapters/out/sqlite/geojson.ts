// Routes are stored as GeoJSON (decision D10), for plans and templates alike.
import type { Route } from "../../../domain/route.ts";

type Position = [number, number] | [number, number, number];
export interface MultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
}

/** GeoJSON order: [longitude, latitude, elevation?]. */
export const toGeoJson = (route: Route): MultiLineString => ({
  type: "MultiLineString",
  coordinates: route.segments.map((segment) =>
    segment.map((p): Position => (p.ele === undefined ? [p.lng, p.lat] : [p.lng, p.lat, p.ele])),
  ),
});

export const fromGeoJson = (geojson: MultiLineString): Route => ({
  segments: geojson.coordinates.map((line) =>
    line.map(([lng, lat, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })),
  ),
});
