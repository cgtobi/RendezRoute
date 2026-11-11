import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSmtpMailer } from "../../../../src/adapters/out/email/smtp-mailer.ts";
import { FakeSmtpServer } from "../../../fakes/smtp-server.ts";

let server: FakeSmtpServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const message = {
  to: "ben@example.org",
  subject: "Hill repeats: Das Treffen wurde geändert.",
  text: "Plain part\nhttps://runs.example.org/p/abc\n",
  html: "<!doctype html><p>HTML part</p>",
  headers: { "List-Unsubscribe": "<https://runs.example.org/e/x>" },
};

const mailer = (port: number, auth?: { user: string; password: string }) =>
  createSmtpMailer({
    smtp: { host: "127.0.0.1", port, tls: "none", auth, from: "runs@example.org" },
    instanceName: "Isar Runs",
  });

describe("SMTP mailer (spec 7, decision D31)", () => {
  it("sends both parts from the instance, with the given headers", async () => {
    server = await new FakeSmtpServer().start();
    expect(await mailer(server.port).send(message)).toBe("sent");
    const [mail] = server.received;
    expect(mail?.from).toBe("runs@example.org");
    expect(mail?.to).toEqual(["ben@example.org"]);
    expect(mail?.raw).toMatch(/^From: "?Isar Runs"? <runs@example\.org>$/m);
    expect(mail?.raw).toMatch(/^To: ben@example\.org$/m);
    expect(mail?.raw).toMatch(/^List-Unsubscribe: <https:\/\/runs\.example\.org\/e\/x>$/m);
    expect(mail?.raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mail?.raw).toContain("Content-Type: text/html; charset=utf-8");
  });

  it("logs in when a user is configured", async () => {
    server = await new FakeSmtpServer({ auth: true }).start();
    expect(await mailer(server.port, { user: "runs", password: "secret" }).send(message)).toBe(
      "sent",
    );
    expect(server.logins).toEqual([{ username: "runs", password: "secret" }]);
  });

  it("reports a recipient the server refuses for good as gone, so the channel is deleted", async () => {
    server = await new FakeSmtpServer().start();
    server.refuseRecipient = 550;
    expect(await mailer(server.port).send(message)).toBe("gone");
  });

  it("retries when the server asks to try later or cannot be reached", async () => {
    server = await new FakeSmtpServer().start();
    server.refuseRecipient = 451;
    expect(await mailer(server.port).send(message)).toBe("retry");
    const port = server.port;
    await server.stop();
    server = undefined;
    expect(await mailer(port).send(message)).toBe("retry");
  });
});
