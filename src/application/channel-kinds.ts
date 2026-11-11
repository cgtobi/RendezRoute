// Whether a stored channel can be reached now (decisions D31, D33, D34): browser push always;
// email while SMTP is configured; ntfy while NTFY_URL is, and only on the server the topic was
// made on, since people subscribed there; Telegram while the bot is configured and the chat is
// linked. One place for every caller: sending, reminders, links, warnings.
import type { PlanDeps } from "./plans.ts";
import type { NotificationChannel } from "./ports.ts";

export function canReach(
  notify: PlanDeps["notify"],
  channel: Pick<NotificationChannel, "kind"> & { server?: string; chatId?: string | undefined },
): boolean {
  switch (channel.kind) {
    case "webpush":
      return true;
    case "email":
      return notify?.email?.outbox !== undefined;
    case "ntfy":
      return notify?.ntfy !== undefined && notify.ntfy.server.href === channel.server;
    case "telegram":
      // Only once the person pressed Start and so linked their chat (decision D34).
      return notify?.telegram !== undefined && channel.chatId !== undefined;
  }
}
