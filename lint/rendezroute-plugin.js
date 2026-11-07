// Project-specific lint rules. Guarded by test/lint/lint-rules.test.ts, which
// runs the real linter so a toolchain update cannot silently disable them.
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

/** Spec 3.8: no style attributes, inline <style> or inline <script> in templates. */
const noInlineStyleScript = defineRule({
  meta: {
    messages: {
      styleAttribute:
        "No `style` attributes: the CSP forbids inline styles (spec 3.8). Use a bundled stylesheet.",
      styleElement:
        "No <style> elements: the CSP forbids inline styles (spec 3.8). Use a bundled stylesheet.",
      inlineScript:
        "No inline <script>: the CSP forbids inline scripts (spec 3.8). Use <script src> with a bundled file.",
      rawHtml: "No dangerouslySetInnerHTML: all user text must be escaped (spec 3.8).",
    },
  },
  create(context) {
    const attributeName = (attribute) =>
      attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier"
        ? attribute.name.name
        : undefined;

    return {
      JSXAttribute(node) {
        const name = attributeName(node);
        if (name === "style") context.report({ node, messageId: "styleAttribute" });
        if (name === "dangerouslySetInnerHTML") context.report({ node, messageId: "rawHtml" });
      },
      JSXElement(node) {
        const opening = node.openingElement;
        if (opening.name.type !== "JSXIdentifier") return;
        if (opening.name.name === "style")
          context.report({ node: opening, messageId: "styleElement" });
        if (opening.name.name === "script") {
          const hasSrc = opening.attributes.some((attribute) => attributeName(attribute) === "src");
          if (!hasSrc || node.children.length > 0)
            context.report({ node: opening, messageId: "inlineScript" });
        }
      },
    };
  },
});

/** Spec 2b: domain and application code get time and randomness only through ports. */
const noAmbientEffects = defineRule({
  meta: {
    messages: {
      time: "Use the injected Clock port instead of reading the current time (spec 2b).",
      random: "Use the IdGenerator or TokenService port instead of ambient randomness (spec 2a).",
    },
  },
  create(context) {
    const isMember = (node, object, properties) =>
      node.type === "MemberExpression" &&
      node.object.type === "Identifier" &&
      node.object.name === object &&
      node.property.type === "Identifier" &&
      properties.includes(node.property.name);

    return {
      CallExpression(node) {
        if (
          isMember(node.callee, "Date", ["now"]) ||
          isMember(node.callee, "performance", ["now"])
        ) {
          context.report({ node, messageId: "time" });
        }
        if (
          isMember(node.callee, "Math", ["random"]) ||
          isMember(node.callee, "crypto", ["randomUUID", "getRandomValues"])
        ) {
          context.report({ node, messageId: "random" });
        }
      },
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "Date" &&
          node.arguments.length === 0
        ) {
          context.report({ node, messageId: "time" });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "rendezroute" },
  rules: {
    "no-inline-style-script": noInlineStyleScript,
    "no-ambient-effects": noAmbientEffects,
  },
});
