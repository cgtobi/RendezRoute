// Command-line parsing for the `rendezroute` binary (decision I5).
export type Command =
  | { kind: "serve" }
  | { kind: "apply-retention-max" }
  | { kind: "help"; usage: string }
  | { kind: "error"; message: string };

export const USAGE = `Usage:
  rendezroute serve                Start the web server (default)
  rendezroute apply-retention-max  Apply a lowered MAX_RETENTION_DAYS to existing plans
  rendezroute help                 Show this help`;

export function parseCommand(argv: readonly string[]): Command {
  const [name = "serve", ...rest] = argv;

  if (name === "help" || name === "--help" || name === "-h") return { kind: "help", usage: USAGE };

  if (name === "apply-retention-max") {
    if (rest.length > 0)
      return { kind: "error", message: `"apply-retention-max" takes no arguments.\n\n${USAGE}` };
    return { kind: "apply-retention-max" };
  }

  if (name === "serve") {
    if (rest.length > 0)
      return { kind: "error", message: `"serve" takes no arguments.\n\n${USAGE}` };
    return { kind: "serve" };
  }

  return { kind: "error", message: `Unknown command "${name}".\n\n${USAGE}` };
}
