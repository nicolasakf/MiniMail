import type { Contact } from "./types";

/** Splits on commas, semicolons and newlines, except inside a quoted display name. */
function splitOutsideQuotes(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "," || char === ";" || char === "\n")) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const ADDRESS_PATTERN =/^(?:"?([^"<]*?)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$|^([^<>@\s,;]+@[^<>@\s,;]+)$/;

/** Whether `email` is a plain address ("a@x.com"): something, an @, something, and no spaces or commas. */
export function isValidAddress(email: string): boolean {
  return /^[^<>@\s,;]+@[^<>@\s,;]+$/.test(email);
}

/**
 * Parses what the user typed into a recipient box ("a@x.com, Bob <b@y.com>").
 * Anything that is not an address is reported back so the UI can flag it.
 */
export function parseRecipients(input: string): { contacts: Contact[]; invalid: string[] } {
  const contacts: Contact[] = [];
  const invalid: string[] = [];
  for (const part of splitOutsideQuotes(input)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = ADDRESS_PATTERN.exec(trimmed);
    if (!match) {
      invalid.push(trimmed);
    } else if (match[2]) {
      contacts.push({ name: (match[1] ?? "").trim(), email: match[2] });
    } else {
      contacts.push({ name: "", email: match[3] });
    }
  }
  return { contacts, invalid };
}
