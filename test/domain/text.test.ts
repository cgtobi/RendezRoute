import { describe, expect, it } from "vite-plus/test";
import { cleanText, countUrls } from "../../src/domain/text.ts";

describe("countUrls (decision D95)", () => {
  it("counts an address once, however it is embedded, and also after other characters", () => {
    expect(countUrls("_https://a.example")).toBe(1);
    expect(countUrls("0https://a.example")).toBe(1);
    expect(countUrls("xhttps://a.example")).toBe(1);
    expect(countUrls("https://web.archive.org/web/1/https://a.example/x")).toBe(1);
    expect(countUrls("https://x.www.example.org/p")).toBe(1);
    expect(countUrls("alice@www.host.example")).toBe(1);
  });

  it("counts addresses with a scheme, www or mailto", () => {
    expect(countUrls("no links here, only 3.5 km")).toBe(0);
    expect(countUrls("see https://example.org/a and http://b.example")).toBe(2);
    expect(countUrls("WWW.example.org, ftp://host/x, mailto:me@example.org")).toBe(3);
  });
});

describe("cleanText: URL rules and bidi characters (decision D95)", () => {
  it("refuses any address where none is allowed", () => {
    expect(cleanText("Run https://example.org", { max: 80, urls: "none" })).toEqual({
      ok: false,
      error: "urls_not_allowed",
    });
    expect(cleanText("Run", { max: 80, urls: "none" })).toEqual({ ok: true, value: "Run" });
  });

  it("allows up to the maximum and refuses more", () => {
    const three = "https://a.example https://b.example https://c.example";
    expect(cleanText(three, { max: 200, multiline: true, urls: { max: 3 } }).ok).toBe(true);
    expect(cleanText(`${three} https://d.example`, { max: 200, urls: { max: 3 } })).toEqual({
      ok: false,
      error: "too_many_urls",
    });
  });

  it("does not look for addresses unless asked to", () => {
    expect(cleanText("https://example.org", { max: 80 }).ok).toBe(true);
  });

  it("refuses embeddings, overrides and isolates, but keeps direction marks", () => {
    for (const character of ["\u202A", "\u202E", "\u2066", "\u2069"]) {
      expect(cleanText(`ab${character}cd`, { max: 80 })).toEqual({
        ok: false,
        error: "invalid_characters",
      });
    }
    expect(cleanText("שלום\u200F", { max: 80 }).ok).toBe(true);
  });
});
