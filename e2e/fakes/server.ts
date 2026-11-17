// Fake external services for end-to-end tests (spec 2b): map tiles, a Nominatim-style place
// search and reverse lookup, an Open-Meteo-style forecast, an OIDC provider and a Mastodon-API server (identity.ts),
// a mail server (smtp.ts), an ntfy server (ntfy.ts), a Telegram Bot API (telegram.ts) and remote
// fediverse people (fediverse.ts) and a Home Assistant Supervisor with its Ingress proxy
// (supervisor.ts), so E2E runs never touch real providers.
// Runs with Node's type stripping.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";
import { handleFediverse } from "./fediverse.ts";
import { handleIdentity } from "./identity.ts";
import { handleNtfy } from "./ntfy.ts";
import { handleSupervisor } from "./supervisor.ts";
import { handleTelegram } from "./telegram.ts";
import { handleMail, startSmtp } from "./smtp.ts";

const PORT = Number(process.env.PORT ?? 8080);
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2525);

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

/** Every `lat,lon` the reverse route got, for tests that check what reaches the geocoder. */
const REVERSE_REQUESTS: string[] = [];

/**
 * Every `lat,lon` the street-level (zoom 18) reverse route got: the description of the exact
 * point (decision D77), which is sent unrounded, so it is kept apart from the grid-cell lookups.
 */
const DESCRIBE_REQUESTS: string[] = [];

/** The street-level answer (decision D77): a named place and its road, plus a house number. */
function describeAnswer(lat: number, lon: number): unknown {
  const inMunich = lat >= 48 && lat <= 48.2 && lon >= 11.4 && lon <= 11.7;
  if (!inMunich) return { error: "Unable to geocode" };
  return {
    place_id: 2,
    display_name: "Flaucher car park, 12, Isarauen, Sendling, München, Bayern, Deutschland",
    name: "Flaucher car park",
    address: {
      road: "Isarauen",
      house_number: "12",
      suburb: "Sendling",
      city: "München",
      state: "Bayern",
      country: "Deutschland",
    },
  };
}

/**
 * A Nominatim-style jsonv2 reverse answer (decision D70): a full street address inside the
 * Munich box, so tests prove only the district and city are used; "nothing found" elsewhere.
 */
function reverseAnswer(lat: number, lon: number): unknown {
  const inMunich = lat >= 48 && lat <= 48.2 && lon >= 11.4 && lon <= 11.7;
  if (!inMunich) return { error: "Unable to geocode" };
  const sendling = Math.round(lat * 100) === 4811 && Math.round(lon * 100) === 1156;
  return {
    place_id: 1,
    display_name: `12, Some Road, ${sendling ? "Sendling" : "Giesing"}, München, Bayern, Deutschland`,
    address: {
      road: "Some Road",
      house_number: "12",
      suburb: sendling ? "Sendling" : "Giesing",
      city: "München",
      state: "Bayern",
      country: "Deutschland",
    },
  };
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://fakes");
  if (await handleIdentity(request, response, url)) return;
  if (handleMail(request, response, url)) return;
  if (handleSupervisor(request, response, url)) return;
  if (await handleNtfy(request, response, url)) return;
  if (await handleTelegram(request, response, url)) return;
  if (await handleFediverse(request, response, url)) return;
  if (/^\/tiles\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) {
    response.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    response.end(TILE);
  } else if (url.pathname === "/search") {
    const query = url.searchParams.get("q") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(query.toLowerCase().includes("flaucher") ? PLACES : []));
  } else if (url.pathname === "/reverse") {
    const lat = url.searchParams.get("lat") ?? "";
    const lon = url.searchParams.get("lon") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    if (url.searchParams.get("zoom") === "18") {
      DESCRIBE_REQUESTS.push(`${lat},${lon}`);
      response.end(JSON.stringify(describeAnswer(Number(lat), Number(lon))));
    } else {
      REVERSE_REQUESTS.push(`${lat},${lon}`);
      response.end(JSON.stringify(reverseAnswer(Number(lat), Number(lon))));
    }
  } else if (url.pathname === "/describe-requests") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(DESCRIBE_REQUESTS));
  } else if (url.pathname === "/reverse-requests") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(REVERSE_REQUESTS));
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
}

createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
}).listen(PORT);
startSmtp(SMTP_PORT);
