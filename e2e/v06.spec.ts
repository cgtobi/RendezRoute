// v0.6 in a real browser against the built image (spec 6a, plan step 4): participants rate a plan
// that has really started, the host closes the recap and sees the counts with the signed note.
// The plan is created a minute or two ahead on the real clock, and the server clock is moved past
// its start (the container has E2E_CLOCK_CONTROL, decision D87) instead of waiting for it.
import { expect, test } from "@playwright/test";
import { advanceClock, fillTimeOffGrid, openZoneLine, person } from "./helpers.ts";

test("Participants rate a plan; the host sees the result once the recap is closed", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: host } = await person(browser, base, problems);

  // The next full minute at least 90 seconds ahead of the SERVER's clock, in UTC. The container's
  // clock may already be ahead of the real one (earlier runs, E2E_KEEP, retries each add 3
  // minutes against the 7-day cap), so the start is taken from it, not from this machine.
  const serverNow = (await advanceClock(base, 0)).getTime();
  const startsAt = Math.ceil((serverNow + 90_000) / 60_000) * 60_000;
  const iso = new Date(startsAt).toISOString();
  await host.goto("/new");
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill("Rated run");
  await openZoneLine(host);
  await host.getByLabel("Time zone").selectOption("UTC");
  await host.getByLabel("Date").fill(iso.slice(0, 10));
  await fillTimeOffGrid(host, iso.slice(11, 16));
  await host.locator("#field-areaLabel").fill("Flaucher, north end");
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";

  const participants = [];
  for (const name of ["Ben", "Lea", "Max"]) {
    const { page } = await person(browser, base, problems);
    await page.goto(planUrl);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "I'm in" }).click();
    await expect(page.getByRole("heading", { name: "Response saved" })).toBeVisible();
    participants.push(page);
  }
  const [ben, lea] = participants;
  if (ben === undefined || lea === undefined) throw new Error("missing participants");

  // The start, on the server's clock: three minutes pass the latest start (150 seconds ahead).
  await advanceClock(base, 180_000);
  await ben.goto(planUrl);
  await expect(ben.getByRole("button", { name: "Save rating" })).toBeVisible();
  // The honesty line, in full, under the choice.
  await expect(ben.locator("#rating fieldset")).toContainText(
    "Only the host sees ratings. In a small group they may guess who gave one. Notes show your name.",
  );
  await ben.getByLabel("Didn’t go well").check();
  await ben.locator("#field-ratingNote").fill("A bit too fast for me.");
  await ben.getByRole("button", { name: "Save rating" }).click();
  await expect(ben.getByRole("button", { name: "Remove my rating" })).toBeVisible();
  await lea.goto(planUrl);
  await lea.getByLabel("Went well").check();
  await lea.getByRole("button", { name: "Save rating" }).click();
  await expect(lea.getByRole("button", { name: "Remove my rating" })).toBeVisible();

  // Nothing for the host while rating is open; closing the recap shows the result.
  await host.goto(`${planUrl}/host`);
  await expect(
    host.getByText(/Participants can rate the plan while the recap is open/),
  ).toBeVisible();
  expect(await host.content()).not.toContain("A bit too fast for me.");
  await host.getByLabel("Recap").selectOption("now");
  await host.getByRole("button", { name: "Save changes" }).click();
  await expect(host.getByText("Changes saved.")).toBeVisible();
  await expect(host.getByText("2 of 3 rated: 1 up, 1 down")).toBeVisible();
  await expect(host.getByText("A bit too fast for me.")).toBeVisible();

  // The other participant never sees Ben's note.
  await lea.reload();
  await expect(lea.getByText("Your rating:")).toBeVisible();
  expect(await lea.content()).not.toContain("A bit too fast for me.");
  expect(problems).toEqual([]);
});
