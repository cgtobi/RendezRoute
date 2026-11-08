// The job runner (spec 6 feature 12): runs due jobs, retries failures with backoff and gives
// up after five retries (decision I36). Only error classes are recorded, never messages.
import { nextRetryAt } from "../domain/jobs.ts";
import type { Clock, JobQueue } from "./ports.ts";

/** "drop": the job can never succeed (malformed, or its target is gone). */
export type JobOutcome = "done" | "retry" | "drop";
export type JobHandlers = Readonly<Record<string, (payload: unknown) => Promise<JobOutcome>>>;

export interface JobRunCounts {
  done: number;
  retried: number;
  dropped: number;
  expired: number;
}

export async function runDueJobs(
  deps: { jobs: JobQueue; clock: Clock },
  handlers: JobHandlers,
  { limit = 50 }: { limit?: number } = {},
): Promise<JobRunCounts> {
  const now = deps.clock.now();
  const counts: JobRunCounts = { done: 0, retried: 0, dropped: 0, expired: 0 };
  counts.expired = await deps.jobs.deleteExpired(now);

  for (const job of await deps.jobs.due(now, limit)) {
    const handler = handlers[job.type];
    let outcome: JobOutcome;
    let error = "retry_requested";
    if (handler === undefined) {
      outcome = "drop";
    } else {
      try {
        outcome = await handler(job.payload);
      } catch (thrown) {
        outcome = "retry";
        error = thrown instanceof Error ? thrown.name : "unknown";
      }
    }

    const retryAt = outcome === "retry" ? nextRetryAt(job.attempts + 1, now) : undefined;
    if (retryAt !== undefined) {
      await deps.jobs.retry(job.id, retryAt, error);
      counts.retried++;
    } else {
      await deps.jobs.complete(job.id);
      if (outcome === "done") counts.done++;
      else counts.dropped++;
    }
  }
  return counts;
}
