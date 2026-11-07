// GPX parsing (spec 2, 3.8 Uploads, decision D10). Defense in layers: size first, then any
// DOCTYPE is rejected (no DTD means no entities to expand), then nesting depth is checked
// on the raw text, so the XML parser only ever sees small, flat, entity-free documents.
import { gpx as toGeoJson } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import type { RouteParser } from "../../../application/ports.ts";
import { ROUTE_LIMITS, type RoutePoint, validateRoute } from "../../../domain/route.ts";
import { err } from "../../../domain/result.ts";

const MAX_DEPTH = 32;

/** Deepest element nesting, ignoring comments, CDATA and processing instructions. */
function maxDepth(xml: string): number {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  let depth = 0;
  let deepest = 0;
  for (const tag of text.matchAll(/<(\/?)[A-Za-z_][^>]*?(\/?)>/g)) {
    if (tag[1] === "/") depth--;
    else if (tag[2] !== "/") deepest = Math.max(deepest, ++depth);
  }
  return deepest;
}

/** Track and route point elements, optionally namespace-prefixed. */
function countPoints(xml: string): number {
  let count = 0;
  for (const _ of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?(?:trkpt|rtept)\b/g)) count++;
  return count;
}

type Position = [number, number, number?];

export function createGpxRouteParser(): RouteParser {
  return {
    parse(file) {
      if (file.byteLength > ROUTE_LIMITS.maxBytes) return err("route_too_large");
      const xml = new TextDecoder("utf-8").decode(file);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || maxDepth(xml) > MAX_DEPTH) return err("route_unsafe");
      // Count points in the raw text, so oversized files never become a document.
      if (countPoints(xml) > ROUTE_LIMITS.maxPoints) return err("route_too_many_points");

      let document: ReturnType<DOMParser["parseFromString"]>;
      try {
        document = new DOMParser({
          onError: (level) => {
            if (level !== "warning") throw new Error("malformed");
          },
        }).parseFromString(xml, "application/xml");
      } catch {
        return err("route_unreadable");
      }
      if (document.documentElement?.localName !== "gpx") return err("route_unreadable");

      const segments: RoutePoint[][] = [];
      let points = 0;
      for (const feature of toGeoJson(document as unknown as Parameters<typeof toGeoJson>[0])
        .features) {
        const geometry = feature.geometry;
        const lines: Position[][] =
          geometry?.type === "LineString"
            ? [geometry.coordinates as Position[]]
            : geometry?.type === "MultiLineString"
              ? (geometry.coordinates as Position[][])
              : [];
        for (const line of lines) {
          points += line.length;
          if (points > ROUTE_LIMITS.maxPoints) return err("route_too_many_points");
          segments.push(
            line.map(([lng, lat, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })),
          );
        }
      }
      return validateRoute({ segments });
    },
  };
}
