// Periodic jobs (spec 2a in/scheduler): the retention sweep every minute, housekeeping daily.
// Runs never overlap; results are logged only when something happened, failures by error
// class only (messages may contain data; spec 3.8).
import type { Logger } from "../logging.ts";

export interface Job {
  name: string;
  intervalMs: number;
  /** Returns counts such as { deletedPlans: 2 }. */
  run(): Promise<Record<string, number>>;
}

export interface Scheduler {
  /** Stops future runs and waits for running ones. */
  stop(): Promise<void>;
}

export async function startScheduler(
  jobs: readonly Job[],
  { logger, awaitFirstRun = true }: { logger: Logger; awaitFirstRun?: boolean },
): Promise<Scheduler> {
  const timers: ReturnType<typeof setInterval>[] = [];
  const running = new Map<string, Promise<void>>();

  const runOnce = (job: Job): Promise<void> => {
    const current = running.get(job.name);
    if (current !== undefined) return current; // previous run still going: skip this tick
    const run = (async () => {
      try {
        const counts = await job.run();
        if (Object.values(counts).some((count) => count > 0))
          logger.info("job_done", { job: job.name, ...counts });
      } catch (error) {
        logger.error("job_failed", {
          job: job.name,
          error: error instanceof Error ? error.name : "unknown",
        });
      } finally {
        running.delete(job.name);
      }
    })();
    running.set(job.name, run);
    return run;
  };

  const first = Promise.all(jobs.map(runOnce));
  if (awaitFirstRun) await first;
  for (const job of jobs) timers.push(setInterval(() => void runOnce(job), job.intervalMs));

  return {
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await Promise.all(running.values());
    },
  };
}
