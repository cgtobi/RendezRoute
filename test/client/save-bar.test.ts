import { describe, expect, it } from "vite-plus/test";
import { isDirty, isTracked, loadedKey, stateKey } from "../../src/client/save-bar-rule.ts";

describe("isTracked (decision 006)", () => {
  it("tracks named fields, including the hidden ones the map picker writes", () => {
    expect(isTracked({ type: "text", name: "title" })).toBe(true);
    expect(isTracked({ type: "hidden", name: "exactLat" })).toBe(true);
    expect(isTracked({ type: "select-one", name: "timeZone" })).toBe(true);
    expect(isTracked({ type: "radio", name: "joinMode" })).toBe(true);
  });

  it("tracks the route file and its trim choice (ADR 007)", () => {
    expect(isTracked({ type: "file", name: "gpx" })).toBe(true);
    expect(isTracked({ type: "select-one", name: "gpxTrim" })).toBe(true);
  });

  it("leaves out buttons and unnamed controls", () => {
    expect(isTracked({ type: "submit", name: "" })).toBe(false);
    expect(isTracked({ type: "button", name: "x" })).toBe(false);
    expect(isTracked({ type: "reset", name: "x" })).toBe(false);
    expect(isTracked({ type: "image", name: "x" })).toBe(false);
    expect(isTracked({ type: "search", name: "" })).toBe(false);
  });

  it("leaves out the map's mode switch: not a saved field, and the full-screen map mirrors it (ADR 008)", () => {
    expect(isTracked({ type: "radio", name: "mapMode" })).toBe(false);
    // Only that name: other radios still count.
    expect(isTracked({ type: "radio", name: "mapModeX" })).toBe(true);
  });
});

describe("stateKey", () => {
  it("is the value, or whether a checkbox or radio is checked", () => {
    expect(stateKey({ type: "text", value: "Run", checked: false })).toBe("Run");
    expect(stateKey({ type: "checkbox", value: "1", checked: true })).toBe("1");
    expect(stateKey({ type: "checkbox", value: "1", checked: false })).toBe("0");
    expect(stateKey({ type: "radio", value: "open", checked: false })).toBe("0");
  });

  it("is a file input's value: empty, or the browser's path of the chosen file", () => {
    expect(stateKey({ type: "file", value: "", checked: false })).toBe("");
    expect(stateKey({ type: "file", value: "C:\\fakepath\\run.gpx", checked: false })).toBe(
      "C:\\fakepath\\run.gpx",
    );
  });
});

describe("loadedKey (ADR 007)", () => {
  it("is the same as stateKey for every control but a file", () => {
    for (const control of [
      { type: "text", value: "Run", checked: false },
      { type: "select-one", value: "500", checked: false },
      { type: "checkbox", value: "1", checked: true },
      { type: "radio", value: "open", checked: false },
    ]) {
      expect(loadedKey(control)).toBe(stateKey(control));
    }
  });

  it("counts a file as empty, so a file the browser kept is a change", () => {
    const restored = { type: "file", value: "C:\\fakepath\\run.gpx", checked: false };
    expect(loadedKey(restored)).toBe("");
    expect(isDirty([loadedKey(restored)], [stateKey(restored)])).toBe(true);
    const empty = { type: "file", value: "", checked: false };
    expect(isDirty([loadedKey(empty)], [stateKey(empty)])).toBe(false);
  });
});

describe("isDirty", () => {
  it("is clean for the same values and dirty for any difference", () => {
    expect(isDirty(["a", "1"], ["a", "1"])).toBe(false);
    expect(isDirty(["a", "1"], ["a", "0"])).toBe(true);
    expect(isDirty(["a", "1"], ["b", "1"])).toBe(true);
  });

  it("is clean again when a change is undone", () => {
    const snapshot = ["Run"];
    expect(isDirty(snapshot, ["Runs"])).toBe(true);
    expect(isDirty(snapshot, ["Run"])).toBe(false);
  });

  it("counts a different number of controls as a change", () => {
    expect(isDirty(["a"], ["a", "b"])).toBe(true);
  });
});
