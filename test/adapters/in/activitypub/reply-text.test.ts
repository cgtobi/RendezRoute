// A remote reply's HTML as a recap contribution's plain text and link (decisions D44, D45): all
// tags go, entities are decoded, line breaks from <br> and <p> stay, the first web link of the
// content (not a mention or hashtag) or else of a Link attachment becomes the link field, and the
// rest stays text. Nothing is truncated here: the contribution's limits reject.
import { describe, expect, it } from "vite-plus/test";
import { replyContent } from "../../../../src/adapters/in/activitypub/reply-text.ts";

describe("a reply's text", () => {
  it("strips tags, keeps a Mastodon mention as text and takes no link from it", () => {
    expect(
      replyContent(
        '<p><span class="h-card"><a href="https://runs.example.org/@runs" class="u-url mention">@<span>runs</span></a></span> Great run!</p>',
        [],
      ),
    ).toEqual({ body: "@runs Great run!", link: undefined });
  });

  it("splits the first web link into the link field and drops its repeated text", () => {
    expect(
      replyContent(
        '<p>See <a href="https://photos.example/a?b=1&amp;c=2" rel="nofollow noopener"><span class="invisible">https://</span><span class="ellipsis">photos.example/a?b=1&amp;c=2</span><span class="invisible"></span></a> now</p>',
        [],
      ),
    ).toEqual({ body: "See now", link: "https://photos.example/a?b=1&c=2" });
  });

  it("keeps a link's label as text, and leaves the second link as text only", () => {
    expect(
      replyContent(
        '<p><a href="https://one.example/x">our photos</a> and <a href="https://two.example/y">theirs</a></p>',
        [],
      ),
    ).toEqual({ body: "our photos and theirs", link: "https://one.example/x" });
  });

  it("ignores hashtags and links that are not http or https", () => {
    expect(
      replyContent(
        '<p>#<a href="https://runs.example/tags/run" class="mention hashtag" rel="tag">run</a> <a href="javascript:alert(1)">bad</a> <a href="ftp://f.example/x">ftp</a> <a href="mailto:a@b.example">mail</a> <a href="https://ok.example/z">ok</a></p>',
        [],
      ),
    ).toEqual({ body: "#run bad ftp mail ok", link: "https://ok.example/z" });
  });

  it("takes a Link attachment when the content has no link", () => {
    expect(
      replyContent("<p>Photos attached</p>", ["ftp://no.example/x", "https://yes.example/y"]),
    ).toEqual({ body: "Photos attached", link: "https://yes.example/y" });
    expect(
      replyContent('<p><a href="https://body.example/b">here</a></p>', ["https://att.example/a"]),
    ).toEqual({ body: "here", link: "https://body.example/b" });
  });

  it("keeps line breaks from <br> and paragraphs, and collapses other whitespace", () => {
    expect(replyContent("<p>Line  one<br>Line\ttwo</p>\n<p>Para   two</p>", [])).toEqual({
      body: "Line one\nLine two\n\nPara two",
      link: undefined,
    });
    expect(replyContent("<p>a</p><p></p><p></p><p>b</p>", [])?.body).toBe("a\n\nb");
  });

  it("decodes entities once, and a decoded tag stays text", () => {
    expect(
      replyContent(
        "<p>R&amp;D &lt;b&gt;bold&lt;/b&gt; &#65;&#x42; &quot;q&quot; &apos;a&apos; x&nbsp;y &amp;lt;</p>",
        [],
      )?.body,
    ).toBe("R&D <b>bold</b> AB \"q\" 'a' x y &lt;");
  });

  it("removes scripts' and styles' markup and control characters, keeping their text out", () => {
    expect(
      replyContent("<p>ok<script>alert(1)</script><style>p{}</style></p>\u0007\u202E", [])?.body,
    ).toBe("ok\u202E".replace("\u202E", ""));
  });

  it("is plain text already: unchanged", () => {
    expect(replyContent("Just words", [])).toEqual({ body: "Just words", link: undefined });
  });

  it("gives up on content that is absurdly long, rather than working through it", () => {
    expect(replyContent(`<p>${"a".repeat(200_000)}</p>`, [])).toBeUndefined();
    expect(replyContent(`<p>${"a".repeat(19_990)}</p>`, [])?.body).toHaveLength(19_990);
  });

  it("takes a bare web address in the text as the link and does not repeat it", () => {
    expect(replyContent("Photos at https://photos.example/a?b=1 and more", [])).toEqual({
      body: "Photos at and more",
      link: "https://photos.example/a?b=1",
    });
    expect(
      replyContent("<p>see (http://one.example/x), then https://two.example/y.</p>", []),
    ).toEqual({ body: "see, then https://two.example/y.", link: "http://one.example/x" });
    // Not a web address: stays text; an anchor's link wins over a later bare one.
    expect(replyContent("go to https:// now or ftp://f.example/x", [])).toEqual({
      body: "go to https:// now or ftp://f.example/x",
      link: undefined,
    });
    expect(replyContent('<a href="https://a.example/1">label</a> https://b.example/2', [])).toEqual(
      { body: "label https://b.example/2", link: "https://a.example/1" },
    );
    expect(replyContent("no link here", ["https://att.example/z"])?.link).toBe(
      "https://att.example/z",
    );
  });

  it("keeps a closing bracket in the address only when it has its opener in it", () => {
    const linkOf = (text: string) => replyContent(text, [])?.link;
    expect(linkOf("https://a.example/Foo_(bar)")).toBe("https://a.example/Foo_(bar)");
    expect(linkOf("(see https://a.example/x)")).toBe("https://a.example/x");
    expect(linkOf("https://a.example/x?y=(1)).")).toBe("https://a.example/x?y=(1)");
    expect(linkOf("https://a.example/a]")).toBe("https://a.example/a");
    expect(linkOf("https://a.example/b[1]]!")).toBe("https://a.example/b[1]");
    expect(linkOf("https://a.example/c{x}}")).toBe("https://a.example/c{x}");
    expect(replyContent("(see https://a.example/x)", [])?.body).toBe("(see )");
  });

  it("cleans up only where a bare address was cut out of the text", () => {
    const bodyOf = (text: string) => replyContent(text, [])?.body;
    expect(bodyOf("See (https://a.example/path). Nice!")).toBe("See. Nice!");
    expect(bodyOf("Look: https://a.example")).toBe("Look:");
    expect(bodyOf("a () b https://a.example")).toBe("a () b");
    expect(bodyOf("Map [https://a.example/m] here")).toBe("Map here");
    expect(bodyOf("Pic &lt;https://a.example/p&gt;, nice")).toBe("Pic, nice");
    expect(bodyOf("Hi https://a.example/q; there")).toBe("Hi; there");
    // Brackets of the author's own, away from the cut, stay.
    expect(bodyOf("(x) [] &lt;&gt; https://a.example/z end ()")).toBe("(x) [] <> end ()");
    expect(bodyOf("one  two https://a.example/w   three")).toBe("one two three");
  });

  it("removes characters that reorder text, keeping the rest", () => {
    const bidi = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f\u061c";
    expect(replyContent(`<p>a${bidi}b\u202ec</p>`, [])?.body).toBe("abc");
  });
});

// Remote input reaches this before anything is checked: it must be worked through in linear time.
// The length cap is lifted here so that the scan itself, not the cap, is what is timed.
describe("a reply's text, on hostile input", () => {
  const SIZE = 100_000;
  const noCap = Number.POSITIVE_INFINITY;
  const inputs: Readonly<Record<string, (size: number) => string>> = {
    "many open brackets": (size) => "<".repeat(size),
    "many bracket pairs": (size) => "<>".repeat(size / 2),
    "many unclosed anchors": (size) => "<a ".repeat(size / 3),
    "many unclosed scripts": (size) => "<script>".repeat(size / 8),
    "many unclosed styles": (size) => "<style ".repeat(size / 7),
    "an unclosed href": (size) => '<a href="'.repeat(size / 9),
    "nested anchors": (size) => "<a>".repeat(size / 3),
    "nested anchors with one close": (size) =>
      `${"<a href='https://x.example'>".repeat(size / 28)}</a>`,
    "anchors that are never mentions": (size) => '<a class="x" rel="y">z'.repeat(size / 22),
    "attribute floods": (size) => `<a ${'class="'.repeat(size / 7)}>x</a>`,
    "entity floods": (size) => "&".repeat(size),
    "numeric entity floods": (size) => "&#x".repeat(size / 3),
    "space runs before a bare address": (size) =>
      `<p>${" ".repeat(size - 40)}x https://a.example/p.</p>`,
    "tab runs before a bare address": (size) =>
      `<p>${"\t".repeat(size - 40)}x https://a.example/p.</p>`,
    "no-break space runs before a bare address": (size) =>
      `<p>${"\u00a0".repeat(size - 40)}x https://a.example/p.</p>`,
    "bare address floods": (size) => "http://".repeat(size / 7),
    "script then stray closes": (size) => `<script>${"</a>".repeat(size / 4)}`,
  };
  // One sample is at the mercy of the machine: a descheduled slice or a GC pause inside a single
  // run, under load, looks like slowness. A stall hits single runs, so each input gets one untimed
  // warm-up and is then timed three times, keeping the minimum; a function that really is
  // quadratic is slow on every repeat, so its minimum stays high.
  const REPEATS = 3;
  const timedOnce = (html: string): number => {
    const started = performance.now();
    replyContent(html, [], noCap);
    return performance.now() - started;
  };
  const timed = (html: string): number => {
    timedOnce(html);
    return Math.min(...Array.from({ length: REPEATS }, () => timedOnce(html)));
  };

  it("takes well under a second for each adversarial input of 100,000 characters", () => {
    const times = Object.entries(inputs).map(([name, make]) => ({
      name,
      ms: timed(make(SIZE)),
    }));
    expect(times.filter(({ ms }) => ms > 250)).toEqual([]);
  });

  // Five times the input should take about five times as long; 15 leaves room for noise and 25
  // is where a quadratic function lands. The small time is floored at 5 ms so that sub-millisecond
  // noise cannot make a huge ratio, and the absolute bound keeps a real blow-up caught.
  it("grows no faster than linearly: five times the input is not twenty-five times the time", () => {
    const ratios = Object.entries(inputs).map(([name, make]) => {
      const small = Math.max(timed(make(SIZE / 5)), 5);
      const large = timed(make(SIZE));
      return { name, quadratic: large / small > 15 && large > 250 };
    });
    expect(ratios.filter(({ quadratic }) => quadratic)).toEqual([]);
  });

  it("rejects input beyond the cap at once", () => {
    const started = performance.now();
    expect(replyContent("<".repeat(SIZE), [])).toBeUndefined();
    // An early reject: any real work would take far longer; the bound leaves room for a stall.
    expect(performance.now() - started).toBeLessThan(250);
  });
});
