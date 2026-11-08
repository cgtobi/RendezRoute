// "Notify me about this plan" (spec 6 feature 3, decision D17). Turning it off removes only this
// plan's channel: the browser's push subscription may serve other plans too.

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** Browsers can hang while registering with their push service; give up after this long. */
const SUBSCRIBE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), SUBSCRIBE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function initPush(): void {
  const widgets = document.querySelectorAll<HTMLElement>("[data-push]");
  if (widgets.length === 0) return;
  // Without push support the switch stays hidden; everything else works the same.
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return;
  }
  const registration = navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready);
  for (const widget of widgets) void setUp(widget, registration);
}

async function setUp(
  widget: HTMLElement,
  ready: Promise<ServiceWorkerRegistration>,
): Promise<void> {
  const button = widget.querySelector<HTMLButtonElement>("[data-push-toggle]");
  const status = widget.querySelector<HTMLElement>("[data-status]");
  if (button === null || status === null) return;
  const text = widget.dataset;
  const csrf = document.querySelector<HTMLInputElement>('input[name="_csrf"]')?.value ?? "";
  const post = async (path: string, body: unknown): Promise<{ enabled: boolean }> => {
    const response = await fetch(`${text.endpoint ?? ""}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as { enabled: boolean };
  };

  widget.hidden = false;
  if (Notification.permission === "denied") {
    button.hidden = true;
    status.textContent = text.blocked ?? "";
    return;
  }

  let enabled = false;
  const show = () => {
    button.textContent = (enabled ? text.labelOff : text.labelOn) ?? "";
    status.textContent = enabled ? (text.onText ?? "") : "";
  };

  let registration: ServiceWorkerRegistration;
  try {
    registration = await ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing !== null)
      enabled = (await post("/status", { endpoint: existing.endpoint })).enabled;
  } catch {
    widget.hidden = true;
    return;
  }
  // Rejected and removed people see the switch only while this browser still gets messages.
  const offOnly = text.offOnly !== undefined;
  if (offOnly && !enabled) {
    widget.hidden = true;
    return;
  }
  show();

  button.addEventListener("click", () => {
    button.disabled = true;
    void (async () => {
      try {
        if (enabled) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription !== null) await post("/off", { endpoint: subscription.endpoint });
          enabled = false;
          if (offOnly) {
            widget.hidden = true;
            return;
          }
        } else {
          if ((await Notification.requestPermission()) !== "granted") {
            button.hidden = true;
            status.textContent = text.blocked ?? "";
            return;
          }
          const subscription =
            (await registration.pushManager.getSubscription()) ??
            (await withTimeout(
              registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: fromBase64Url(text.vapidKey ?? ""),
              }),
            ));
          enabled = (await post("", { subscription: subscription.toJSON() })).enabled;
        }
        show();
      } catch {
        status.textContent = text.failed ?? "";
      } finally {
        button.disabled = false;
      }
    })();
  });
}
