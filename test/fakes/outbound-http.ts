import type { OutboundHttp, OutboundResponse } from "../../src/application/ports.ts";

type Answer =
  | { kind: "response"; status: number; headers: Record<string, string>; body: Uint8Array }
  | { kind: "error"; error: Error };

/** Answers configured URL prefixes (longest match wins) and refuses everything else, so tests never reach the network. */
export class FakeOutboundHttp implements OutboundHttp {
  readonly requests: URL[] = [];
  /** POSTs with their headers and bodies, for asserting what was sent. */
  readonly posts: { url: URL; headers: Readonly<Record<string, string>>; body: Uint8Array }[] = [];
  readonly #answers = new Map<string, Answer>();

  respond(
    urlPrefix: string,
    {
      status = 200,
      headers = {},
      body = "",
    }: { status?: number; headers?: Record<string, string>; body?: string | Uint8Array },
  ): this {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.#answers.set(urlPrefix, { kind: "response", status, headers, body: bytes });
    return this;
  }

  fail(urlPrefix: string, error: Error): this {
    this.#answers.set(urlPrefix, { kind: "error", error });
    return this;
  }

  post(
    url: URL,
    { headers = {}, body }: { headers?: Readonly<Record<string, string>>; body: Uint8Array },
  ): Promise<OutboundResponse> {
    this.posts.push({ url, headers, body });
    return this.get(url);
  }

  get(url: URL): Promise<OutboundResponse> {
    this.requests.push(url);
    const prefix = [...this.#answers.keys()]
      .filter((candidate) => url.href.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0];
    const answer = prefix === undefined ? undefined : this.#answers.get(prefix);
    if (answer === undefined)
      return Promise.reject(new Error(`FakeOutboundHttp: no fake response for ${url.href}`));
    if (answer.kind === "error") return Promise.reject(answer.error);
    return Promise.resolve({
      status: answer.status,
      url,
      headers: answer.headers,
      body: answer.body,
    });
  }
}
