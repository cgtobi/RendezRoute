// ntfy (decision D33): posting to the instance's server, and what the messages say.
import { describe, expect, it } from "vite-plus/test";
import { createChannelNotifier } from "../../../../src/adapters/out/channel-notifier.ts";
import { createNtfyClient } from "../../../../src/adapters/out/ntfy/client.ts";
import { createNtfy } from "../../../../src/adapters/out/ntfy/notifier.ts";
import type { TrustedFetch } from "../../../../src/adapters/out/http/trusted-fetch.ts";
import type { Notification } from "../../../../src/domain/notification.ts";
import { topicUrl } from "../../../../src/domain/ntfy.ts";
import { FakeChannelLinks } from "../../../fakes/channel-links.ts";
import { FakeChannelRepository } from "../../../fakes/channels.ts";
import { FakeNotifier } from "../../../fakes/notifier.ts";
import { FakeNtfyClient } from "../../../fakes/ntfy.ts";

const SERVER = new URL("https://ntfy.example.org/");
const instance = { baseUrl: new URL("https://runs.example.org"), instanceName: "Isar Runs" };

describe("topic addresses", () => {
  it("sit under the server, also behind a path", () => {
    expect(topicUrl(SERVER, "abc_DEF-123")).toBe("https://ntfy.example.org/abc_DEF-123");
    expect(topicUrl(new URL("https://example.org/ntfy"), "abc")).toBe(
      "https://example.org/ntfy/abc",
    );
  });
});

describe("ntfy client", () => {
  function recording(status: number | Error) {
    const calls: { url: string; headers: Headers; body: unknown }[] = [];
    const fetch: TrustedFetch = (url, init) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return status instanceof Error
        ? Promise.reject(status)
        : Promise.resolve(new Response(null, { status }));
    };
    return { calls, fetch };
  }

  it("posts the message as JSON to the server, with the token when there is one", async () => {
    const { calls, fetch } = recording(200);
    const client = createNtfyClient({ server: SERVER, token: "tk_secret", fetch });
    const message = { topic: "abc", title: "Hill repeats", message: "Changed." };
    expect(await client.publish(message)).toBe("sent");
    expect(calls[0]?.url).toBe("https://ntfy.example.org/");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer tk_secret");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.body).toEqual(message);
    const without = recording(200);
    await createNtfyClient({ server: SERVER, token: undefined, fetch: without.fetch }).publish(
      message,
    );
    expect(without.calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("retries when the server is busy, down or unreachable, and gives up on other refusals", async () => {
    const result = (status: number | Error) =>
      createNtfyClient({
        server: SERVER,
        token: undefined,
        fetch: recording(status).fetch,
      }).publish({
        topic: "abc",
        title: "t",
        message: "m",
      });
    expect(await result(429)).toBe("retry");
    expect(await result(503)).toBe("retry");
    expect(await result(new Error("offline"))).toBe("retry");
    expect(await result(403)).toBe("failed");
  });
});

describe("ntfy messages", () => {
  const client = new FakeNtfyClient();
  const ntfy = createNtfy({
    client,
    server: SERVER,
    links: new FakeChannelLinks(),
    timeZone: "Europe/Berlin",
    ...instance,
  });
  const notification: Notification = {
    kind: "dayBefore",
    planTitle: "Hill repeats",
    facts: { startsAt: "2026-06-07T06:30:00.000Z", timeZone: "Europe/Berlin", area: "Flaucher" },
    planPath: "/p/abc",
    language: "en",
  };

  it("carry the sentence, time and place, open the plan, and can turn ntfy off", async () => {
    await ntfy.delivery.send({ topic: "abc", server: SERVER.href, channelId: "c1" }, notification);
    expect(client.published.at(-1)).toEqual({
      topic: "abc",
      title: "Hill repeats",
      message:
        "Reminder: the plan is tomorrow.\nSunday, 7 June 2026, 08:30 (Europe/Berlin time)\nFlaucher",
      click: "https://runs.example.org/p/abc",
      actions: [
        {
          action: "view",
          label: "Turn off ntfy",
          url: "https://runs.example.org/e/link-c1",
          clear: true,
        },
      ],
    });
  });

  it("have nothing to turn off once the channel is gone with its plan", async () => {
    await ntfy.delivery.send(
      { topic: "abc", server: SERVER.href, channelId: undefined },
      { ...notification, kind: "deleted", planPath: undefined },
    );
    expect(client.published.at(-1)?.actions).toBeUndefined();
    expect(client.published.at(-1)?.click).toBeUndefined();
  });

  it("go nowhere for a topic made on another server: people subscribed there", async () => {
    const before = client.published.length;
    expect(
      await ntfy.delivery.send(
        { topic: "abc", server: "https://old.example.org/", channelId: "c1" },
        notification,
      ),
    ).toBe("failed");
    expect(client.published).toHaveLength(before);
  });

  it("ask to confirm, about a plan or the account, by tapping the link", async () => {
    const to = { kind: "ntfy" as const, channelId: "c2", topic: "abc", language: "de" };
    await ntfy.outbox.confirmation(to, { kind: "plan", planTitle: "Hill repeats" });
    expect(client.published.at(-1)).toMatchObject({
      topic: "abc",
      title: "ntfy-Benachrichtigungen von Isar Runs bestätigen",
      click: "https://runs.example.org/e/link-c2",
    });
    expect(client.published.at(-1)?.message).toContain("„Hill repeats“");
    await ntfy.outbox.confirmation(to, { kind: "account" });
    expect(client.published.at(-1)?.message).toContain("deinem Konto auf Isar Runs");
  });

  it("warn before an unused account is deleted", async () => {
    const to = { kind: "ntfy" as const, channelId: "c3", topic: "abc", language: "en" };
    await ntfy.outbox.accountExpiry(to, new Date("2027-06-07T08:00:00Z"));
    expect(client.published.at(-1)).toMatchObject({
      title: "Your account on Isar Runs will be deleted on 7 June 2027",
      click: "https://runs.example.org/account",
      actions: [{ url: "https://runs.example.org/e/link-c3" }],
    });
  });
});

describe("channel notifier with ntfy", () => {
  it("hands confirmed ntfy channels and carried topics to ntfy, nothing without NTFY_URL", async () => {
    const channels = new FakeChannelRepository();
    const sent: { topic: string; server: string; channelId: string | undefined }[] = [];
    const ntfy = {
      send: (to: (typeof sent)[number]) => (sent.push(to), Promise.resolve("sent" as const)),
    };
    const notifier = createChannelNotifier({
      channels,
      push: new FakeNotifier(),
      email: undefined,
      ntfy,
      telegram: undefined,
    });
    const id = await channels.setNtfy(
      { responseId: "r1" },
      { topic: "topic-1", server: SERVER.href },
    );
    const notification: Notification = { kind: "changed", planTitle: "t", language: "en" };
    expect(await notifier.send({ channelId: id }, notification)).toBe("failed");
    await channels.confirm(id);
    await notifier.send({ channelId: id }, notification);
    await notifier.send({ ntfy: { topic: "topic-2", server: SERVER.href } }, notification);
    expect(sent).toEqual([
      { topic: "topic-1", server: SERVER.href, channelId: id },
      { topic: "topic-2", server: SERVER.href, channelId: undefined },
    ]);
    const without = createChannelNotifier({
      channels,
      push: new FakeNotifier(),
      email: undefined,
      ntfy: undefined,
      telegram: undefined,
    });
    expect(await without.send({ channelId: id }, notification)).toBe("failed");
  });
});
