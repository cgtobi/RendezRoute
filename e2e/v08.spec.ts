// The 0.8 features in a real browser against the built image (plan v1.0 steps 6–8; decisions
// D31, D33, D34, D35):
// email notifications confirmed by their link and turned off from every email, "Email me my
// links", and report alerts, against the fake mail server; ntfy and Telegram against their fakes;
// Nearby with a public plan (step 8). Runs only in the "0.7 and 0.8 features" project.
import { expect, test } from "@playwright/test";
import {
  adminLogIn,
  createPlan,
  fillHostName,
  inFiveDays,
  newInvite,
  oidcLogIn,
  openFold,
  person,
  useInvite,
} from "./helpers.ts";

const RUN = Date.now().toString(36);
const MAIL = "http://localhost:8080/mail";

interface Mail {
  to: string[];
  text: string;
}

/** Waits for the job runner (every 10 seconds) to send the next email to this address. */
async function nextMail(to: string, after: number): Promise<Mail> {
  let mails: Mail[] = [];
  await expect
    .poll(
      async () => {
        mails = (await (await fetch(`${MAIL}?to=${encodeURIComponent(to)}`)).json()) as Mail[];
        return mails.length;
      },
      { timeout: 40_000, intervals: [1_000] },
    )
    .toBeGreaterThan(after);
  return mails[after] as Mail;
}

/** The email's link back to this instance. */
const linkIn = (mail: Mail) => /http:\/\/localhost:3103\/e\/[^\s"<>]+/.exec(mail.text)?.[0] ?? "";

test("Email: confirm by link, a new link, notifications, one-click off, report alerts", async ({
  browser,
  baseURL,
  request,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const ben = `ben-${RUN}@example.org`;
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const { page: joiner } = await person(browser, base, problems);

  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  const planUrl = await createPlan(host, `Email run ${RUN}`);

  // Ben joins and asks for emails on his manage page.
  await joiner.goto(planUrl);
  await joiner.getByLabel("Your name").fill("Ben");
  await joiner.getByRole("button", { name: "I'm in" }).click();
  await joiner.goto(`${planUrl}/me`);
  await joiner.getByLabel("Email for news about this plan").fill(ben);
  await joiner.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(joiner.getByText(`Open the link we sent to ${ben}`)).toBeVisible();

  // Only the confirmation link arrives; opening it in another browser changes nothing yet.
  const confirmation = await nextMail(ben, 0);
  const link = linkIn(confirmation);
  expect(link).not.toBe("");
  const { page: mailApp } = await person(browser, base, problems);
  await mailApp.goto(link);
  await expect(mailApp.getByRole("heading", { name: "Confirm your email address" })).toBeVisible();
  await mailApp.getByRole("button", { name: "Confirm address" }).click();
  await expect(mailApp.getByText("Address confirmed.")).toBeVisible();
  await joiner.reload();
  await expect(joiner.getByText(`Emails about this plan go to ${ben}.`)).toBeVisible();

  // "Email me my links": a new manage link by email; the page says older ones stopped working.
  await joiner.getByRole("button", { name: "Email me a new link" }).click();
  await expect(joiner.getByText(`We sent a new link to ${ben}.`)).toBeVisible();
  const newLink = await nextMail(ben, 1);
  expect(newLink.text).toMatch(/http:\/\/localhost:3103\/m\/[A-Za-z0-9_-]{43}/);

  // The host cancels: Ben gets an email with the link to turn them off.
  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  const cancelled = await nextMail(ben, 2);
  expect(cancelled.text).toContain("The plan was cancelled.");
  expect(cancelled.text).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  expect(linkIn(cancelled)).toBe(link);

  // One click in the mail app turns them off, without cookies; the link then no longer works.
  const off = await request.post(link, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(off.status()).toBe(200);
  await joiner.reload();
  await expect(joiner.getByLabel("Email for news about this plan")).toBeVisible();
  expect((await request.get(link)).status()).toBe(404);

  // A report alerts the contact address, without the report's content.
  const alerts = (await (await fetch(`${MAIL}?to=e2e@example.org`)).json()) as Mail[];
  const { page: visitor } = await person(browser, base, problems);
  await visitor.goto(planUrl);
  await visitor.getByRole("link", { name: "Report this plan" }).click();
  await visitor.getByLabel("Spam or advertising").check();
  await visitor.getByLabel("Details").fill(`SENTINEL-${RUN}`);
  await visitor.getByRole("button", { name: "Send report" }).click();
  const alert = await nextMail("e2e@example.org", alerts.length);
  expect(alert.text).toContain("http://localhost:3103/admin/");
  expect(alert.text).not.toContain("SENTINEL");

  // Chrome logs the deliberate 404 of the used link as an error; nothing else may appear.
  expect(problems.filter((problem) => !problem.includes("status of 404"))).toEqual([]);
});

test("ntfy: a secret topic, confirmed by tapping the posted link, then notifications", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const { page: joiner } = await person(browser, base, problems);
  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  const planUrl = await createPlan(host, `ntfy run ${RUN}`);

  await joiner.goto(planUrl);
  await joiner.getByLabel("Your name").fill("Ben");
  await joiner.getByRole("button", { name: "I'm in" }).click();
  await joiner.goto(`${planUrl}/me`);
  await joiner.getByText("More ways to be notified").click();
  await joiner.getByRole("button", { name: "Set up ntfy" }).click();
  const topicUrl = (await joiner.locator("#ntfy .link-box code").textContent()) ?? "";
  const topic = topicUrl.split("/").pop() ?? "";
  expect(topic).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const messages = async (count: number) => {
    let all: { click?: string; message?: string; actions?: { url: string }[] }[] = [];
    await expect
      .poll(
        async () => {
          all = (await (
            await fetch(`http://localhost:8080/ntfy-messages?topic=${topic}`)
          ).json()) as typeof all;
          return all.length;
        },
        { timeout: 40_000, intervals: [1_000] },
      )
      .toBeGreaterThanOrEqual(count);
    return all;
  };
  const [confirmation] = await messages(1);
  const { page: phone } = await person(browser, base, problems);
  await phone.goto(confirmation?.click ?? "");
  await phone.getByRole("button", { name: "Confirm" }).click();
  await expect(phone.getByText("ntfy notifications are on.")).toBeVisible();

  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  const all = await messages(2);
  expect(all[1]?.message).toContain("The plan was cancelled.");
  expect(all[1]?.actions?.[0]?.url).toBe(confirmation?.click);
  expect(problems).toEqual([]);
});

test("Telegram: Start in the bot confirms, then notifications with a button to turn them off", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const { page: joiner } = await person(browser, base, problems);
  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  const planUrl = await createPlan(host, `Telegram run ${RUN}`);

  await joiner.goto(planUrl);
  await joiner.getByLabel("Your name").fill("Ben");
  await joiner.getByRole("button", { name: "I'm in" }).click();
  await joiner.goto(`${planUrl}/me`);
  await joiner.getByText("More ways to be notified").click();
  await joiner.getByRole("button", { name: "Connect Telegram" }).click();
  const deepLink =
    (await joiner.getByRole("link", { name: "Open Telegram" }).getAttribute("href")) ?? "";
  const code = new URL(deepLink).searchParams.get("start") ?? "";
  expect(deepLink).toMatch(/^https:\/\/t\.me\/rendezroute_e2e_bot\?start=/);

  // Pressing Start in the bot, from a chat of this run: the fakes keep messages across runs.
  const chat = String(Date.now());
  await fetch("http://localhost:8080/telegram-test/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId: chat, text: `/start ${code}` }),
  });
  await expect
    .poll(
      async () => {
        await joiner.reload();
        return joiner.getByText("Telegram notifications are on.").isVisible();
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe(true);

  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  let messages: { text: string }[] = [];
  await expect
    .poll(
      async () => {
        messages = (await (
          await fetch(`http://localhost:8080/telegram-test/messages?chat=${chat}`)
        ).json()) as { text: string }[];
        return messages.length;
      },
      { timeout: 40_000, intervals: [1_000] },
    )
    .toBe(2);
  expect(messages[0]?.text).toContain("are on");
  expect(messages[1]?.text).toContain("The plan was cancelled.");
  expect(problems).toEqual([]);
});

test("Nearby: a public plan found from the device's location and from a typed place", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const title = `Public long run ${RUN}`;
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  // Public plans need an account here (PUBLIC_REQUIRES_LOGIN, decision D35).
  await oidcLogIn(host);
  await host.goto("/new");
  await fillHostName(host, "Anna");
  await host.getByLabel("Title").fill(title);
  await host.getByLabel("Date").fill(inFiveDays());
  await host.getByLabel("Start time").fill("08:30");
  await host.locator("#field-areaLabel").fill("Flaucher");
  // The area point from place search (the fake geocoder knows Flaucher at 48.1107, 11.5582).
  await host.locator(".place-search").getByRole("button", { name: "Search" }).click();
  await host.getByRole("button", { name: "Flaucher, Isar, Munich" }).click();
  await openFold(host, "Who can join and find it");
  await host.getByLabel("Anyone: listed in Nearby on this site").check();
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();

  // "Use my location" only fills the form; the search sends the point on the 0.02° grid.
  const { page: viewer } = await person(browser, base, problems, {
    context: {
      geolocation: { latitude: 48.1371, longitude: 11.5754 },
      permissions: ["geolocation"],
    },
  });
  // Every request the page makes: nothing may carry the place before "Search".
  const sent: string[] = [];
  viewer.on("request", (request) => sent.push(request.url()));
  await viewer.goto("/nearby");
  const search = viewer.locator("form[data-nearby] > button[type=submit]");
  await viewer.getByRole("button", { name: "Use my location" }).click();
  await expect(viewer.getByText("Around the spot you chose")).toBeVisible();
  expect(sent.filter((url) => /lat=|48\.13|48\.14/.test(url))).toEqual([]);
  await search.click();
  await expect(viewer).toHaveURL(/\/nearby\?(?:[^#]*&)?lat=48\.14&lng=11\.58(?:&|$)/);
  // Never the device's own coordinates, only the grid point.
  expect(sent.filter((url) => url.includes("48.137"))).toEqual([]);
  await viewer.getByRole("link", { name: title }).click();
  await expect(viewer.locator(".plan-visibility")).toHaveText("Public");

  // A typed place is looked up first: only its rounded point is in the address.
  const { page: typer } = await person(browser, base, problems);
  await typer.goto("/nearby");
  await typer.getByLabel("Place").fill("Flaucher");
  await typer.locator("form[data-nearby] > button[type=submit]").click();
  await expect(typer).toHaveURL(/\/nearby\?(?:[^#]*&)?lat=48\.12&lng=11\.56(?:&|$)/);
  expect(typer.url()).not.toContain("Flaucher");
  await expect(typer.getByRole("link", { name: title })).toBeVisible();
  expect(problems).toEqual([]);
});
