// Startup key handling (spec 3.11): locate the key, check it against the fingerprint stored
// in the database, and derive what the rest of the app needs.
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChannelLinks, FieldCipher, LookupHasher } from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import { type Database, hasEncryptedData } from "../sqlite/database.ts";
import { readMeta, writeMeta } from "../sqlite/meta.ts";
import { createChannelLinks } from "./channel-links.ts";
import { createFieldCipher } from "./field-cipher.ts";
import { deriveKey, openKeyring, parseMountPoints, resolveKeyLocation } from "./keyring.ts";
import { createLookupHasher } from "./lookup-hasher.ts";

const MOUNTINFO = "/proc/self/mountinfo";

export interface InstanceKeys {
  cipher: FieldCipher;
  csrfKey: Buffer;
  /** The admin listener's own CSRF key (decision D55), so a public form's token is invalid there. */
  adminCsrfKey: Buffer;
  /** Finds accounts by a keyed hash of their encrypted subject (spec 4 identities). */
  identityLookup: LookupHasher;
  /** Signs the links in emails (decision D31). */
  channelLinks: ChannelLinks;
  /** Set when the key is stored inside DATA_DIR. */
  warning: string | undefined;
  /** Where the encryption key lives; other instance keys (VAPID) are kept next to it (spec 10). */
  directory: string;
}

/** Throws KeyError when the app must not start. */
export async function openInstanceKeys(
  config: Config,
  database: Database,
  { mountinfo = existsSync(MOUNTINFO) ? readFileSync(MOUNTINFO, "utf8") : "" } = {},
): Promise<InstanceKeys> {
  const location = resolveKeyLocation({
    encryptionKeyFile: config.encryptionKeyFile,
    dataDir: config.dataDir,
    mountPoints: parseMountPoints(mountinfo),
  });
  const storedFingerprint = await readMeta(database, "key_fingerprint");
  const opened = openKeyring(location.file, {
    storedFingerprint,
    hasEncryptedData: hasEncryptedData(database),
  });
  if (storedFingerprint !== opened.fingerprint)
    await writeMeta(database, "key_fingerprint", opened.fingerprint);

  return {
    cipher: createFieldCipher(opened.keyring),
    csrfKey: deriveKey(opened.keyring, "csrf"),
    adminCsrfKey: deriveKey(opened.keyring, "csrf-admin"),
    identityLookup: createLookupHasher(deriveKey(opened.keyring, "identity-lookup")),
    channelLinks: createChannelLinks(deriveKey(opened.keyring, "channel-links")),
    warning: location.warning,
    directory: dirname(location.file),
  };
}
