import type { Notifier, NotificationTarget, SendResult } from "../../src/application/ports.ts";
import type { Notification } from "../../src/domain/notification.ts";

/** Records what it was asked to send and answers with a configurable result. */
export class FakeNotifier implements Notifier {
  readonly sent: { to: NotificationTarget; notification: Notification }[] = [];
  result: SendResult | Error = "sent";

  send(to: NotificationTarget, notification: Notification) {
    this.sent.push({ to, notification });
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}
