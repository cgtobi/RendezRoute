import { describe, expect, it } from "vite-plus/test";
import { Linkified } from "../../../src/adapters/in/http/views/linkify.tsx";

/** Rendered HTML. Hono's JSX nodes implement toString at runtime; their type does not say so. */
const render = async (text: string): Promise<string> =>
  // oxlint-disable-next-line typescript/no-base-to-string
  (<Linkified text={text} />).toString();
const link = (url: string) => `<a href="${url}" rel="noopener noreferrer nofollow ugc">${url}</a>`;

describe("Linkified (spec 3.8 Output)", () => {
  it("links http(s) URLs and drops trailing sentence punctuation", async () => {
    expect(await render("See https://example.org/route.")).toBe(
      `See ${link("https://example.org/route")}.`,
    );
  });

  it("keeps balanced parentheses and drops an unbalanced closing one", async () => {
    expect(await render("https://en.wikipedia.org/wiki/Mercury_(planet)")).toBe(
      link("https://en.wikipedia.org/wiki/Mercury_(planet)"),
    );
    expect(await render("(map: https://example.org/a)")).toBe(
      `(map: ${link("https://example.org/a")})`,
    );
  });

  it("does not link URLs without a host or with other schemes", async () => {
    expect(await render("https:// and javascript:alert(1) and ftp://x.org")).toBe(
      "https:// and javascript:alert(1) and ftp://x.org",
    );
  });

  it("escapes everything else", async () => {
    expect(await render("<b>bold</b> & https://example.org/?a=1&b=2")).toBe(
      `&lt;b&gt;bold&lt;/b&gt; &amp; <a href="https://example.org/?a=1&amp;b=2" rel="noopener noreferrer nofollow ugc">https://example.org/?a=1&amp;b=2</a>`,
    );
  });
});
