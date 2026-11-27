// Command-line parsing for the `rendezroute` binary (decision I5).
export type Command =
  | { kind: "serve" }
  | { kind: "apply-retention-max" }
  | { kind: "backup"; directory: string }
  | { kind: "recent-plans" }
  | { kind: "delete-plan"; planId: string }
  | { kind: "help"; usage: string }
  | { kind: "error"; message: string };

/** A plan id as the addresses carry it: 22 URL-safe characters. */
const PLAN_ID = /^[A-Za-z0-9_-]{22}$/;

export const USAGE = `Usage:
  rendezroute serve                Start the web server (default)
  rendezroute apply-retention-max  Apply a lowered MAX_RETENTION_DAYS to existing plans
  rendezroute backup <directory>   Copy the live database into <directory> (absolute path)
  rendezroute recent-plans         List the newest plans: id, created, title, responses
  rendezroute delete-plan <id>     Delete a plan for everyone (notices are sent by the running server)
  rendezroute help                 Show this help`;

export function parseCommand(argv: readonly string[]): Command {
  const [name = "serve", ...rest] = argv;

  if (name === "help" || name === "--help" || name === "-h") return { kind: "help", usage: USAGE };

  if (name === "apply-retention-max") {
    if (rest.length > 0)
      return { kind: "error", message: `"apply-retention-max" takes no arguments.\n\n${USAGE}` };
    return { kind: "apply-retention-max" };
  }

  if (name === "backup") {
    const [directory, ...extra] = rest;
    if (directory === undefined || extra.length > 0)
      return { kind: "error", message: `"backup" takes one directory.\n\n${USAGE}` };
    return { kind: "backup", directory };
  }

  if (name === "recent-plans") {
    if (rest.length > 0)
      return { kind: "error", message: `"recent-plans" takes no arguments.\n\n${USAGE}` };
    return { kind: "recent-plans" };
  }

  if (name === "delete-plan") {
    const [planId, ...extra] = rest;
    if (planId === undefined || extra.length > 0)
      return { kind: "error", message: `"delete-plan" takes one plan id.\n\n${USAGE}` };
    if (!PLAN_ID.test(planId))
      return { kind: "error", message: `"${planId}" is not a plan id.\n\n${USAGE}` };
    return { kind: "delete-plan", planId };
  }

  if (name === "serve") {
    if (rest.length > 0)
      return { kind: "error", message: `"serve" takes no arguments.\n\n${USAGE}` };
    return { kind: "serve" };
  }

  return { kind: "error", message: `Unknown command "${name}".\n\n${USAGE}` };
}
