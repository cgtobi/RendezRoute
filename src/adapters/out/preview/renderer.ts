// Open Graph card images with Satori (layout to SVG) and resvg (SVG to PNG), spec 2. Map tiles are
// embedded as data URIs, so no further image library is needed. Fonts are bundled OFL files
// (Inter, from @fontsource/inter, and Archivo Narrow for the palette "archivo", from
// @fontsource/archivo-narrow; licenses included in the packages).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { PlanPreview } from "../../../application/plan-views.ts";
import type { MapTiles, PreviewRenderer } from "../../../application/ports.ts";
import type { Palette } from "../../../domain/palette.ts";
import { err, ok } from "../../../domain/result.ts";
import { previewText } from "../../in/http/views/preview-text.ts";
import { type CardMap, CARD_SIZE, cardElement, MAP_WIDTH } from "./card.ts";
import { tileWindow } from "./tiles.ts";

const MAP_ZOOM = 14;
/** Radius of the public area circle, as on the plan page (spec 3.1). */
const AREA_RADIUS_M = 750;
/** Latin, Latin Extended, Cyrillic and Greek; Satori picks per glyph. */
const FONT_SUBSETS = ["latin", "latin-ext", "cyrillic", "greek"] as const;

const ARCHIVO_SUBSETS = ["latin", "latin-ext"] as const;

type Font = { name: "Inter" | "Archivo Narrow"; data: Buffer; weight: 400 | 700; style: "normal" };

let fonts: Promise<Font[]> | undefined;
function loadFonts(): Promise<Font[]> {
  const require = createRequire(import.meta.url);
  const load = (name: Font["name"], pkg: string, file: string, weight: 400 | 700) =>
    readFile(require.resolve(`${pkg}/files/${file}`)).then((data): Font => ({
      name,
      data,
      weight,
      style: "normal",
    }));
  fonts ??= Promise.all([
    ...FONT_SUBSETS.flatMap((subset) =>
      ([400, 700] as const).map((weight) =>
        load("Inter", "@fontsource/inter", `inter-${subset}-${weight}-normal.woff`, weight),
      ),
    ),
    // The "archivo" palette; Latin and Latin Extended only (satori falls back per glyph).
    ...ARCHIVO_SUBSETS.flatMap((subset) =>
      ([400, 700] as const).map((weight) =>
        load(
          "Archivo Narrow",
          "@fontsource/archivo-narrow",
          `archivo-narrow-${subset}-${weight}-normal.woff`,
          weight,
        ),
      ),
    ),
  ]);
  return fonts;
}

export function createPreviewRenderer({
  instanceName,
  attribution,
  tiles,
  palette = "default",
  maxConcurrent = 1,
  maxQueue = 8,
}: {
  instanceName: string;
  attribution: string;
  /** Undefined when maps or server-side tile fetching are disabled: cards without a map. */
  tiles: MapTiles | undefined;
  /** The instance palette (config.palette) the cards are drawn in. */
  palette?: Palette;
  maxConcurrent?: number;
  maxQueue?: number;
}): PreviewRenderer {
  const limit = createLimiter(maxConcurrent, maxQueue);

  const mapFor = async (preview: PlanPreview): Promise<CardMap | undefined> => {
    if (tiles === undefined || preview.areaPoint === undefined) return undefined;
    const window = tileWindow(preview.areaPoint, MAP_ZOOM, MAP_WIDTH, CARD_SIZE.height);
    const images: CardMap["tiles"] = [];
    // Two at a time, as tile usage policies ask (e.g. OpenStreetMap).
    for (let i = 0; i < window.tiles.length; i += 2) {
      const batch = window.tiles.slice(i, i + 2);
      const loaded = await Promise.all(batch.map((t) => tiles.tile(window.zoom, t.x, t.y)));
      for (const [index, image] of loaded.entries()) {
        // A card without a map beats a map with holes.
        if (image === undefined) return undefined;
        const { left, top } = batch[index]!;
        images.push({ src: dataUri(image), left, top });
      }
    }
    return {
      tiles: images,
      circle: {
        x: MAP_WIDTH / 2,
        y: CARD_SIZE.height / 2,
        radius: Math.round(AREA_RADIUS_M / window.metersPerPixel),
      },
      attribution,
    };
  };

  return {
    render: (preview) =>
      limit(async () => {
        const element = cardElement({
          text: previewText(preview),
          colors: preview.colors,
          instanceName,
          map: await mapFor(preview),
          palette,
        });
        const svg = await satori(element as never, { ...CARD_SIZE, fonts: await loadFonts() });
        const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
        return new Uint8Array(png);
      }).then((image) => (image === undefined ? err("busy" as const) : ok(image))),
  };
}

const dataUri = (image: Uint8Array) => {
  const jpeg = image[0] === 0xff && image[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,${Buffer.from(image).toString("base64")}`;
};

/** Runs at most `concurrent` tasks; up to `queue` more wait; beyond that, undefined (busy). */
function createLimiter(concurrent: number, queue: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    if (active < concurrent) active++;
    else if (waiting.length >= queue) return undefined;
    // A finishing task hands its slot over directly, so newcomers cannot overtake.
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
}
