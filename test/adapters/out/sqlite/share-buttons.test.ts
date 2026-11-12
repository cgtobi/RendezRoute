import { describe, expect, it } from "vite-plus/test";
import {
  shareButtonsFromText,
  shareButtonsToText,
} from "../../../../src/adapters/out/sqlite/share-buttons.ts";

describe("the stored share buttons (decision D41)", () => {
  it("are comma-separated in their fixed order", () => {
    expect(shareButtonsToText(["whatsApp", "copy"])).toBe("copy,whatsApp");
    expect(shareButtonsToText([])).toBe("");
    expect(shareButtonsFromText("copy,native,whatsApp")).toEqual(["copy", "native", "whatsApp"]);
    expect(shareButtonsFromText("native")).toEqual(["native"]);
  });

  it("read a garbled value as far as it is understood", () => {
    expect(shareButtonsFromText("")).toEqual([]);
    expect(shareButtonsFromText("x,copy,Telegram")).toEqual(["copy"]);
    expect(shareButtonsFromText("whatsApp,whatsApp,copy,copy")).toEqual(["copy", "whatsApp"]);
    expect(shareButtonsFromText(" copy ,,native")).toEqual(["native"]);
  });
});
