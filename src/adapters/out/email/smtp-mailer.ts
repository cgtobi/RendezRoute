// Sending email over SMTP with Nodemailer (spec 7 Optional notification channels, decision D31).
// The server is trusted configuration (SMTP_*), like the OIDC issuer. Only error classes and SMTP
// codes decide the outcome; no address or message text is logged.
import nodemailer from "nodemailer";
import type { SendResult } from "../../../application/ports.ts";
import type { SmtpConfig } from "../../../config.ts";
import type { Mailer } from "./mailer.ts";

/** Long enough for a slow server, short enough not to hold up the job runner. */
const TIMEOUT_MS = 20_000;

export function createSmtpMailer({
  smtp,
  instanceName,
}: {
  smtp: SmtpConfig;
  instanceName: string;
}): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.tls === "tls",
    requireTLS: smtp.tls === "starttls",
    ignoreTLS: smtp.tls === "none",
    auth: smtp.auth === undefined ? undefined : { user: smtp.auth.user, pass: smtp.auth.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    logger: false,
  });

  return {
    async send(message) {
      try {
        await transport.sendMail({
          from: { name: instanceName, address: smtp.from },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
          // The envelope names only this recipient, whatever a header might say.
          envelope: { from: smtp.from, to: [message.to] },
        });
        return "sent";
      } catch (error) {
        return sendResultOf(error);
      }
    },
  };
}

/**
 * A recipient refused for good (5xx to RCPT TO) is gone: the address does not exist. Any other
 * permanent refusal concerns this message or the server's setup, so the channel stays; temporary
 * errors and unreachable servers are retried.
 */
function sendResultOf(error: unknown): SendResult {
  const { responseCode, command } = (error ?? {}) as { responseCode?: number; command?: string };
  if (responseCode === undefined || responseCode < 500) return "retry";
  return command === "RCPT TO" ? "gone" : "failed";
}
