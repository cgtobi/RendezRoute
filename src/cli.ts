#!/usr/bin/env node
import { parseCommand } from "./adapters/in/cli/parse.ts";
import { startServer } from "./main.ts";

const command = parseCommand(process.argv.slice(2));

switch (command.kind) {
  case "help":
    console.log(command.usage);
    break;
  case "error":
    console.error(command.message);
    process.exitCode = 2;
    break;
  case "serve": {
    const result = await startServer(process.env);
    if (!result.ok) {
      console.error(
        `RendezRoute cannot start: invalid configuration\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(`RendezRoute listening on port ${result.server.url.port}`);

    const shutdown = () => {
      result.server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    break;
  }
}
