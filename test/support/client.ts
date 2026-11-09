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

  /** A URL-encoded form post; URLSearchParams for fields with several values. */
  postForm(path: string, fields: Record<string, string> | URLSearchParams): Promise<Response> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  /** A multipart form post with files, like a browser form with enctype="multipart/form-data". */
  postMultipart(
    path: string,
    fields: Record<string, string>,
    files: Record<string, { name: string; content: string | Uint8Array }>,
  ): Promise<Response> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const [name, file] of Object.entries(files)) {
      const bytes =
        typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
      form.append(
        name,
        new Blob([new Uint8Array(bytes)], { type: "application/gpx+xml" }),
        file.name,
      );
    }
    return this.request(path, { method: "POST", body: form });
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
