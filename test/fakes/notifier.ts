import type { Notifier, SendResult } from "../../src/application/ports.ts";
import type { Notification } from "../../src/domain/notification.ts";

/** Records what it was asked to send and answers with a configurable result. */
export class FakeNotifier implements Notifier {
  readonly sent: { channelId: string; notification: Notification }[] = [];
  result: SendResult | Error = "sent";

  send(channelId: string, notification: Notification) {
    this.sent.push({ channelId, notification });
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}
