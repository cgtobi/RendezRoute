import type { JobQueue, NewJob, QueuedJob } from "../../src/application/ports.ts";

interface Stored extends QueuedJob {
  runAt: Date;
  planId: string | undefined;
  responseId: string | undefined;
  lastError: string | undefined;
}

/** In-memory job queue with the same ordering as the SQLite adapter. */
export class FakeJobQueue implements JobQueue {
  readonly jobs = new Map<string, Stored>();
  #next = 0;

  enqueue(job: NewJob) {
    const id = `job-${String(++this.#next).padStart(4, "0")}`;
    this.jobs.set(id, {
      id,
      type: job.type,
      payload: structuredClone(job.payload),
      attempts: 0,
      expiresAt: job.expiresAt,
      runAt: job.runAt,
      planId: job.planId,
      responseId: job.responseId,
      lastError: undefined,
    });
    return Promise.resolve(id);
  }

  due(now: Date, limit: number) {
    const due = [...this.jobs.values()]
      .filter((job) => job.runAt <= now)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
      .slice(0, limit)
      .map(({ id, type, payload, attempts, expiresAt }) => ({
        id,
        type,
        payload: structuredClone(payload),
        attempts,
        expiresAt,
      }));
    return Promise.resolve(due);
  }

  complete(id: string) {
    this.jobs.delete(id);
    return Promise.resolve();
  }

  retry(id: string, runAt: Date, error: string) {
    const job = this.jobs.get(id);
    if (job !== undefined)
      Object.assign(job, { runAt, attempts: job.attempts + 1, lastError: error });
    return Promise.resolve();
  }

  deleteExpired(now: Date) {
    let deleted = 0;
    for (const [id, job] of this.jobs) {
      if (job.expiresAt !== undefined && job.expiresAt <= now) {
        this.jobs.delete(id);
        deleted++;
      }
    }
    return Promise.resolve(deleted);
  }
}
