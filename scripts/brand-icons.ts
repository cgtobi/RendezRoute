// Rebuilds the logo and icon files (decision D28) from the Inkscape exports of the logo:
//
//   npm run icons -- <folder with the exports>
//
// Without a folder it rebuilds only the Home Assistant app's icon.png and logo.png (decision D57),
// which come from the committed public/brand/app-icon.svg, so they are reproducible from the
// repository alone.
//
// The folder holds RendezRoute_AppIcon.svg (the app icon) and RendezRoute_icon.svg (the pin, the
// mark wherever it stands alone in the app). Only the marks are taken, as drawn: the hidden traced
// photo, embedded pictures and editor data stay behind. The element ids and offsets
// below are those of the current exports; a new export with other ids fails with a message.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const PUBLIC = join(import.meta.dirname, "../public");
const HA_APP = join(import.meta.dirname, "../homeassistant/rendezroute");

const folder = process.argv[2];

/** The path data of the element with this id in RendezRoute_<name>.svg. */
function pathOf(name: string, id: string): string {
  const svg = readFileSync(join(folder ?? "", `RendezRoute_${name}.svg`), "utf8");
  const element = new RegExp(`<path[^>]*\\bid="${id}"[^>]*>`, "s").exec(svg)?.[0];
  const d = element === undefined ? undefined : /\sd="([^"]+)"/s.exec(element)?.[1];
  if (d === undefined) throw new Error(`RendezRoute_${name}.svg has no path with id "${id}"`);
  return d.replace(/\s+/g, " ").trim();
}

const num = (n: number) => Number(n.toFixed(6)).toString();
const translate = (x: number, y: number) => `translate(${num(x)} ${num(y)})`;

/** The app icon: the mark on a 130 × 130 square in the logo's gradient, top light, bottom dark. */
function appIcon(cornerRadius: number): string {
  const mark = pathOf("AppIcon", "rect4568-0-7-1");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 130">` +
    `<defs><linearGradient id="bg" x1="0" y1="131" x2="0" y2="-1" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#16335e"/><stop offset="1" stop-color="#3171b6"/>` +
    `</linearGradient></defs>` +
    `<rect width="130" height="130"${cornerRadius > 0 ? ` rx="${cornerRadius}"` : ""} fill="url(#bg)"/>` +
    // Moved by the square's corner in the export, so the square starts at 0 0.
    `<path fill="#fff" transform="${translate(-50.255558, -77.285973)}" d="${mark}"/></svg>\n`
  );
}

/** The pin: its size and its offset in the export. */
const PIN = { width: 64.482018, height: 98.849541, x: -97.486983, y: -219.02708 };
const pinPath = () =>
  `<path transform="${translate(PIN.x, PIN.y)}" d="${pathOf("icon", "rect4568-0-7-1-0")}"/>`;

/** The tab icon: the pin centred in a square; dark on light tabs, white on dark. */
function tabIcon(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(-(PIN.height - PIN.width) / 2)} 0 ${num(PIN.height)} ${num(PIN.height)}">` +
    `<style>path{fill:#16335e}@media (prefers-color-scheme:dark){path{fill:#fff}}</style>` +
    `${pinPath()}</svg>\n`
  );
}

/** The header mark: the pin, black, as a CSS mask that takes the text colour. */
function headerLogo(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(PIN.width)} ${num(PIN.height)}">` +
    `${pinPath()}</svg>\n`
  );
}

const png = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } })
    .render()
    .asPng();

if (folder !== undefined) {
  const files: [string, string | Buffer][] = [
    ["brand/app-icon.svg", appIcon(30)],
    ["brand/tab-icon.svg", tabIcon()],
    ["icons/logo.svg", headerLogo()],
    // iOS rounds the corners itself and shows transparent ones black: a full square.
    ["brand/apple-touch-icon.png", png(appIcon(0), 180)],
    // For browsers without SVG tab icons.
    ["brand/tab-icon-32.png", png(appIcon(30), 32)],
  ];
  for (const [file, content] of files) {
    writeFileSync(join(PUBLIC, file), content);
    process.stdout.write(`public/${file}\n`);
  }
}

// The Home Assistant app's store images, from the committed app icon: the icon square at 128 × 128,
// and the logo at 250 × 100 (the sizes of the developer docs): the icon and the name beside it.
// The wordmark is Inter (the font the app ships), set by Satori, and in the logo's mid blue, which
// reads on the light and the dark theme.
const iconSvg = readFileSync(join(PUBLIC, "brand/app-icon.svg"), "utf8");
const iconUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`;
const LOGO = { width: 250, height: 100, icon: 68 };

async function haLogo(): Promise<string> {
  const require = createRequire(import.meta.url);
  const font = (weight: 600 | 700) => ({
    name: "Inter",
    data: readFileSync(
      require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`),
    ),
    weight,
    style: "normal" as const,
  });
  return satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          alignItems: "center",
          // Centred, and no padding: Satori adds it to the width and the height (a 14px padding
          // once made the root 278 × 128 on the 250 × 100 canvas and clipped the wordmark).
          justifyContent: "center",
          width: LOGO.width,
          height: LOGO.height,
        },
        children: [
          {
            type: "img",
            props: { src: iconUri, width: LOGO.icon, height: LOGO.icon },
          },
          {
            type: "div",
            props: {
              style: { marginLeft: 8, fontSize: 22, fontWeight: 700, color: "#3171b6" },
              children: "RendezRoute",
            },
          },
        ],
      },
    },
    { width: LOGO.width, height: LOGO.height, fonts: [font(600), font(700)] },
  );
}

const haFiles: [string, Buffer][] = [
  ["icon.png", png(iconSvg, 128)],
  ["logo.png", png(await haLogo(), LOGO.width)],
];
for (const [file, content] of haFiles) {
  writeFileSync(join(HA_APP, file), content);
  process.stdout.write(`homeassistant/rendezroute/${file}\n`);
}
