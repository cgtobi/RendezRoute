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
 * buttons and `.button` links that are neither secondary nor danger (decision D27).
 */
export function primaries(html: string, from = "<main", to = "</main>"): string[] {
  const part = html.slice(html.indexOf(from), html.indexOf(to));
  return [...part.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, tag, attributes = ""]) => {
      const classes = /class="([^"]*)"/.exec(attributes)?.[1]?.split(" ") ?? [];
      const isButton = tag === "button" || classes.includes("button");
      return isButton && !classes.includes("secondary") && !classes.includes("danger");
    })
    .map(([, , , content = ""]) => content.replace(/<[^>]*>/g, "").trim());
}
