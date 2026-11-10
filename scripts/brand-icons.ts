// Rebuilds the logo and icon files (decision D28) from the Inkscape exports of the logo:
//
//   npm run icons -- <folder with the exports>
//
// The folder holds RendezRoute_AppIcon.svg (the app icon) and RendezRoute_icon.svg (the pin, the
// mark wherever it stands alone in the app). Only the marks are taken, as drawn: the hidden traced
// photo, embedded pictures and editor data stay behind. The element ids and offsets
// below are those of the current exports; a new export with other ids fails with a message.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const PUBLIC = join(import.meta.dirname, "../public");

const folder = process.argv[2];
if (folder === undefined) {
  process.stderr.write("Usage: npm run icons -- <folder with the RendezRoute_*.svg exports>\n");
  process.exit(1);
}

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
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

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
