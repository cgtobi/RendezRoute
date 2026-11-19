// GPX parsing (spec 2, 3.8 Uploads, decision D10). Defense in layers: size first, then any
// DOCTYPE is rejected (no DTD means no entities to expand), then nesting depth is checked
// on the raw text, so the XML parser only ever sees small, flat, entity-free documents.
import { gpx as toGeoJson } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import type { RouteParser } from "../../../application/ports.ts";
import { ROUTE_LIMITS, type RoutePoint, validateRoute } from "../../../domain/route.ts";
import { err } from "../../../domain/result.ts";

const MAX_DEPTH = 32;

/**
 * Index of the `>` that ends the tag starting at `from`; -1 when a `<` appears first (malformed);
 * the text length when the file simply ends inside the tag (truncated, the XML parser rejects it).
 */
function tagEnd(xml: string, from: number): number {
  for (let i = from; i < xml.length; i++) {
    const code = xml.charCodeAt(i);
    if (code === 62) return i; // ">"
    if (code === 60) return -1; // "<" inside a tag is malformed
    if (code === 34 || code === 39) {
      // A quoted attribute value may contain ">".
      const close = xml.indexOf(xml[i] ?? '"', i + 1);
      if (close === -1) return xml.length;
      i = close;
    }
  }
  return xml.length;
}

/**
 * Deepest element nesting, ignoring comments, CDATA and processing instructions. One linear
 * pass with no backtracking, so hostile input cannot stall the event loop. Anything left
 * unterminated (comment, CDATA, PI, tag) is malformed and reported as infinitely deep.
 */
function maxDepth(xml: string): number {
  let depth = 0;
  let deepest = 0;
  let i = xml.indexOf("<");
  while (i !== -1) {
    let next: number;
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) return Number.POSITIVE_INFINITY;
      next = end + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end === -1) return Number.POSITIVE_INFINITY;
      next = end + 3;
    } else if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end === -1) return Number.POSITIVE_INFINITY;
      next = end + 2;
    } else if (xml.startsWith("<!", i)) {
      const end = tagEnd(xml, i + 2);
      if (end === -1) return Number.POSITIVE_INFINITY;
      next = end + 1;
    } else if (xml.charCodeAt(i + 1) === 47) {
      // "</"
      const end = tagEnd(xml, i + 2);
      if (end === -1) return Number.POSITIVE_INFINITY;
      depth--;
      next = end + 1;
    } else if (/[A-Za-z_]/.test(xml[i + 1] ?? "")) {
      const end = tagEnd(xml, i + 2);
      if (end === -1) return Number.POSITIVE_INFINITY;
      if (end < xml.length && xml.charCodeAt(end - 1) !== 47) deepest = Math.max(deepest, ++depth);
      next = end + 1;
    } else {
      next = i + 1;
    }
    i = xml.indexOf("<", next);
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
