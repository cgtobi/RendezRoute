// The Home Assistant app's store images (decision D57): the sizes of the developer docs, and the
// logo's drawing kept inside its canvas (a clipped wordmark once shipped). The PNGs are decoded
// here with node:zlib only (8-bit RGBA, not interlaced, which is what resvg writes).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";

const APP = join(import.meta.dirname, "../../homeassistant/rendezroute");

interface Image {
  width: number;
  height: number;
  /** RGBA, row by row. */
  pixels: Uint8Array;
}

function decode(file: string): Image {
  const png = readFileSync(join(APP, file));
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect([png[24], png[25], png[28]], `${file}: bit depth, colour type, interlace`).toEqual([
    8, 6, 0,
  ]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      chunks.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const byte = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return a <= b && a <= c ? left : b <= c ? up : upLeft;
      };
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth();
      pixels[y * stride + x] = (byte + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

/** The box around every pixel that is not (nearly) transparent. */
function opaqueBox(image: Image): { left: number; top: number; right: number; bottom: number } {
  let box = { left: image.width, top: image.height, right: -1, bottom: -1 };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((image.pixels[(y * image.width + x) * 4 + 3] ?? 0) <= 8) continue;
      box = {
        left: Math.min(box.left, x),
        top: Math.min(box.top, y),
        right: Math.max(box.right, x),
        bottom: Math.max(box.bottom, y),
      };
    }
  }
  return box;
}

describe("the Home Assistant store images", () => {
  it("are 128 x 128 (icon.png) and 250 x 100 (logo.png)", () => {
    const png = (file: string) => {
      const { width, height } = decode(file);
      return [width, height];
    };
    expect(png("icon.png")).toEqual([128, 128]);
    expect(png("logo.png")).toEqual([250, 100]);
  });

  it("keep the logo's drawing inside the canvas, centred, with a margin all round", () => {
    const logo = decode("logo.png");
    const box = opaqueBox(logo);
    const margins = {
      left: box.left,
      right: logo.width - 1 - box.right,
      top: box.top,
      bottom: logo.height - 1 - box.bottom,
    };
    for (const [side, margin] of Object.entries(margins)) {
      expect(margin, `${side} margin ${JSON.stringify(margins)}`).toBeGreaterThanOrEqual(6);
    }
    expect(Math.abs(margins.top - margins.bottom), "vertical centring").toBeLessThanOrEqual(2);
  });
});
