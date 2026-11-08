// Fake external services for end-to-end tests (spec 2b): map tiles, a Nominatim-style place
// search and an Open-Meteo-style forecast, so E2E runs never touch real providers. Runs with Node's type stripping.
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const PORT = Number(process.env.PORT ?? 8080);

/** A plain 256 × 256 PNG tile in a light green, built without dependencies. */
function tile(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(256 * 3, Buffer.from([0xdc, 0xed, 0xc8])),
  ]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: 256 }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TILE = tile();
const PLACES = [{ display_name: "Flaucher, Isar, Munich", lat: "48.1107", lon: "11.5582" }];

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fakes");
  if (/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) {
    response.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    response.end(TILE);
  } else if (url.pathname === "/search") {
    const query = url.searchParams.get("q") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(query.toLowerCase().includes("flaucher") ? PLACES : []));
  } else if (url.pathname === "/v1/forecast") {
    // Partly cloudy, 14 °C, for whichever hour is asked.
    const hour = url.searchParams.get("start_hour") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        hourly: {
          time: [hour],
          temperature_2m: [14],
          precipitation_probability: [20],
          weather_code: [2],
          wind_speed_10m: [10],
        },
      }),
    );
  } else if (url.pathname === "/healthz") {
    response.end("ok");
  } else {
    response.writeHead(404).end();
  }
}).listen(PORT);
