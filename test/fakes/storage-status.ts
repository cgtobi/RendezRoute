import type { StorageStatus } from "../../src/application/ports.ts";
import type { StorageSample } from "../../src/domain/instance-limits.ts";

/** A disk whose free space the test sets; `undefined` means the reading gave nothing. */
export class FakeStorageStatus implements StorageStatus {
  reads = 0;
  next: StorageSample | undefined | Error;

  constructor(next: StorageSample | undefined | Error) {
    this.next = next;
  }

  read(): Promise<StorageSample | undefined> {
    this.reads++;
    if (this.next instanceof Error) return Promise.reject(this.next);
    return Promise.resolve(this.next);
  }
}
