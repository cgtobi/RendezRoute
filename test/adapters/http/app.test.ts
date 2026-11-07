import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../../../src/adapters/in/http/app.tsx";
import { type Config, loadConfig } from "../../../src/config.ts";

function config(env: Record<string, string> = {}): Config {
  const result = loadConfig({
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    ...env,
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.config;
}

describe("GET /healthz", () => {
  it("answers 200 for the Docker HEALTHCHECK", async () => {
    const response = await createApp({ config: config() }).request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("page layout", () => {
  it("shows the instance name in title and header (spec section 2)", async () => {
    const response = await createApp({ config: config({ INSTANCE_NAME: "Isar Runners" }) }).request(
      "/",
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<title>Isar Runners</title>");
    expect(html).toMatch(/<header[^>]*>[\s\S]*Isar Runners[\s\S]*<\/header>/);
  });

  it("shows 'Powered by RendezRoute' only when the instance name differs from the default", async () => {
    const custom = await (
      await createApp({ config: config({ INSTANCE_NAME: "Isar Runners" }) }).request("/")
    ).text();
    const standard = await (await createApp({ config: config() }).request("/")).text();
    expect(custom).toContain("Powered by RendezRoute");
    expect(standard).not.toContain("Powered by");
  });

  it("escapes the instance name", async () => {
    const html = await (
      await createApp({ config: config({ INSTANCE_NAME: "<b>Club</b>" }) }).request("/")
    ).text();
    expect(html).not.toContain("<b>Club</b>");
    expect(html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });

  it("shows a development-mode banner on every page when ALLOW_INSECURE_DEV=true (spec section 11)", async () => {
    const dev = config({ BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" });
    const html = await (await createApp({ config: dev }).request("/")).text();
    expect(html).toContain("Development mode");
    expect(await (await createApp({ config: config() }).request("/")).text()).not.toContain(
      "Development mode",
    );
  });

  it("sets the page language from Accept-Language", async () => {
    const response = await createApp({ config: config() }).request("/", {
      headers: { "accept-language": "fr,en;q=0.5" },
    });
    expect(await response.text()).toContain('<html lang="en">');
  });
});
