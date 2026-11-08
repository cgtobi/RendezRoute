// Service worker (spec 6 feature 3): shows this site's push messages and opens the plan when one
// is tapped. Messages arrive encrypted; the browser decrypts them before this runs.

interface PushMessage {
  title?: string;
  body?: string;
  url?: string;
}

// The DOM library has no service worker types; these are the few parts used here.
interface WaitableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface PushEvent extends WaitableEvent {
  data: { json(): unknown } | null;
}
interface NotificationClickEvent extends WaitableEvent {
  notification: { close(): void; data?: { url?: string } };
}
interface Worker {
  location: Location;
  registration: { showNotification(title: string, options: object): Promise<void> };
  clients: { openWindow(url: string): Promise<unknown> };
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEvent) => void,
  ): void;
}

const worker = self as unknown as Worker;

worker.addEventListener("push", (event) => {
  let message: PushMessage = {};
  try {
    message = (event.data?.json() ?? {}) as PushMessage;
  } catch {
    // Not ours; show nothing beyond the site name.
  }
  event.waitUntil(
    worker.registration.showNotification(message.title ?? worker.location.host, {
      body: message.body ?? "",
      data: { url: message.url },
    }),
  );
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  // Only pages of this site open, whatever a message says.
  if (url !== undefined && sameOrigin(url)) event.waitUntil(worker.clients.openWindow(url));
});

function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === worker.location.origin;
  } catch {
    return false;
  }
}
