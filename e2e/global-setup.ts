// Starts the E2E environment from the current source and removes it, volumes included, afterwards.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const COMPOSE = ["compose", "-f", join(import.meta.dirname, "compose.yaml")];

export default function globalSetup(): () => void {
  execFileSync("docker", [...COMPOSE, "up", "--detach", "--build", "--wait"], { stdio: "inherit" });
  return () => {
    if (process.env.E2E_KEEP !== "true") {
      execFileSync("docker", [...COMPOSE, "down", "--volumes"], { stdio: "inherit" });
    }
  };
}
