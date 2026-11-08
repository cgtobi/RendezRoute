import type { BackupStore } from "../../src/application/ports.ts";

/** Records the cutoffs it is asked about and reports a fixed number of deleted backups. */
export class FakeBackupStore implements BackupStore {
  readonly cutoffs: Date[] = [];

  constructor(private readonly deleted = 0) {}

  deleteOlderThan(cutoff: Date) {
    this.cutoffs.push(cutoff);
    return Promise.resolve(this.deleted);
  }
}
