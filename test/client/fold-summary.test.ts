import { describe, expect, it } from "vite-plus/test";
import {
  exactKey,
  isPublicKey,
  openClosedDetails,
  parseSummaries,
  summaryKey,
  whoKey,
} from "../../src/client/fold-summary-rule.ts";

describe("whoKey (decision D61)", () => {
  it("is open and link-only by default, also with nothing checked", () => {
    expect(whoKey(undefined, undefined)).toBe("open:link");
    expect(whoKey("open", "link")).toBe("open:link");
  });

  it("follows the checked join and visibility radios", () => {
    expect(whoKey("approval", "followers")).toBe("approval:followers");
    expect(whoKey("open", "public")).toBe("open:public");
    expect(whoKey("approval", "public")).toBe("approval:public");
  });

  it("treats anything unknown as the default", () => {
    expect(whoKey("other", "everyone")).toBe("open:link");
  });

  it("warns only for public", () => {
    expect(isPublicKey("open:public")).toBe(true);
    expect(isPublicKey("approval:public")).toBe(true);
    expect(isPublicKey("open:followers")).toBe(false);
    expect(isPublicKey("open:link")).toBe(false);
  });
});

describe("exactKey", () => {
  it("is 'none' for empty or blank values and 'set' once any value has text", () => {
    expect(exactKey("open", ["", "", ""])).toBe("open:none");
    expect(exactKey("open", ["  ", "", ""])).toBe("open:none");
    expect(exactKey("open", ["Gate", "", ""])).toBe("open:set");
    expect(exactKey("approval", ["", "48.1", ""])).toBe("approval:set");
    expect(exactKey(undefined, ["", "", "11"])).toBe("open:set");
  });
});

describe("parseSummaries", () => {
  it("reads string values and ignores anything else", () => {
    expect(parseSummaries('{"open:link":"A","x":1}')).toEqual({ "open:link": "A" });
    expect(parseSummaries("not json")).toEqual({});
    expect(parseSummaries("[1]")).toEqual({});
    expect(parseSummaries("null")).toEqual({});
    expect(parseSummaries(undefined)).toEqual({});
  });
});

describe("summaryKey", () => {
  const exact = ["", "", ""];
  it("uses the restored form state, e.g. a public radio under a link-only summary", () => {
    expect(summaryKey("who", { join: "open", find: "public", exact })).toBe("open:public");
    expect(summaryKey("exact", { join: "approval", find: "public", exact: ["", "48", ""] })).toBe(
      "approval:set",
    );
  });
});

describe("openClosedDetails", () => {
  /** A chain of elements: closest() walks up from the element itself to the first closed one. */
  interface Fake {
    open: boolean;
    parent: Fake | null;
    setAttribute(name: string, value: string): void;
    closest(selector: string): Fake | null;
  }
  const node = (parent: Fake | null, open = false): Fake => {
    const self: Fake = {
      open,
      parent,
      setAttribute() {
        self.open = true;
      },
      closest() {
        for (let up: Fake | null = self; up !== null; up = up.parent) if (!up.open) return up;
        return null;
      },
    };
    return self;
  };

  it("opens every closed details around the control, not just the nearest", () => {
    const outer = node(null);
    const inner = node(outer);
    const control = node(inner, true);
    expect(openClosedDetails(control)).toBe(true);
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(true);
  });

  it("does nothing outside a closed details", () => {
    expect(openClosedDetails(node(null, true))).toBe(false);
  });
});
