import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Logger } from "../../logging.ts";

/**
 * Logs method, route pattern (e.g. `/a/:token`), status and duration. Never the raw
 * path or query, client IP or user agent, so tokens and personal data stay out of logs.
 */
export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    logger.info("request", {
      method: c.req.method,
      route: routePath(c, -1),
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    });
  };
}
