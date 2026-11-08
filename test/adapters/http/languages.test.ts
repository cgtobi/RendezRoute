import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const de = translator("de");
const fr = translator("fr");

/** A client whose browser sends the given Accept-Language header. */
class BrowserClient extends TestClient {
  constructor(
    app: ConstructorParameters<typeof TestClient>[0],
    private readonly acceptLanguage: string,
  ) {
    super(app);
  }

  override request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept-language", this.acceptLanguage);
    return super.request(path, { ...init, headers });
  }
}

async function setup(acceptLanguage = "de-DE,de;q=0.9,en;q=0.8") {
  const test = await createTestApp();
  return { ...test, client: new BrowserClient(test.app, acceptLanguage) };
}

/** Text as hono/jsx escapes it in HTML. */
const html = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function switchLanguage(client: TestClient, language: string, returnTo = "/new") {
  const hidden = await client.hiddenFields(returnTo);
  return client.postForm("/language", { ...hidden, language, returnTo });
}

describe("page language (decision D15)", () => {
  it("follows the browser's languages", async () => {
    const { client } = await setup();
    const response = await client.get("/");
    const page = await response.text();
    expect(page).toContain('<html lang="de">');
    expect(page).toContain(html(de("home.cta")));
    expect(response.headers.get("content-language")).toBe("de");
    expect(response.headers.get("vary")).toMatch(/Accept-Language/i);
    expect(response.headers.get("vary")).toMatch(/Cookie/i);
  });

  it("falls back to English for other languages", async () => {
    const { client } = await setup("it-IT,it;q=0.9");
    expect(await (await client.get("/")).text()).toContain('<html lang="en">');
  });

  it("formats dates and numbers for the language", async () => {
    const { client, app } = await setup();
    const { planId } = await createPlanViaUi(client);
    const page = await (await client.get(`/p/${planId}`)).text();
    expect(page).toContain("Sonntag, 7. Juni 2026");
    expect(page).toContain("12,5");

    const french = new BrowserClient(app, "fr");
    const frenchPage = await (await french.get(`/p/${planId}`)).text();
    expect(frenchPage).toContain("dimanche 7 juin 2026");
  });

  it("shows decimals in the host's edit form the language's way", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client, { distanceKm: "12,5" });
    const page = await (await client.get(`/p/${planId}/host`)).text();
    expect(page).toContain('name="distanceKm" value="12,5"');
  });

  it("translates plain-text errors", async () => {
    const { client } = await setup("fr");
    const response = await client.postForm("/new", {});
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(fr("error.csrf"));
    expect(response.headers.get("content-language")).toBe("fr");
  });

  it("translates the map controls", async () => {
    const { client } = await setup();
    const page = await (await client.get("/new")).text();
    expect(page).toContain(`data-zoom-in="${html(de("map.zoomIn"))}"`);
    expect(page).toContain(`data-zoom-out="${html(de("map.zoomOut"))}"`);
  });
});

describe("language switcher (decision D15)", () => {
  it("is a form in the footer that works without JavaScript", async () => {
    const { client } = await setup();
    const page = await (await client.get("/new")).text();
    const form = /<form[^>]*action="\/language"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('name="_csrf"');
    expect(form).toContain('name="returnTo" value="/new"');
    expect(form).toContain('<option value="en" lang="en">English</option>');
    expect(form).toContain('<option value="de" lang="de" selected="">Deutsch</option>');
    expect(form).toContain('<option value="fr" lang="fr">Français</option>');
  });

  it("is left out of pages answering a form post, which cannot be loaded again", async () => {
    const { client } = await setup();
    const { html: linksPage } = await createPlanViaUi(client);
    expect(linksPage).not.toContain('action="/language"');
  });

  it("stores the choice in its own cookie, which wins over the browser's languages", async () => {
    const { client } = await setup();
    const response = await switchLanguage(client, "fr");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/new");
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("__Host-rr-lang="));
    expect(cookie).toMatch(
      /^__Host-rr-lang=fr; Max-Age=34560000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );

    const page = await (await client.get("/new")).text();
    expect(page).toContain('<html lang="fr">');
    expect(page).toContain(html(fr("form.heading")));
  });

  it("returns only to paths on this site", async () => {
    for (const returnTo of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "x"]) {
      const { client } = await setup();
      const hidden = await client.hiddenFields("/new");
      const response = await client.postForm("/language", { ...hidden, language: "fr", returnTo });
      expect({ returnTo, location: response.headers.get("location") }).toEqual({
        returnTo,
        location: "/",
      });
    }
  });

  it("rejects unsupported languages and requests without the CSRF token", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    const unsupported = await client.postForm("/language", { ...hidden, language: "it" });
    expect(unsupported.status).toBe(400);
    expect(unsupported.headers.getSetCookie().join()).not.toContain("rr-lang");

    const forged = await client.postForm("/language", { language: "fr", returnTo: "/" });
    expect(forged.status).toBe(403);
  });
});

describe("stored languages (decisions P7, D15)", () => {
  it("are the languages the host and responders saw", async () => {
    const { client, database, app } = await setup();
    await switchLanguage(client, "fr");
    const { planId } = await createPlanViaUi(client);
    await respondViaUi(new BrowserClient(app, "de"), planId, "Ben", "joined");

    expect(database.sqlite.prepare("select poster_language from plans").get()).toEqual({
      poster_language: "fr",
    });
    expect(database.sqlite.prepare("select language from responses").get()).toEqual({
      language: "de",
    });
  });
});

describe("link previews (decision I30)", () => {
  it("speak the plan's language, whoever asks", async () => {
    const { client, app } = await setup();
    const { planId } = await createPlanViaUi(client);
    const page = await (await new BrowserClient(app, "fr").get(`/p/${planId}`)).text();
    expect(page).toContain('<meta property="og:locale" content="de_DE"/>');
    expect(page).toContain(html(de("activity.run")));
  });
});

describe("private links and the footer forms (review fix: tokens stay out of redirects)", () => {
  it("never put a secret link into the return address", async () => {
    const { client, app } = await setup();
    const { hostPath } = await createPlanViaUi(client);
    const stranger = new TestClient(app);
    const page = await (await stranger.get(hostPath)).text();
    const returnTo = [...page.matchAll(/name="returnTo" value="([^"]*)"/g)].map((m) => m[1]);
    expect(returnTo.length).toBeGreaterThan(0);
    expect(returnTo.every((value) => value === "/")).toBe(true);
  });

  it("refuse to redirect to a secret link even when asked", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    for (const returnTo of ["/a/abc", "/m/abc"]) {
      const response = await client.postForm("/language", { ...hidden, language: "fr", returnTo });
      expect(response.headers.get("location")).toBe("/");
    }
  });

  it("answer a malformed form with 400, not a server error", async () => {
    const { client } = await setup();
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const response = await client.request("/language", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "x-csrf-token": csrf },
      body: "--y\r\nbroken",
    });
    expect(response.status).toBe(400);
  });
});
