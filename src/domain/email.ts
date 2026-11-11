// Email addresses for notifications (spec 7 Optional notification channels, decision D31): one
// plain address, nothing that could name a second recipient or start a header line.
import { err, ok, type Result } from "./result.ts";

/** RFC 5321 limits: the whole path, the part before the @, one domain label. */
const MAX_ADDRESS_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_LABEL_LENGTH = 63;

/** Letters (any script), digits and the usual specials; no quotes, brackets, commas or spaces. */
const LOCAL_PART = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;

export type EmailAddressError = "required" | "email_invalid";

/** The address as typed, trimmed, with its domain in lower case. */
export function parseEmailAddress(input: string): Result<string, EmailAddressError> {
  const text = input.trim();
  if (text === "") return err("required");
  const invalid = err("email_invalid");
  if (text.length > MAX_ADDRESS_LENGTH) return invalid;
  const parts = text.split("@");
  if (parts.length !== 2) return invalid;
  const [local = "", domain = ""] = parts;
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return invalid;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return invalid;
  const labels = domain.toLowerCase().split(".");
  if (labels.length < 2) return invalid;
  if (labels.some((label) => label.length > MAX_LABEL_LENGTH || !LABEL.test(label))) {
    return invalid;
  }
  return ok(`${local}@${labels.join(".")}`);
}

/** For pages anyone with an email's link may see: "a…@example.org". */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  const [first = ""] = Array.from(address.slice(0, at));
  return `${first}…${address.slice(at)}`;
}
