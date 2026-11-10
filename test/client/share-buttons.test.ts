import { describe, expect, it } from "vite-plus/test";
import { shareButtons } from "../../src/client/share-buttons.ts";

describe("shareButtons (spec 5 feature 4, decision D30)", () => {
  it("offers the device's share sheet first, and the app links only where it has none", () => {
    expect([
      shareButtons({ share: true, copy: true }),
      shareButtons({ share: false, copy: true }),
      shareButtons({ share: false, copy: false }),
    ]).toEqual([
      { native: true, copy: true, apps: false },
      { native: false, copy: true, apps: true },
      { native: false, copy: false, apps: true },
    ]);
  });
});
