// Free disk space of the data directory (0.19.0 disk guard), read with statfs.
import { statfs } from "node:fs/promises";
import type { StorageStatus } from "../../application/ports.ts";

export function createStorageStatus(directory: string): StorageStatus {
  return {
    read: async () => {
      const stats = await statfs(directory);
      // bavail is what an unprivileged process may still use; bfree includes root's reserve.
      const free = Number(stats.bavail) * Number(stats.bsize);
      const total = Number(stats.blocks) * Number(stats.bsize);
      return Number.isFinite(free) && Number.isFinite(total) && total > 0
        ? { freeBytes: free, totalBytes: total }
        : undefined;
    },
  };
}
