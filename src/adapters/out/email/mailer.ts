// What the email adapters send through (decision D31); SMTP in production, a fake in tests.
import type { SendResult } from "../../../application/ports.ts";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<SendResult>;
}
