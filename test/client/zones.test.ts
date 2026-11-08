import { describe, expect, it } from "vite-plus/test";
import { detectedZone } from "../../src/client/zones.ts";

describe("detectedZone (decision P6)", () => {
  const offered = ["UTC", "Europe/Berlin", "America/New_York"];

  it("picks the browser's zone while the select still shows the server default", () => {
    expect(
      detectedZone({ offered, current: "UTC", fallback: "UTC", browser: "Europe/Berlin" }),
    ).toBe("Europe/Berlin");
  });

  it("keeps a zone the poster chose or a form re-shown with errors", () => {
    expect(
      detectedZone({
        offered,
        current: "America/New_York",
        fallback: "UTC",
        browser: "Europe/Berlin",
      }),
    ).toBeUndefined();
  });

  it("ignores zones the server does not offer", () => {
    expect(
      detectedZone({ offered, current: "UTC", fallback: "UTC", browser: "Mars/Olympus" }),
    ).toBeUndefined();
    expect(
      detectedZone({ offered, current: "UTC", fallback: "UTC", browser: undefined }),
    ).toBeUndefined();
  });
});
