// English UI strings (spec section 2: all UI strings externalized, English first).
export const en = {
  "layout.poweredBy": "Powered by {name}",
  "layout.devBanner": "Development mode: insecure settings are active. Not for production use.",
  "home.status": "{name} is in early development. Creating plans comes next.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;
