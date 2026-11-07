import { describe, expect, it } from "vite-plus/test";
import { retentionOptions } from "../../../src/adapters/in/http/views/format.ts";

describe("retentionOptions (spec 3.10)", () => {
  it("offers 1 to the maximum", () => {
    expect(retentionOptions(3, "2")).toEqual(["1", "2", "3"]);
  });

  it("adds a longer current value kept from before the maximum was lowered", () => {
    expect(retentionOptions(3, "30")).toEqual(["1", "2", "3", "30"]);
  });

  it("ignores empty or malformed current values", () => {
    expect(retentionOptions(2, "")).toEqual(["1", "2"]);
    expect(retentionOptions(2, "x")).toEqual(["1", "2"]);
  });
});
