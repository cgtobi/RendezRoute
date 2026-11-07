// Structured JSON-line logging. Callers pass fixed event names and non-personal fields only:
// never tokens, names, emails, exact coordinates or URLs containing tokens (spec 3.8).
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger({
  write = (line: string) => process.stdout.write(`${line}\n`),
}: { write?: (line: string) => void } = {}): Logger {
  const log =
    (level: "info" | "warn" | "error") =>
    (event: string, fields: LogFields = {}) =>
      write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  return { info: log("info"), warn: log("warn"), error: log("error") };
}
