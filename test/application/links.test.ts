// "Get a new link" and "Sign out all other devices" (spec 3.2, decision I44).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { deletePlan } from "../../src/application/host.ts";
import { runHousekeeping } from "../../src/application/maintenance.ts";
import { getNewLink, signOutOtherDevices } from "../../src/application/links.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond, viewMyResponse } from "../../src/application/responses.ts";
import {
  confirmHostLink,
  confirmManageLink,
  confirmTemplateLink,
  openHostLink,
  openManageLink,
} from "../../src/application/secret-links.ts";
import { listTemplates, viewTemplate } from "../../src/application/templates.ts";
import { viewHostPage } from "../../src/application/host.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let channels: FakeChannelRepository;
let planId: string;
let hostToken: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const subscription = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
});

beforeEach(async () => {
  channels = new FakeChannelRepository();
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    notify: { channels, jobs: new FakeJobQueue(), reminders: new FakeSentReminders() },
  };
  const created = await createPlan(deps, {
    input: { ...sampleInput, keepAsTemplate: "1" },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  ({ planId, hostToken } = created);
  host = created.newDeviceToken;
});

/** A second device that confirmed the host link. */
async function secondHost(token = hostToken) {
  const linked = await confirmHostLink(deps, { token, deviceToken: undefined });
  if (linked.kind !== "linked") throw new Error("not linked");
  return linked.newDeviceToken;
}

const isHost = async (device: string | undefined) =>
  (await viewHostPage(deps, { planId, deviceToken: device, units: "metric" })).kind === "found";

describe("Get a new link (spec 3.2)", () => {
  it("replaces the host link; linked devices keep access", async () => {
    const other = await secondHost();
    const issued = await getNewLink(deps, {
      kind: "host",
      id: planId,
      deviceToken: host,
      formNonce: nonce(),
    });
    if (issued.kind !== "issued") throw new Error("not issued");
    expect(await openHostLink(deps, { token: hostToken, deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
    expect(await openHostLink(deps, { token: issued.token, deviceToken: undefined })).toMatchObject(
      { kind: "confirm", id: planId },
    );
    expect(await isHost(host)).toBe(true);
    expect(await isHost(other)).toBe(true);
  });

  it("issues nothing when the form is sent again, so the link shown keeps working", async () => {
    const request = { kind: "host", id: planId, deviceToken: host, formNonce: nonce() } as const;
    const issued = await getNewLink(deps, request);
    if (issued.kind !== "issued") throw new Error("not issued");
    expect(await getNewLink(deps, request)).toEqual({ kind: "already_issued" });
    expect(await openHostLink(deps, { token: issued.token, deviceToken: undefined })).toMatchObject(
      { kind: "confirm" },
    );
    expect(await getNewLink(deps, { ...request, formNonce: "short" })).toEqual({
      kind: "bad_request",
    });
  });

  it("forgets used form values after a day", async () => {
    const request = { kind: "host", id: planId, deviceToken: host, formNonce: nonce() } as const;
    await getNewLink(deps, request);
    const backups = { deleteOlderThan: async () => 0 };
    const { pendingLogins, identities } = createFakeRepositories();
    (deps.clock as FakeClock).set("2026-06-02T07:59:00Z");
    expect(await runHousekeeping({ ...deps, backups, pendingLogins, identities })).toMatchObject({
      deletedFormNonces: 0,
    });
    (deps.clock as FakeClock).set("2026-06-02T08:01:00Z");
    expect(await runHousekeeping({ ...deps, backups, pendingLogins, identities })).toMatchObject({
      deletedFormNonces: 1,
    });
  });

  it("replaces a manage link", async () => {
    const responded = await respond(deps, {
      planId,
      choice: "interested",
      displayName: "Ida",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (responded.kind !== "created") throw new Error("not responded");
    const ida = responded.newDeviceToken;
    const issued = await getNewLink(deps, {
      kind: "manage",
      id: planId,
      deviceToken: ida,
      formNonce: nonce(),
    });
    if (issued.kind !== "issued") throw new Error("not issued");
    expect(
      await openManageLink(deps, { token: responded.manageToken, deviceToken: undefined }),
    ).toEqual({ kind: "not_found" });
    const linked = await confirmManageLink(deps, { token: issued.token, deviceToken: undefined });
    if (linked.kind !== "linked") throw new Error("not linked");
    expect(
      await viewMyResponse(deps, { planId, deviceToken: linked.newDeviceToken }),
    ).toMatchObject({ kind: "found" });
  });

  it("gives a template kept at deletion its first link (decision I36)", async () => {
    await deletePlan(deps, { planId, deviceToken: host });
    const [template] = await listTemplates(deps, { deviceToken: host });
    if (template === undefined) throw new Error("no template");
    const issued = await getNewLink(deps, {
      kind: "template",
      id: template.id,
      deviceToken: host,
      formNonce: nonce(),
    });
    if (issued.kind !== "issued") throw new Error("not issued");
    const linked = await confirmTemplateLink(deps, { token: issued.token, deviceToken: undefined });
    if (linked.kind !== "linked") throw new Error("not linked");
    expect(
      await viewTemplate(deps, { templateId: template.id, deviceToken: linked.newDeviceToken }),
    ).toMatchObject({ kind: "found" });
  });

  it("is refused to devices without a link, and for unknown items", async () => {
    expect(
      await getNewLink(deps, {
        kind: "host",
        id: planId,
        deviceToken: undefined,
        formNonce: nonce(),
      }),
    ).toEqual({
      kind: "forbidden",
    });
    expect(
      await getNewLink(deps, { kind: "manage", id: planId, deviceToken: host, formNonce: nonce() }),
    ).toEqual({
      kind: "forbidden",
    });
    expect(
      await getNewLink(deps, {
        kind: "template",
        id: "nope",
        deviceToken: host,
        formNonce: nonce(),
      }),
    ).toEqual({
      kind: "not_found",
    });
  });
});

describe("Sign out all other devices (spec 3.2)", () => {
  it("leaves only the current device linked and turns notifications off (user decision 2026-11-09)", async () => {
    const other = await secondHost();
    const third = await secondHost();
    await channels.add({ planId }, subscription("leaked"));
    expect(
      await signOutOtherDevices(deps, { kind: "host", id: planId, deviceToken: other }),
    ).toEqual({ kind: "signed_out", devices: 2 });
    expect(await isHost(other)).toBe(true);
    expect(await isHost(host)).toBe(false);
    expect(await isHost(third)).toBe(false);
    expect(await channels.listFor({ planId })).toEqual([]);
    // The old link still links devices until a new one is issued.
    expect(await isHost(await secondHost())).toBe(true);
  });

  it("never leaves nobody linked when two devices sign each other out", async () => {
    const other = await secondHost();
    const both = await Promise.all([
      signOutOtherDevices(deps, { kind: "host", id: planId, deviceToken: host }),
      signOutOtherDevices(deps, { kind: "host", id: planId, deviceToken: other }),
    ]);
    expect(
      both.map((r) => (r.kind === "signed_out" ? r.devices : -1)).sort((a, b) => a - b),
    ).toEqual([0, 1]);
    expect((await isHost(host)) || (await isHost(other))).toBe(true);
  });

  it("works for templates, which have no notifications", async () => {
    const other = await secondHost();
    await deletePlan(deps, { planId, deviceToken: host });
    const [template] = await listTemplates(deps, { deviceToken: other });
    if (template === undefined) throw new Error("no template");
    expect(
      await signOutOtherDevices(deps, { kind: "template", id: template.id, deviceToken: other }),
    ).toEqual({ kind: "signed_out", devices: 1 });
    expect(await listTemplates(deps, { deviceToken: host })).toEqual([]);
    expect(await listTemplates(deps, { deviceToken: other })).toHaveLength(1);
  });
});
