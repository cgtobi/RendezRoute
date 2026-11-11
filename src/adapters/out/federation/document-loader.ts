// Fedify's remote fetches through OutboundHttp (spec 3.11: every outbound request goes through it,
// with its SSRF rules, size limit and timeout; decision I61). Remote documents are what servers
// name, such as the key of a server posting to the inbox, so they get no exception. JSON-LD
// contexts that Fedify ships with are answered from its copies; others are fetched the same way.
import { type DocumentLoader, preloadedContexts } from "@fedify/fedify/runtime";
import type { OutboundHttp } from "../../../application/ports.ts";

const ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
/** An actor or key document is a few kilobytes; this leaves room and bounds the rest. */
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;

export function outboundDocumentLoader(http: OutboundHttp): DocumentLoader {
  return async (url) => {
    const response = await http.get(new URL(url), {
      headers: { accept: ACCEPT },
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
    });
    if (response.status !== 200) {
      throw new Error(`Fetching a remote document failed with status ${response.status}.`);
    }
    return {
      contextUrl: null,
      // After redirects, which OutboundHttp checks one by one.
      documentUrl: response.url.href,
      document: JSON.parse(new TextDecoder().decode(response.body)) as unknown,
    };
  };
}

export function outboundContextLoader(http: OutboundHttp): DocumentLoader {
  const fetchDocument = outboundDocumentLoader(http);
  return async (url) => {
    const known = (preloadedContexts as Readonly<Record<string, unknown>>)[url];
    return known === undefined
      ? fetchDocument(url)
      : { contextUrl: null, documentUrl: url, document: known };
  };
}
