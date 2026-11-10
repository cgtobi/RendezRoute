// Layout of the link preview card (spec 3.3) as a Satori element tree, like the plan page (decisions
// D27, D29): a light card with a bar in the plan's primary colour (spec 3.1) above the title, time
// and area as boxes with icons, distance and pace in one line, the rough-area map if available, and
// the instance name with the site's mark. Built from PreviewText, which only holds public data.
import { readFileSync } from "node:fs";
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

/** The page's light colours, named after their tokens in public/app.css (decision D27). */
const BG = "#ffffff";
const FG = "#16181d";
const MUTED = "#5c636e";
const LINE = "#e4e7eb";
const SURFACE = "#f3f4f6";
const ACCENT = "#2c67a8";

/** The bundled icons the card uses, and how each is drawn: outlined, or filled (the mark, D28). */
const ICONS = { calendar: "stroke", pin: "stroke", logo: "fill" } as const;
type IconName = keyof typeof ICONS;

/** Read once. src/ and dist/ sit at the same depth, so the path works from both (as in app.tsx). */
const iconFiles = new Map<IconName, string>();
function iconFile(name: IconName): string {
  let svg = iconFiles.get(name);
  if (svg === undefined) {
    svg = readFileSync(new URL(`../../../../public/icons/${name}.svg`, import.meta.url), "utf8");
    iconFiles.set(name, svg);
  }
  return svg;
}

/**
 * A bundled icon as an image (Satori renders SVG from data URIs), drawn in `color`: the colour
 * replaces the file's own stroke or fill on its root element, which its shapes inherit.
 */
function icon(name: IconName, color: string, size: { width: number; height: number }): CardNode {
  const drawn = ICONS[name];
  const svg = iconFile(name).replace(
    /<svg\b[^>]*>/,
    (root) =>
      `${root.slice(0, -1).replace(new RegExp(`\\s${drawn}="[^"]*"`), "")} ${drawn}="${color}">`,
  );
  return node("img", { ...size, flexShrink: 0 }, undefined, {
    src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  });
}

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
  const box = (name: IconName, label: string) =>
    node(
      "div",
      {
        display: "flex",
        alignItems: "center",
        alignSelf: "flex-start",
        marginTop: 12,
        padding: "10px 20px",
        border: `2px solid ${LINE}`,
        borderRadius: 12,
        backgroundColor: SURFACE,
        fontSize: 28,
        fontWeight: 700,
      },
      [
        icon(name, MUTED, { width: 30, height: 30 }),
        node("div", { display: "flex", marginLeft: 14 }, label),
      ],
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
      padding: "0 56px 48px",
    },
    [
      node("div", { display: "flex", flexDirection: "column" }, [
        // The plan's mark: a bar in its primary colour above the title, as on the plan page.
        node("div", { display: "flex", height: 14, backgroundColor: theme.primary }),
        node(
          "div",
          {
            display: "flex",
            marginTop: 40,
            color: MUTED,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
          },
          text.activity,
        ),
        node(
          "div",
          {
            display: "block",
            marginTop: 10,
            fontSize: map === undefined ? 64 : 56,
            fontWeight: 700,
            lineHeight: 1.1,
            lineClamp: 2,
          },
          clip(text.title, MAX_TITLE),
        ),
      ]),
      node("div", { display: "flex", flexDirection: "column" }, [
        box("calendar", text.when),
        box("pin", clip(text.area, 80)),
        ...(text.details.length === 0
          ? []
          : [
              node(
                "div",
                { display: "flex", marginTop: 20, fontSize: 30, fontWeight: 700 },
                text.details.join(" · "),
              ),
            ]),
      ]),
      node(
        "div",
        { display: "flex", alignItems: "center", color: ACCENT, fontSize: 28, fontWeight: 700 },
        [
          icon("logo", ACCENT, { width: 22, height: 34 }),
          node("div", { display: "flex", marginLeft: 12 }, instanceName),
        ],
      ),
    ],
  );

  return node(
    "div",
    {
      display: "flex",
      width: CARD_SIZE.width,
      height: CARD_SIZE.height,
      backgroundColor: BG,
      color: FG,
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
