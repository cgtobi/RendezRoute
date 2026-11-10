import { describe, expect, it } from "vite-plus/test";
import { type CardNode, cardElement } from "../../../../src/adapters/out/preview/card.ts";
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
      // The primary colour's tint behind the title (decision D30).
      "#E6EBFF",
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

  // Like the plan page (decisions D29, D30): a light card, the title in a block tinted in the
  // plan's primary colour, time and place as boxes with icons, the measures in one line, and the
  // site's mark with its name.
  it("looks like the plan page", () => {
    const card = cardElement({
      text: previewText(preview),
      colors: preview.colors,
      instanceName: "Isar Runners",
      map,
    });
    const nodes: CardNode[] = [];
    const walk = (child: unknown) => {
      if (Array.isArray(child)) return child.forEach(walk);
      if (typeof child !== "object" || child === null) return;
      const element = child as CardNode;
      nodes.push(element);
      walk(element.props.children);
    };
    walk(card);
    const texts = (element: CardNode): string => {
      const { children } = element.props;
      const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
      return list.map((c) => (typeof c === "string" ? c : texts(c))).join("");
    };
    const boxes = nodes.filter((n) => n.props.style?.backgroundColor === "#f3f4f6");
    /** The SVG icons inside `element`, each as the colour its outline or shape is drawn in. */
    const icons = (element: CardNode) =>
      nodes
        .filter(
          (n) =>
            n.type === "img" &&
            n.props.src?.startsWith("data:image/svg+xml;base64,") === true &&
            JSON.stringify(element).includes(JSON.stringify(n)),
        )
        .map((n) => {
          const svg = Buffer.from(n.props.src?.split(",")[1] ?? "", "base64").toString();
          const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
          const drawn = /\s(stroke|fill)="(#[0-9a-f]{6})"/.exec(root.replace(/fill="none"/, ""));
          // Black only where the file had it: every icon is drawn in its colour.
          return svg.includes('"#000"') ? "black" : `${drawn?.[1]} ${drawn?.[2]}`;
        });
    const text = previewText(preview);
    expect({
      background: card.props.style?.backgroundColor,
      ink: card.props.style?.color,
      header: nodes.some(
        (n) =>
          n.props.style?.backgroundColor === "#E6EBFF" &&
          Number(n.props.style.borderRadius) > 0 &&
          texts(n).includes(text.title),
      ),
      boxes: boxes.map((box) => ({ text: texts(box), icons: icons(box) })),
      measures: nodes.some(
        (n) =>
          typeof n.props.children === "string" && n.props.children === text.details.join(" · "),
      ),
      mark: nodes.some(
        (n) =>
          n.props.style?.display === "flex" &&
          texts(n) === "Isar Runners" &&
          icons(n).join() === "fill #2c67a8",
      ),
    }).toEqual({
      background: "#FFFFFF",
      ink: "#16181d",
      header: true,
      boxes: [
        { text: text.when, icons: ["stroke #5c636e"] },
        { text: text.area, icons: ["stroke #5c636e"] },
      ],
      measures: true,
      mark: true,
    });
  });
});
