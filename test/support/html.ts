/** Text as it appears in rendered HTML (Hono's JSX escaping). */
export function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The page's main (primary) buttons and button links between `from` and `to`, each as its text:
 * buttons and `.button` links that are neither secondary nor danger (decision D27). An icon
 * button on a field's line (`line-action-button`, D75) is not a main action either; nor is the quiet icon button in a status line (`icon-button`, D76).
 */
export function primaries(html: string, from = "<main", to = "</main>"): string[] {
  const part = html.slice(html.indexOf(from), html.indexOf(to));
  return [...part.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, tag, attributes = ""]) => {
      const classes = /class="([^"]*)"/.exec(attributes)?.[1]?.split(" ") ?? [];
      const isButton = tag === "button" || classes.includes("button");
      return (
        isButton &&
        !classes.includes("secondary") &&
        !classes.includes("danger") &&
        !classes.includes("line-action-button") &&
        !classes.includes("icon-button")
      );
    })
    .map(([, , , content = ""]) => content.replace(/<[^>]*>/g, "").trim());
}

const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);

/**
 * What stands outside the page's parts: h2s that start no section, and anything after the first
 * part that is not itself a part (a direct child of the `.sectioned` page that is not a section).
 */
export function unsectioned(html: string): string[] {
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const lone = [...main.matchAll(/(<section\b[^>]*>)?<h2\b[^>]*>([\s\S]*?)<\/h2>/g)]
    .filter(([, section]) => section === undefined)
    .map(([, , heading = ""]) => `h2: ${heading.replace(/<[^>]*>/g, "")}`);
  const root = main.search(/<section class="[^"]*\bsectioned\b/);
  if (root === -1) return [...lone, "the page is not in parts (.sectioned)"];
  const stack: string[] = [];
  let parts = false;
  const loose: string[] = [];
  for (const [tag = "", closing, name = ""] of main.slice(root).matchAll(/<(\/?)(\w+)\b[^>]*>/g)) {
    if (VOID.has(name)) continue;
    if (closing === "/") {
      stack.pop();
      if (stack.length === 0) break;
      continue;
    }
    if (stack.length === 1) {
      if (name === "section") parts = true;
      else if (parts) loose.push(tag);
    }
    stack.push(name);
  }
  return [...lone, ...loose];
}
