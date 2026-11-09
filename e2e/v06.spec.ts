// v0.6 in a real browser against the built image (spec 6a, plan step 4): participants rate a plan
// that has really started, the host closes the recap and sees the counts with the signed note.
// The image runs on the real clock, so the plan starts about two minutes after it is created.
import { expect, test } from "@playwright/test";
import { person } from "./helpers.ts";

test("Participants rate a plan; the host sees the result once the recap is closed", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: host } = await person(browser, base, problems);

  // The next full minute at least 90 seconds ahead, in UTC.
  const startsAt = Math.ceil((Date.now() + 90_000) / 60_000) * 60_000;
  const iso = new Date(startsAt).toISOString();
  await host.goto("/new");
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill("Rated run");
  await host.getByLabel("Time zone").selectOption("UTC");
  await host.getByLabel("Date").fill(iso.slice(0, 10));
  await host.getByLabel("Start time").fill(iso.slice(11, 16));
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

  // Wait for the start on the server's clock: reload until the rating form appears.
  await ben.goto(planUrl);
  await expect(async () => {
    await ben.reload();
    await expect(ben.getByRole("button", { name: "Save rating" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: startsAt - Date.now() + 60_000, intervals: [5_000] });
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
