import type { RouteParseError, RouteParser } from "../../src/application/ports.ts";
import type { Route } from "../../src/domain/route.ts";

/** Parses "route:<json>" files to that route and "error:<code>" files to that error. */
export class FakeRouteParser implements RouteParser {
  parse(file: Uint8Array) {
    const text = new TextDecoder().decode(file);
    if (text.startsWith("error:"))
      return { ok: false as const, error: text.slice(6) as RouteParseError };
    return { ok: true as const, value: JSON.parse(text.slice(6)) as Route };
  }
}

export const fakeGpx = (route: Route) => new TextEncoder().encode(`route:${JSON.stringify(route)}`);
export const brokenGpx = (code: RouteParseError) => new TextEncoder().encode(`error:${code}`);
