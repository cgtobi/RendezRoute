// Layout of the link preview card (spec 3.3) as a Satori element tree: title, time, area,
// distance and pace in the plan colors (spec 3.1), the rough-area map if available, and the
// instance name. Built from PreviewText, which only holds public data.
import { type HexColor, planTheme } from "../../../domain/color.ts";
import type { PreviewText } from "../../in/http/views/preview-text.ts";

export const CARD_SIZE = { width: 1200, height: 630 } as const;
export const MAP_WIDTH = 520;

export interface CardMap {
  tiles: { src: string; left: number; top: number }[];
  /** The public area circle (spec 3.1), in pixels within the map. */
  circle: { x: number; y: number; radius: number };
  attribution: string;
}

/** Satori accepts React-like elements; plain objects avoid a React dependency. */
export interface CardNode {
  type: string;
  props: { style?: Record<string, string | number>; src?: string; children?: CardChild };
}
type CardChild = string | CardNode | (string | CardNode)[];

const node = (
  type: string,
  style: Record<string, string | number>,
  children?: CardChild,
  extra: { src?: string } = {},
): CardNode => ({
  type,
  props: { style, ...extra, ...(children === undefined ? {} : { children }) },
});

const MAX_TITLE = 90;
const clip = (text: string, max: number) => {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
};

export function cardElement({
  text,
  colors,
  instanceName,
  map,
}: {
  text: PreviewText;
  colors: { primary: HexColor; secondary: HexColor };
  instanceName: string;
  map?: CardMap | undefined;
}): CardNode {
  const theme = planTheme(colors);
  const pills = text.details.map((detail) =>
    node(
      "div",
      {
        display: "flex",
        marginRight: 14,
        padding: "8px 20px",
        borderRadius: 999,
        backgroundColor: theme.secondary,
        color: theme.onSecondary,
        fontSize: 30,
        fontWeight: 700,
      },
      detail,
    ),
  );

  const content = node(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      // Fills the card next to the map; a fixed height would add the padding and push the
      // instance name off the card.
      flexGrow: 1,
      flexBasis: 0,
      padding: 56,
    },
    [
      node("div", { display: "flex", flexDirection: "column" }, [
        node(
          "div",
          { display: "flex", fontSize: 26, letterSpacing: 2, textTransform: "uppercase" },
          text.activity,
        ),
        node(
          "div",
          {
            display: "block",
            marginTop: 12,
            fontSize: map === undefined ? 72 : 62,
            fontWeight: 700,
            lineHeight: 1.1,
            lineClamp: 3,
          },
          clip(text.title, MAX_TITLE),
        ),
      ]),
      node("div", { display: "flex", flexDirection: "column" }, [
        node("div", { display: "flex", fontSize: 32 }, text.when),
        node("div", { display: "flex", marginTop: 6, fontSize: 32 }, clip(text.area, 80)),
        ...(pills.length === 0 ? [] : [node("div", { display: "flex", marginTop: 22 }, pills)]),
      ]),
      node("div", { display: "flex", fontSize: 26 }, instanceName),
    ],
  );

  return node(
    "div",
    {
      display: "flex",
      width: CARD_SIZE.width,
      height: CARD_SIZE.height,
      backgroundColor: theme.primary,
      color: theme.onPrimary,
      fontFamily: "Inter",
    },
    map === undefined ? [content] : [content, mapElement(map, theme.secondary)],
  );
}

function mapElement(map: CardMap, color: HexColor): CardNode {
  const { x, y, radius } = map.circle;
  return node(
    "div",
    {
      display: "flex",
      position: "relative",
      width: MAP_WIDTH,
      height: CARD_SIZE.height,
      overflow: "hidden",
      backgroundColor: "#e5e3df",
    },
    [
      ...map.tiles.map((tile) =>
        node(
          "img",
          { position: "absolute", left: tile.left, top: tile.top, width: 256, height: 256 },
          undefined,
          { src: tile.src },
        ),
      ),
      node("div", {
        position: "absolute",
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: "50%",
        border: `6px solid ${color}`,
        backgroundColor: `${color}40`,
      }),
      node(
        "div",
        {
          display: "flex",
          position: "absolute",
          right: 0,
          bottom: 0,
          padding: "4px 10px",
          fontSize: 16,
          color: "#333333",
          backgroundColor: "rgba(255, 255, 255, 0.85)",
        },
        map.attribution,
      ),
    ],
  );
}
