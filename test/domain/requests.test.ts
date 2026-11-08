import { describe, expect, it } from "vite-plus/test";
import {
  acceptRequest,
  choicesFor,
  isNotAnswered,
  rejectRequest,
  requestsAcceptedBySwitch,
  undoRejectionOrRemoval,
  validateRequestNote,
} from "../../src/domain/requests.ts";
import type { PlanResponse } from "../../src/domain/response.ts";

const now = new Date("2026-06-02T10:00:00Z");
const upcoming = { startsAt: new Date("2026-06-07T05:30:00Z"), status: "active" as const };
const started = { ...upcoming, startsAt: new Date("2026-06-01T05:30:00Z") };
const cancelled = { ...upcoming, status: "cancelled" as const };

const response = (
  kind: PlanResponse["kind"],
  previousKind?: PlanResponse["kind"],
  requestNote?: string,
): PlanResponse => ({
  id: "r1",
  planId: "p1",
  kind,
  displayName: "Ben",
  requestNote,
  language: "en",
  previousKind,
  createdAt: new Date("2026-06-01T08:00:00Z"),
  updatedAt: new Date("2026-06-01T08:00:00Z"),
});

describe("choicesFor (spec 3.4, decision I37)", () => {
  it("offers joining in open mode and requesting in approval mode", () => {
    expect(choicesFor("open")).toEqual(["interested", "joined"]);
    expect(choicesFor("approval")).toEqual(["interested", "requested"]);
  });

  it("lets an accepted participant stay joined instead of requesting again", () => {
    expect(choicesFor("approval", "joined")).toEqual(["interested", "joined"]);
    expect(choicesFor("approval", "requested")).toEqual(["interested", "requested"]);
    expect(choicesFor("open", "removed")).toEqual(["interested", "joined"]);
  });
});

describe("validateRequestNote (spec 6 feature 1)", () => {
  it("is optional plain text of up to 500 characters, line breaks allowed", () => {
    expect(validateRequestNote("")).toEqual({ ok: true, value: undefined });
    expect(validateRequestNote("  Hi!\nI run 5:30 pace.  ")).toEqual({
      ok: true,
      value: "Hi!\nI run 5:30 pace.",
    });
    expect(validateRequestNote("x".repeat(501))).toEqual({ ok: false, error: "too_long" });
    expect(validateRequestNote("bell\u0007")).toEqual({ ok: false, error: "invalid_characters" });
  });
});

describe("accepting and rejecting requests (spec 3.1, 3.4, 3.5)", () => {
  it("turns a pending request into a participant and drops the note", () => {
    expect(acceptRequest(response("requested", undefined, "hi"), upcoming, now)).toEqual({
      ok: true,
      value: { ...response("joined"), updatedAt: now },
    });
    expect(acceptRequest(response("interested"), upcoming, now)).toEqual({
      ok: false,
      error: "not_pending",
    });
  });

  it("rejects a pending request, remembering it for undo and dropping the note", () => {
    expect(rejectRequest(response("requested", undefined, "hi"), upcoming, now)).toEqual({
      ok: true,
      value: { ...response("rejected", "requested"), updatedAt: now },
    });
  });

  it("decides nothing once the plan has started or was cancelled", () => {
    for (const plan of [started, cancelled]) {
      expect(acceptRequest(response("requested"), plan, now).ok).toBe(false);
      expect(rejectRequest(response("requested"), plan, now).ok).toBe(false);
    }
  });
});

describe("isNotAnswered (spec 3.1)", () => {
  it("is true for a request still pending at the start or after cancelling", () => {
    expect(isNotAnswered(response("requested"), started, now)).toBe(true);
    expect(isNotAnswered(response("requested"), cancelled, now)).toBe(true);
    expect(isNotAnswered(response("requested"), upcoming, now)).toBe(false);
    expect(isNotAnswered(response("joined"), started, now)).toBe(false);
  });
});

describe("undoRejectionOrRemoval (spec 3.5, decision I37)", () => {
  const undo = (r: PlanResponse, mode: "open" | "approval", plan = upcoming) =>
    undoRejectionOrRemoval(r, { ...plan, joinMode: mode }, now);

  it("returns rejected people to pending in approval mode and makes them participants in open mode", () => {
    expect(undo(response("rejected", "requested"), "approval")).toMatchObject({
      ok: true,
      value: { kind: "requested", previousKind: undefined },
    });
    expect(undo(response("rejected", "requested"), "open")).toMatchObject({
      value: { kind: "joined" },
    });
  });

  it("returns removed participants to pending in approval mode, to joined in open mode", () => {
    expect(undo(response("removed", "joined"), "approval")).toMatchObject({
      value: { kind: "requested" },
    });
    expect(undo(response("removed", "joined"), "open")).toMatchObject({
      value: { kind: "joined" },
    });
  });

  it("returns removed interested people to interested in either mode", () => {
    for (const mode of ["open", "approval"] as const) {
      expect(undo(response("removed", "interested"), mode)).toMatchObject({
        value: { kind: "interested" },
      });
    }
  });

  it("after the start restores the previous state, but accepts no one: a rejection stays a request", () => {
    expect(undo(response("removed", "joined"), "approval", started)).toMatchObject({
      value: { kind: "joined" },
    });
    expect(undo(response("rejected", "requested"), "open", started)).toMatchObject({
      value: { kind: "requested" },
    });
  });

  it("refuses anything that is not rejected or removed", () => {
    expect(undo(response("joined"), "open")).toEqual({
      ok: false,
      error: "not_rejected_or_removed",
    });
  });
});

describe("requestsAcceptedBySwitch (spec 3.4)", () => {
  const responses = [response("requested"), response("rejected", "requested"), response("joined")];

  it("are the pending requests when approval mode becomes open", () => {
    expect(requestsAcceptedBySwitch("approval", "open", responses).map((r) => r.kind)).toEqual([
      "requested",
    ]);
  });

  it("are none for any other change", () => {
    expect(requestsAcceptedBySwitch("open", "approval", responses)).toEqual([]);
    expect(requestsAcceptedBySwitch("approval", "approval", responses)).toEqual([]);
  });
});
