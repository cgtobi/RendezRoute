/** A minimal browser: keeps cookies, submits forms with their CSRF token and nonce. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: {
      request(path: string, init?: RequestInit): Response | Promise<Response>;
    },
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const response = await this.app.request(path, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }

  get(path: string): Promise<Response> {
    return this.request(path);
  }

  postForm(path: string, fields: Record<string, string>): Promise<Response> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  /** GETs a page and returns the values of its hidden form fields (e.g. _csrf, nonce). */
  async hiddenFields(path: string): Promise<Record<string, string>> {
    const html = await (await this.get(path)).text();
    return hiddenFields(html);
  }
}

export function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(match[0])?.[1];
    const value = /value="([^"]*)"/.exec(match[0])?.[1];
    if (name !== undefined && value !== undefined) fields[name] = value;
  }
  return fields;
}
