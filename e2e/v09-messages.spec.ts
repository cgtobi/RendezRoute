// The fediverse direct-message notice in a real browser against the built image (plan v1.0 step
// 13b2, decision D51): an account that logged in through the fake Mastodon server (fakes/identity.ts)
// as a person of this run's own switches the channel on and gets the first message as a private
// Note from the fediverse fake (fakes/fediverse.ts), which serves that person's WebFinger and actor.
// Runs only in the "0.7 to 0.9 features" project; names carry the run (kept containers share fakes).
import { expect, test } from "@playwright/test";
import { person } from "./helpers.ts";
import { addresses, expectSigned, FAKES_HOST, received, waitFor } from "./federation.ts";

const RUN = Date.now().toString(36);

test("Fediverse messages: switching on sends one private first message, switching off nothing more", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  const dm = `dm-${RUN}`;
  const personId = `${FAKES_HOST}/fedi/users/${dm}`;
  const { page, context } = await person(browser, baseURL ?? "", problems);

  // The fake Mastodon logs in the person of this run's own (the cookie, as for the OIDC fake).
  await context.addCookies([{ name: "e2e-oidc-person", value: dm, url: FAKES_HOST }]);
  await page.goto("/account");
  await page.getByLabel("Your server").fill(FAKES_HOST);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("link", { name: "Continue to fakes:8080" }).click();
  await expect(page.getByText("You are logged in.")).toBeVisible();
  await expect(page.locator("#field-displayName")).toHaveValue(`Person ${dm}`);

  // Switch the channel on: the switch is in the closed "More ways to be notified" part.
  const oldLength = (await received(dm)).length;
  await page.getByText("More ways to be notified").click();
  await expect(page.getByText("Fediverse messages", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on fediverse messages" }).click();
  await expect(
    page.getByText("Notices about your account come to you as direct messages"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn off fediverse messages" })).toBeVisible();

  // The first message: a Create of a Note to that person alone, signed, saying what it is for.
  const first = await waitFor(
    dm,
    (a) =>
      typeof a.object === "object" &&
      (a.object.content ?? "").includes("now come to you here, as direct messages") &&
      addresses(a.to).includes(personId),
    oldLength,
  );
  expect(first.type).toBe("Create");
  const note = typeof first.object === "object" ? first.object : undefined;
  expect(note?.type).toBe("Note");
  expect(addresses(first.to)).toEqual([personId]);
  expect(addresses(note?.to)).toEqual([personId]);
  expect(addresses(first.cc)).toEqual([]);
  expect(addresses(note?.cc)).toEqual([]);
  const text = note?.content ?? "";
  expect(text).toContain("now come to you here, as direct messages");
  expect(text).toContain("Your server keeps direct messages; this site cannot delete them.");
  expect(text).toContain("To turn them off, open your account page: http://localhost:3103/account");
  // The Mention tag names the person.
  expect(JSON.stringify(note?.tag)).toContain(personId);
  // Nothing public, and no place or time of any plan in it.
  const everything = JSON.stringify(first);
  expect(everything).not.toMatch(/Public/);
  expect(everything).not.toMatch(/startTime|latitude|longitude|\d\.\d{4,}|\/federation\/notes\//);

  // The page keeps the channel on after a reload.
  await page.reload();
  // The fold opens by itself while a channel is on: no click here.
  await expect(page.getByRole("button", { name: "Turn off fediverse messages" })).toBeVisible();

  // Switching off sends nothing: not within a full cycle of the job runner (10 seconds).
  await page.getByRole("button", { name: "Turn off fediverse messages" }).click();
  // The fold is still open after switching off: no click.
  await expect(page.getByRole("button", { name: "Turn on fediverse messages" })).toBeVisible();
  // Only this person's own inbox counts: the shared one carries other specs' deliveries too.
  const own = async () => (await received(dm)).filter((entry) => entry.inbox === dm);
  const afterOff = (await own()).length;
  await page.waitForTimeout(12_000);
  const delivered = await own();
  expect(delivered).toHaveLength(afterOff);
  expect(delivered.filter((entry) => JSON.stringify(entry.activity).includes("Note"))).toHaveLength(
    1,
  );
  expectSigned(delivered);
  expect(problems).toEqual([]);
});
