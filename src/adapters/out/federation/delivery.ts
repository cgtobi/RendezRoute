// Delivering a queued activity (spec 7 ActivityPub, 3.11; decisions D36, D38): signed with the
// local actor's RSA key (HTTP Signatures as Mastodon checks them), looked up now unless the job
// carries the key of a retired actor, and posted through OutboundHttp, with its SSRF rules. A
// server that is down or busy is tried again; one that refuses is not; an actor without keys
// has nothing to send.
import { importJwk, signRequest } from "@fedify/fedify";
import type { JobOutcome } from "../../../application/jobs.ts";
import type { OutboundHttp } from "../../../application/ports.ts";
import type { ActorSigningKeys, DeliveryPayload } from "./publisher.ts";

/**
 * Inboxes answer briefly, but a longer answer is still a delivery: refusing it would make the job
 * runner send the activity again.
 */
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

export function federationDeliveryHandler(
  http: OutboundHttp,
  keysFor: ActorSigningKeys,
): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    const delivery = asDelivery(payload);
    if (delivery === undefined) return "drop";
    const privateKey =
      delivery.privateKey === undefined
        ? (await keysFor(delivery.localActor))?.[0]?.privateKey
        : await importJwk(delivery.privateKey, "private");
    if (privateKey === undefined) return "drop";
    const body = new TextEncoder().encode(delivery.body);
    const signed = await signRequest(
      new Request(delivery.inbox, {
        method: "POST",
        headers: { "content-type": "application/activity+json" },
        body,
      }),
      privateKey,
      new URL(delivery.keyId),
      { body: body.buffer },
    );
    const response = await http.post(new URL(delivery.inbox), {
      headers: Object.fromEntries(signed.headers),
      body,
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
    });
    if (response.status >= 200 && response.status < 300) return "done";
    return response.status === 408 || response.status === 429 || response.status >= 500
      ? "retry"
      : "drop";
  };
}

function asDelivery(payload: unknown): DeliveryPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { localActor, inbox, body, keyId, privateKey } = payload as Partial<DeliveryPayload>;
  if (
    typeof localActor !== "string" ||
    typeof body !== "string" ||
    !URL.canParse(inbox ?? "") ||
    !URL.canParse(keyId ?? "") ||
    (privateKey !== undefined && (typeof privateKey !== "object" || privateKey === null))
  ) {
    return undefined;
  }
  return { localActor, inbox: inbox ?? "", body, keyId: keyId ?? "", privateKey };
}
