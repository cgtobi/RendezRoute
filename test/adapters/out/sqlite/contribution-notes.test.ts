// Contribution Notes and reply mappings in SQLite (decisions D44, D45): one Note per contribution
// and recipient, found by contribution, recipient, plan, actor and note id; a reply Note kept only
// as a keyed hash with its own prefix; all of it gone with its contribution, response and plan.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createContributionNoteRepository } from "../../../../src/adapters/out/sqlite/contribution-notes.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createRecapRepository } from "../../../../src/adapters/out/sqlite/recap.ts";
import { createRemoteContributionRepository } from "../../../../src/adapters/out/sqlite/remote-contributions.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { ContributionNote } from "../../../../src/application/ports.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const hasher = createLookupHasher(randomBytes(32));
const notes = () => createContributionNoteRepository(database, hasher);
const mappings = () => createRemoteContributionRepository(database, hasher);

const actor = (name: string) => ({
  id: `https://social.example/users/${name}`,
  inbox: `https://social.example/users/${name}/inbox`,
  sharedInbox: undefined,
});

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({
    id: "host-device",
    tokenHash: "hash",
    now: fixtureNow,
  });
  for (const id of ["plan-0001", "plan-0002"]) {
    await createPlanRepository(database, cipher).create({
      plan: samplePlan({ id }),
      hostTokenHash: `host-hash-${id}`,
      creationNonce: `nonce-${id}`,
      hostDeviceId: "host-device",
    });
  }
  const responses = createResponseRepository(database, cipher, hasher);
  for (const [id, planId, name] of [
    ["r-1", "plan-0001", "ben"],
    ["r-2", "plan-0001", "cleo"],
    ["r-3", "plan-0002", "dora"],
  ] as const) {
    await responses.createRemote({
      response: {
        id,
        planId,
        kind: "joined",
        displayName: name,
        language: "en",
        previousKind: undefined,
        createdAt: fixtureNow,
        updatedAt: fixtureNow,
      },
      actor: actor(name),
      join: { id: `${actor(name).id}#join`, kind: "join" },
      manageTokenHash: `manage-${id}`,
    });
  }
  const recap = createRecapRepository(database, cipher);
  for (const [id, planId, responseId] of [
    ["c-1", "plan-0001", "r-1"],
    ["c-2", "plan-0001", undefined],
    ["c-3", "plan-0002", "r-3"],
  ] as const) {
    await recap.create({
      id,
      planId,
      responseId,
      body: `body ${id}`,
      linkUrl: undefined,
      hiddenByHost: false,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    });
  }
});
afterEach(async () => {
  await database.close();
});

const note = (
  noteId: string,
  contributionId: string,
  responseId: string,
  planId: string,
  overrides: Partial<Omit<ContributionNote, "sentAt">> = {},
) =>
  ({
    noteId,
    contributionId,
    responseId,
    planId,
    localActor: "instance",
    contentHash: `hash-${noteId}`,
    ...overrides,
  }) satisfies Omit<ContributionNote, "sentAt">;

describe("contribution notes", () => {
  it("are found by contribution and recipient, by note id, plan, recipient and actor", async () => {
    const repo = notes();
    await repo.create(note("n-1", "c-2", "r-1", "plan-0001"), fixtureNow);
    await repo.create(
      note("n-2", "c-2", "r-2", "plan-0001", { localActor: "poster-1" }),
      fixtureNow,
    );
    await repo.create(note("n-3", "c-1", "r-2", "plan-0001"), fixtureNow);
    await repo.create(note("n-4", "c-3", "r-3", "plan-0002"), fixtureNow);
    expect((await repo.find("c-2", "r-2"))?.noteId).toBe("n-2");
    expect(await repo.find("c-1", "r-1")).toBeUndefined();
    expect(await repo.findByNoteId("n-3")).toMatchObject({
      contributionId: "c-1",
      responseId: "r-2",
      planId: "plan-0001",
      localActor: "instance",
      contentHash: "hash-n-3",
      sentAt: fixtureNow,
    });
    expect(await repo.findByNoteId("missing")).toBeUndefined();
    expect((await repo.listByContribution("c-2")).map((n) => n.noteId).sort()).toEqual([
      "n-1",
      "n-2",
    ]);
    expect((await repo.listByRecipient("r-2")).map((n) => n.noteId).sort()).toEqual(["n-2", "n-3"]);
    expect((await repo.listByPlan("plan-0001")).map((n) => n.noteId).sort()).toEqual([
      "n-1",
      "n-2",
      "n-3",
    ]);
    expect((await repo.listByActor("poster-1")).map((n) => n.noteId)).toEqual(["n-2"]);
  });

  it("have one Note per contribution and recipient: a second attempt stores nothing", async () => {
    const repo = notes();
    expect(await repo.create(note("n-1", "c-2", "r-1", "plan-0001"), fixtureNow)).toBe(true);
    expect(await repo.create(note("n-9", "c-2", "r-1", "plan-0001"), fixtureNow)).toBe(false);
    expect(await repo.findByNoteId("n-9")).toBeUndefined();
    await expect(repo.create(note("n-1", "c-2", "r-2", "plan-0001"), fixtureNow)).rejects.toThrow(
      /UNIQUE/,
    );
  });

  it("store a new hash and sender on update, keeping the first-sent time, and delete one by one", async () => {
    const repo = notes();
    await repo.create(note("n-1", "c-2", "r-1", "plan-0001"), fixtureNow);
    const later = new Date(fixtureNow.getTime() + 60_000);
    await repo.update({ noteId: "n-1", localActor: "poster-9", contentHash: "new-hash" }, later);
    expect(await repo.findByNoteId("n-1")).toMatchObject({
      localActor: "poster-9",
      contentHash: "new-hash",
      sentAt: fixtureNow,
    });
    await repo.delete("n-1");
    expect(await repo.findByNoteId("n-1")).toBeUndefined();
  });

  it("go with the contribution, the recipient's response and the plan", async () => {
    const repo = notes();
    await repo.create(note("n-1", "c-2", "r-1", "plan-0001"), fixtureNow);
    await repo.create(note("n-2", "c-1", "r-2", "plan-0001"), fixtureNow);
    await repo.create(note("n-3", "c-3", "r-3", "plan-0002"), fixtureNow);
    await createRecapRepository(database, cipher).delete("c-2");
    expect(await repo.findByNoteId("n-1")).toBeUndefined();
    await createResponseRepository(database, cipher, hasher).delete("r-2");
    expect(await repo.findByNoteId("n-2")).toBeUndefined();
    await createPlanRepository(database, cipher).delete("plan-0002");
    expect(await repo.findByNoteId("n-3")).toBeUndefined();
    expect(database.sqlite.prepare("select count(*) from contribution_notes").pluck().get()).toBe(
      0,
    );
  });

  it("fingerprint with the key and their own prefix, not plainly", () => {
    const repo = notes();
    expect(repo.fingerprint("Anna|Great run")).toBe(
      hasher.hash("contribution-note:Anna|Great run"),
    );
    expect(repo.fingerprint("x")).not.toBe(hasher.hash("participant-note:x"));
    expect(repo.fingerprint("Anna|Great run")).not.toContain("Great run");
  });

  it("hold no contribution text, only identifiers and a hash", async () => {
    const repo = notes();
    await repo.create(
      note("n-1", "c-2", "r-1", "plan-0001", { contentHash: repo.fingerprint("Secret words") }),
      fixtureNow,
    );
    expect(
      JSON.stringify(database.sqlite.prepare("select * from contribution_notes").all()),
    ).not.toContain("Secret words");
  });
});

describe("remote contributions", () => {
  it("map a remote Note to its contribution, per author, by a keyed hash with its own prefix", async () => {
    const repo = mappings();
    const noteId = "https://social.example/users/ben/statuses/777";
    expect(
      await repo.create(
        { contributionId: "c-1", responseId: "r-1", planId: "plan-0001", remoteNoteId: noteId },
        fixtureNow,
      ),
    ).toBe(true);
    expect(await repo.findContribution("r-1", noteId)).toBe("c-1");
    expect(await repo.findContribution("r-2", noteId)).toBeUndefined();
    expect(await repo.findContribution("r-1", `${noteId}0`)).toBeUndefined();
    const stored = database.sqlite.prepare("select * from remote_contributions").all() as {
      remote_note_hmac: string;
    }[];
    expect(stored[0]?.remote_note_hmac).toBe(hasher.hash(`recap-remote-note:${noteId}`));
    expect(JSON.stringify(stored)).not.toContain("statuses/777");
    expect(stored[0]?.remote_note_hmac).not.toBe(hasher.hash(noteId));
  });

  it("store the same Note of an author once: a second attempt stores nothing", async () => {
    const repo = mappings();
    const input = {
      responseId: "r-1",
      planId: "plan-0001",
      remoteNoteId: "https://social.example/n/1",
    };
    expect(await repo.create({ ...input, contributionId: "c-1" }, fixtureNow)).toBe(true);
    expect(await repo.create({ ...input, contributionId: "c-2" }, fixtureNow)).toBe(false);
    expect(await repo.findContribution("r-1", input.remoteNoteId)).toBe("c-1");
  });

  it("go with the contribution", async () => {
    const repo = mappings();
    const remoteNoteId = "https://social.example/n/1";
    await repo.create(
      { contributionId: "c-1", responseId: "r-1", planId: "plan-0001", remoteNoteId },
      fixtureNow,
    );
    await createRecapRepository(database, cipher).delete("c-1");
    expect(await repo.findContribution("r-1", remoteNoteId)).toBeUndefined();
  });
});
