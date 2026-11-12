import { describe, expect, it } from "vite-plus/test";
import { shareButtons } from "../../src/client/share-buttons.ts";

const all = { native: true, copy: true, whatsApp: true };

describe("shareButtons (spec 5 feature 4, decisions D30, D41)", () => {
  it("offers the device's share sheet first, and the app link only where it has none", () => {
    expect([
      shareButtons({ supports: { share: true, copy: true }, offered: all }),
      shareButtons({ supports: { share: false, copy: true }, offered: all }),
      shareButtons({ supports: { share: false, copy: false }, offered: all }),
    ]).toEqual([
      { native: true, copy: true, apps: false, section: true },
      { native: false, copy: true, apps: true, section: true },
      { native: false, copy: false, apps: true, section: true },
    ]);
  });

  it("keeps the app link where the host does not offer the share sheet (decision D41)", () => {
    expect(
      shareButtons({
        supports: { share: true, copy: true },
        offered: { ...all, native: false },
      }),
    ).toEqual({ native: false, copy: true, apps: true, section: true });
  });

  it("shows only what the host offers", () => {
    const supports = { share: true, copy: true };
    expect(
      shareButtons({ supports, offered: { native: false, copy: true, whatsApp: false } }),
    ).toEqual({
      native: false,
      copy: true,
      apps: false,
      section: true,
    });
  });

  it("shows the section only once a button is shown", () => {
    const none = { share: false, copy: false };
    // Copy and the share sheet need the browser; without it there is nothing to show.
    expect(
      shareButtons({ supports: none, offered: { native: true, copy: true, whatsApp: false } })
        .section,
    ).toBe(false);
    expect(
      shareButtons({ supports: none, offered: { native: false, copy: true, whatsApp: false } })
        .section,
    ).toBe(false);
    // A desktop browser without the Web Share API, with only the share sheet offered.
    expect(
      shareButtons({
        supports: { share: false, copy: true },
        offered: { native: true, copy: false, whatsApp: false },
      }).section,
    ).toBe(false);
    // The WhatsApp link needs nothing from the browser, unless the share sheet replaces it.
    expect(
      shareButtons({ supports: none, offered: { native: false, copy: false, whatsApp: true } })
        .section,
    ).toBe(true);
    expect(
      shareButtons({
        supports: { share: true, copy: false },
        offered: { native: true, copy: false, whatsApp: true },
      }),
    ).toEqual({ native: true, copy: false, apps: false, section: true });
  });
});
