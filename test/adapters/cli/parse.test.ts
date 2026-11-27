import { describe, expect, it } from "vite-plus/test";
import { parseCommand } from "../../../src/adapters/in/cli/parse.ts";

describe("parseCommand (decision I5)", () => {
  it("defaults to serve", () => {
    expect(parseCommand([])).toEqual({ kind: "serve" });
    expect(parseCommand(["serve"])).toEqual({ kind: "serve" });
  });

  it("knows apply-retention-max (spec 3.10)", () => {
    expect(parseCommand(["apply-retention-max"])).toEqual({ kind: "apply-retention-max" });
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

  it("knows backup with a target directory (spec 11)", () => {
    expect(parseCommand(["backup", "/backups"])).toEqual({ kind: "backup", directory: "/backups" });
    expect(parseCommand(["backup"]).kind).toBe("error");
    expect(parseCommand(["backup", "/a", "/b"]).kind).toBe("error");
  });

  it("knows recent-plans without arguments (ADR 009)", () => {
    expect(parseCommand(["recent-plans"])).toEqual({ kind: "recent-plans" });
    expect(parseCommand(["recent-plans", "x"]).kind).toBe("error");
  });

  it("knows delete-plan with one plan id (ADR 009)", () => {
    const id = "abcdefghijklmnopqrstuv";
    expect(parseCommand(["delete-plan", id])).toEqual({ kind: "delete-plan", planId: id });
    expect(parseCommand(["delete-plan"]).kind).toBe("error");
    expect(parseCommand(["delete-plan", id, id]).kind).toBe("error");
    expect(parseCommand(["delete-plan", "../etc"]).kind).toBe("error");
  });
});
