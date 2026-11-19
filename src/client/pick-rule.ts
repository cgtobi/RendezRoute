// What a tap on the form map does and what its lines say (decisions D66, ADR 008), apart from
// Leaflet and the DOM so it can be tested in Node. Shared by the page map and its full-screen view.
import type { Point } from "./geo.ts";

/** The two points a tap can set: the public area or the exact start. */
export type PickMode = "area" | "exact";

/** Which point the full-screen view's status line names. */
export type PointStatus = "exact" | "area" | "none";

/** The caption under the mode switch: which of its three `data-caption-*` texts to show. */
export type CaptionKind = "area" | "exact" | "areaFollows";

/**
 * Whether a tap sets a point. In area mode with an exact start set the public area follows that
 * start (spec 3.1), so the tap would change nothing the server uses: it is ignored.
 */
export function tapEffect(mode: PickMode, exactSet: boolean): "set" | "ignored" {
  return mode === "area" && exactSet ? "ignored" : "set";
}

/** The caption for the selected mode; in area mode with an exact start, why a tap does nothing. */
export function captionFor(mode: PickMode, exactSet: boolean): CaptionKind {
  if (mode === "exact") return "exact";
  return exactSet ? "areaFollows" : "area";
}

/** The point the status line names: the exact start when set, else the public area, else none. */
export function pointStatus(exact: Point | undefined, area: Point | undefined): PointStatus {
  if (exact !== undefined) return "exact";
  if (area !== undefined) return "area";
  return "none";
}

/**
 * The point "Remove point" removes (lead decision 2): the one the status line names, whatever mode
 * is selected. Undefined when nothing is set.
 */
export function removeTarget(status: PointStatus): PickMode | undefined {
  return status === "none" ? undefined : status;
}
