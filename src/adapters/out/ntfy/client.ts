// Publishing to the instance's ntfy server (decision D33): one JSON POST per message to NTFY_URL,
// with NTFY_TOKEN when the server needs one. The server is trusted configuration, like the OIDC
// issuer, and may be on the local network. Only status codes decide the outcome.
import type { SendResult } from "../../../application/ports.ts";
import type { TrustedFetch } from "../http/trusted-fetch.ts";

/** A button under the message; "view" opens the URL (ntfy "actions"). */
export interface NtfyAction {
  action: "view";
  label: string;
  url: string;
  /** Removes the message once tapped. */
  clear?: boolean;
}

export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  /** Opened when the message is tapped. */
  click?: string | undefined;
  actions?: NtfyAction[] | undefined;
}

export interface NtfyClient {
  publish(message: NtfyMessage): Promise<SendResult>;
}

export function createNtfyClient({
  server,
  token,
  fetch,
}: {
  server: URL;
  token: string | undefined;
  fetch: TrustedFetch;
}): NtfyClient {
  return {
    async publish(message) {
      let response: Response;
      try {
        response = await fetch(server.href, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify(message),
        });
      } catch {
        return "retry";
      }
      if (response.ok) return "sent";
      // A full server or one that is down may take it later; any other refusal will not change.
      return response.status === 429 || response.status >= 500 ? "retry" : "failed";
    },
  };
}
