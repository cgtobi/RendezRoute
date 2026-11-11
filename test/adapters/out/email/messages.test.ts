// The emails' look and content (design note "Emails (step 6)", decision D31): a plain-text and a
// simple HTML part, one main link, every link written out, nothing loaded from elsewhere.
import { describe, expect, it } from "vite-plus/test";
import {
  confirmationEmail,
  notificationEmail,
  reportAlertEmail,
} from "../../../../src/adapters/out/email/messages.ts";

const instance = { instanceName: "Isar Runs", baseUrl: new URL("https://runs.example.org") };
const OFF = "https://runs.example.org/e/channel-1_s_signature";

describe("notification emails", () => {
  const email = notificationEmail(
    {
      kind: "changed",
      planTitle: "Hill <repeats> & “more”",
      planPath: "/p/abc",
      language: "de",
    },
    { ...instance, offUrl: OFF },
  );

  it("say what happened in the recipient's language, with the plan's link", () => {
    expect(email.subject).toBe(
      "Hill <repeats> & “more”: Das Treffen wurde geändert. Sieh dir die Details an.",
    );
    expect(email.text).toContain("Das Treffen wurde geändert. Sieh dir die Details an.");
    expect(email.text).toContain("https://runs.example.org/p/abc");
    expect(email.html).toContain('href="https://runs.example.org/p/abc"');
  });

  it("can be turned off from the message, also in one click from the mail app (RFC 8058)", () => {
    expect(email.text).toContain(OFF);
    expect(email.html).toContain(`href="${OFF}"`);
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<${OFF}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Auto-Submitted": "auto-generated",
    });
  });

  it("escape the plan title in the HTML part", () => {
    expect(email.html).toContain("Hill &lt;repeats&gt; &amp; “more”");
    expect(email.html).not.toContain("<repeats>");
  });

  it("load nothing and write every link out in full", () => {
    expect(email.html).not.toMatch(/<img|<link|<script|url\(|src=/i);
    const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(email.html).toContain(`>${href}<`);
      expect(email.text).toContain(href);
    }
  });

  it("use the page's light colours, the instance name in the accent colour at the top", () => {
    expect(email.html).toMatch(/^<!doctype html>/i);
    expect(email.html).toContain('<html lang="de">');
    expect(email.html.indexOf("Isar Runs")).toBeLessThan(email.html.indexOf("Hill"));
    expect(email.html).toContain("color:#2c67a8");
    expect(email.html).toContain("background:#2c67a8;color:#ffffff");
    expect(email.text.startsWith("Isar Runs\n")).toBe(true);
  });

  it("show when and where as lines, as on the plan page, in the recipient's language", () => {
    const withFacts = notificationEmail(
      {
        kind: "dayBefore",
        planTitle: "Hill repeats",
        facts: {
          startsAt: "2026-06-07T06:30:00.000Z",
          timeZone: "Europe/Berlin",
          area: "Flaucher <north>",
        },
        planPath: "/p/abc",
        language: "de",
      },
      { ...instance, offUrl: OFF },
    );
    expect(withFacts.text).toContain(
      "Erinnerung: Das Treffen ist morgen.\n\nSonntag, 7. Juni 2026, 08:30 (Zeitzone Europe/Berlin)\nFlaucher <north>\n",
    );
    expect(withFacts.html).toContain("Sonntag, 7. Juni 2026, 08:30");
    expect(withFacts.html).toContain("Flaucher &lt;north&gt;");
  });

  it("are the last ones once the plan is gone: no plan link, nothing left to turn off", () => {
    const deleted = notificationEmail(
      { kind: "deleted", planTitle: "Hill repeats", language: "en" },
      { ...instance, offUrl: undefined },
    );
    expect(deleted.text).not.toContain("/p/");
    expect(deleted.text).not.toContain("/e/");
    expect(deleted.text).not.toContain("Turn off these emails");
    expect(deleted.text).toContain("This plan is gone, so no more emails about it will be sent.");
    expect(deleted.headers).toEqual({ "Auto-Submitted": "auto-generated" });
  });
});

describe("the confirmation email", () => {
  const email = confirmationEmail(
    { planTitle: "Hill repeats", language: "fr" },
    { ...instance, confirmUrl: OFF },
  );

  it("asks to confirm in the owner's language, with the link as its one action", () => {
    expect(email.subject).toContain("Hill repeats");
    expect(email.text).toContain(OFF);
    expect(new Set([...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]))).toEqual(
      new Set([OFF]),
    );
    expect(email.html).toContain('<html lang="fr">');
  });

  it("can be refused by whoever got it without asking, also in one click (spec 7)", () => {
    expect(email.text).toContain(
      `Ce n’est pas vous\u202f? Ne rien envoyer à cette adresse: ${OFF}`,
    );
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<${OFF}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Auto-Submitted": "auto-generated",
    });
  });
});

describe("the report alert (spec 7 Moderation)", () => {
  const email = reportAlertEmail(instance);

  it("points to the admin page and says nothing about the report", () => {
    expect(email.subject).toBe("New report on Isar Runs");
    expect(email.text).toContain("https://runs.example.org/admin/");
    expect(email.html).toContain('href="https://runs.example.org/admin/"');
  });
});
