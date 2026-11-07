import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { startScheduler } from "../../../src/adapters/in/scheduler.ts";
import { createLogger } from "../../../src/adapters/logging.ts";

let lines: string[];
const logger = () => createLogger({ write: (line) => lines.push(line) });
const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(() => {
  lines = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("scheduler (spec 2a in/scheduler, 3.10)", () => {
  it("runs every job once at start, then at its interval", async () => {
    const runs: string[] = [];
    const scheduler = await startScheduler(
      [
        {
          name: "sweep",
          intervalMs: 60_000,
          run: async () => (runs.push("sweep"), { deletedPlans: 0 }),
        },
        {
          name: "daily",
          intervalMs: 86_400_000,
          run: async () => (runs.push("daily"), { deletedDevices: 0 }),
        },
      ],
      { logger: logger() },
    );
    expect(runs).toEqual(["sweep", "daily"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs.filter((r) => r === "sweep")).toHaveLength(3);
    expect(runs.filter((r) => r === "daily")).toHaveLength(1);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs.filter((r) => r === "sweep")).toHaveLength(3);
  });

  it("never overlaps runs of the same job", async () => {
    let running = 0;
    let maxRunning = 0;
    const scheduler = await startScheduler(
      [
        {
          name: "slow",
          intervalMs: 1_000,
          run: async () => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            await new Promise((resolve) => setTimeout(resolve, 3_500));
            running--;
            return {};
          },
        },
      ],
      { logger: logger(), awaitFirstRun: false },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxRunning).toBe(1);
    // stop() waits for the running job, whose timer only fires when fake time advances.
    const stopped = scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopped;
  });

  it("logs results only when something happened, and failures by error class only", async () => {
    let call = 0;
    const scheduler = await startScheduler(
      [
        {
          name: "sweep",
          intervalMs: 1_000,
          run: async () => {
            call++;
            if (call === 2) throw new Error("SENTINEL secret detail");
            return { deletedPlans: call === 3 ? 2 : 0 };
          },
        },
      ],
      { logger: logger() },
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.stop();
    expect(lines.join("\n")).not.toContain("SENTINEL");
    expect(
      events().map(({ event, job, error, deletedPlans }) => ({ event, job, error, deletedPlans })),
    ).toEqual([
      { event: "job_failed", job: "sweep", error: "Error", deletedPlans: undefined },
      { event: "job_done", job: "sweep", error: undefined, deletedPlans: 2 },
    ]);
  });
});
