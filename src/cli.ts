#!/usr/bin/env node
import { parseCommand } from "./adapters/in/cli/parse.ts";
import { stripBidiControls } from "./domain/text.ts";
import {
  runApplyRetentionMax,
  runBackup,
  runDeletePlan,
  runRecentPlans,
  runServe,
} from "./main.ts";

const command = parseCommand(process.argv.slice(2));

switch (command.kind) {
  case "help":
    console.log(command.usage);
    break;
  case "error":
    console.error(command.message);
    process.exitCode = 2;
    break;
  case "apply-retention-max": {
    const result = await runApplyRetentionMax(process.env);
    if (!result.ok) {
      console.error(
        `RendezRoute cannot run: invalid configuration\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(
      `Applied MAX_RETENTION_DAYS: shortened ${result.shortened} plan(s), deleted ${result.deleted} plan(s) whose new deletion date had passed.`,
    );
    break;
  }
  case "recent-plans": {
    const result = await runRecentPlans(process.env);
    if (!result.ok) {
      console.error(
        `RendezRoute cannot run: invalid configuration\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (result.plans.length === 0) console.log("No plans.");
    for (const plan of result.plans) {
      console.log(
        [
          plan.id,
          plan.createdAt.toISOString(),
          `${plan.responseCount} response(s)`,
          stripBidiControls(plan.title),
        ].join("\t"),
      );
    }
    break;
  }
  case "delete-plan": {
    const result = await runDeletePlan(process.env, command.planId);
    if (!result.ok) {
      console.error(
        `RendezRoute cannot run: invalid configuration\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
      process.exit(1);
    }
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (!result.deleted) {
      console.error(`No plan with the id ${command.planId}.`);
      process.exitCode = 1;
      break;
    }
    console.log(
      `Deleted the plan "${stripBidiControls(result.title ?? "")}". Notices to participants are sent by the running server.`,
    );
    break;
  }
  case "backup": {
    const result = await runBackup(process.env, command.directory);
    if (!result.ok) {
      console.error(`Backup failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`Database backed up to ${result.path}`);
    console.log(
      "Back up the encryption key separately; without it, encrypted data cannot be read.",
    );
    break;
  }
  case "serve":
    await runServe(process.env);
    break;
}
