import type { NtfyClient, NtfyMessage } from "../../src/adapters/out/ntfy/client.ts";
import type { SendResult } from "../../src/application/ports.ts";

/** Keeps what it was asked to post and answers with a configurable result. */
export class FakeNtfyClient implements NtfyClient {
  readonly published: NtfyMessage[] = [];
  result: SendResult = "sent";

  publish(message: NtfyMessage) {
    this.published.push(message);
    return Promise.resolve(this.result);
  }
}
