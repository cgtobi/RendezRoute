// The disk guard (0.19.0 commit A): the free space of the data directory is sampled once a
// minute by the scheduler and cached, so no request reads the disk.
import { type StorageLevel, storageLevel } from "../domain/instance-limits.ts";
import type { StorageStatus } from "./ports.ts";

export interface StorageGuard {
  /** The cached level; "ok" until the first sample and whenever the disk could not be read. */
  level(): StorageLevel;
  /** Reads the disk and updates the cached level; reports a change of level and a failed read. */
  sample(): Promise<void>;
}

export function createStorageGuard({
  status,
  onChange,
  onUnavailable,
}: {
  status: StorageStatus;
  /** Called once when the level changes. */
  onChange: (level: StorageLevel, previous: StorageLevel) => void;
  /** Called once per run of failed reads, not at every sample. */
  onUnavailable: () => void;
}): StorageGuard {
  let current: StorageLevel = "ok";
  let unavailable = false;
  const set = (level: StorageLevel) => {
    if (level !== current) {
      const previous = current;
      current = level;
      onChange(level, previous);
    }
  };
  return {
    level: () => current,
    sample: async () => {
      const sample = await status.read().catch(() => undefined);
      if (sample === undefined) {
        if (!unavailable) onUnavailable();
        unavailable = true;
        // Nothing known: nothing is refused, but a warning that was raised ends quietly.
        current = "ok";
        return;
      }
      unavailable = false;
      set(storageLevel(sample));
    },
  };
}
