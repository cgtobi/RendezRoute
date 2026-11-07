import { describe, expect, it } from "vite-plus/test";
import { parseCommand } from "../../../src/adapters/in/cli/parse.ts";

describe("parseCommand (decision I5)", () => {
  it("defaults to serve", () => {
    expect(parseCommand([])).toEqual({ kind: "serve" });
    expect(parseCommand(["serve"])).toEqual({ kind: "serve" });
  });

  it("shows help", () => {
    for (const argv of [["help"], ["--help"], ["-h"]]) {
      expect(parseCommand(argv)).toEqual({
        kind: "help",
        usage: expect.stringContaining("rendezroute serve"),
      });
    }
  });

  it("rejects unknown commands with usage", () => {
    expect(parseCommand(["destroy"])).toEqual({
      kind: "error",
      message: expect.stringContaining('Unknown command "destroy"'),
    });
  });

  it("rejects extra arguments", () => {
    expect(parseCommand(["serve", "--port", "1"])).toEqual({
      kind: "error",
      message: expect.stringContaining("serve"),
    });
  });
});
