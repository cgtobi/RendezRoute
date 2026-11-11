// ntfy topics (decision D33): random and unguessable, on the instance's server, so nobody picks or
// guesses one. People subscribe to the topic's address in the ntfy app.

/** The topic's address on the server, which the ntfy app and its web app open. */
export const topicUrl = (server: URL, topic: string): string =>
  new URL(encodeURIComponent(topic), server.href.endsWith("/") ? server : `${server.href}/`).href;

/** ntfy's own limit for topic names; the app's are 43 base64url characters. */
export const isNtfyTopic = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
