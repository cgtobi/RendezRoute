// English UI strings (spec section 2: all UI strings externalized, English first).
export const en = {
  "layout.poweredBy": "Powered by {name}",
  "layout.devBanner": "Development mode: insecure settings are active. Not for production use.",
  "home.status": "{name} is in early development. Creating plans comes next.",
  "error.csrf": "Your form expired or came from another site. Reload the page and try again.",
  "error.internal": "Something went wrong on our side. Please try again later.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;
