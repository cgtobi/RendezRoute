// Poster actors' handles (spec 7 ActivityPub; decisions D36, D37): chosen once, suggested from the
// display name, lowercase letters, digits and underscore.
import { describe, expect, it } from "vite-plus/test";
import { suggestHandle, validateHandle } from "../../src/domain/actor.ts";

describe("the handle (decision D36)", () => {
  it("is lowercase letters, digits and underscore, 1 to 30 of them", () => {
    expect(validateHandle(" anna_m82 ")).toEqual({ ok: true, value: "anna_m82" });
    expect(validateHandle("Anna")).toEqual({ ok: true, value: "anna" });
    for (const bad of ["", "anna.m", "anna-m", "änna", "a".repeat(31), "@anna"]) {
      expect(validateHandle(bad)).toEqual({ ok: false, error: "handle_invalid" });
    }
  });

  it("refuses names that would pass for the instance or its staff", () => {
    for (const reserved of ["admin", "instance", "root", "support", "rendezroute"]) {
      expect(validateHandle(reserved)).toEqual({ ok: false, error: "handle_reserved" });
    }
  });

  it("is suggested from the display name", () => {
    expect(suggestHandle("Anna Müller")).toBe("anna_muller");
    expect(suggestHandle("  Zoë  O'Brien-Smith ")).toBe("zoe_o_brien_smith");
    expect(suggestHandle("李华")).toBe("");
    expect(suggestHandle("x".repeat(40))).toBe("x".repeat(30));
    // Never a reserved one: the person types something else.
    expect(suggestHandle("Admin")).toBe("");
  });
});
