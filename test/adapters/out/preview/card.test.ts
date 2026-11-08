import { describe, expect, it } from "vite-plus/test";
import { cardElement } from "../../../../src/adapters/out/preview/card.ts";
import { previewText } from "../../../../src/adapters/in/http/views/preview-text.ts";
import { previewOf } from "../../../../src/application/plan-views.ts";
import { samplePlan } from "../../../fixtures/plans.ts";

const preview = previewOf(samplePlan({}, { exactDescription: "SENTINEL" }));
const map = {
  tiles: [{ src: "data:image/png;base64,AAAA", left: -10, top: -20 }],
  circle: { x: 260, y: 315, radius: 118 },
  attribution: "© OpenStreetMap contributors",
};

describe("preview card layout", () => {
  it("shows title, time, area, distance, pace and the instance name in the plan colors", () => {
    const tree = JSON.stringify(
      cardElement({
        text: previewText(preview),
        colors: preview.colors,
        instanceName: "Isar Runners",
      }),
    );
    for (const expected of [
      "Easy Sunday run",
      "07:30",
      "Englischer Garten, north end",
      "12.5 km",
      "5:30",
      "6:00",
      "Isar Runners",
      "#2E5BFF",
    ]) {
      expect(tree).toContain(expected);
    }
    expect(tree).not.toContain("SENTINEL");
    expect(tree).not.toContain("OpenStreetMap");
  });

  it("adds the map with its attribution when there is one", () => {
    const tree = JSON.stringify(
      cardElement({
        text: previewText(preview),
        colors: preview.colors,
        instanceName: "Isar Runners",
        map,
      }),
    );
    expect(tree).toContain("data:image/png;base64,AAAA");
    expect(tree).toContain("© OpenStreetMap contributors");
  });
});
