import type { MessageStructureObject } from "imapflow";

import type { AttachmentInfo } from "@shared/types";

import type { InlineRef } from "./types";

/** One part of a message the server can hand over on its own, by number. */
export interface PartRef {
  /** The key to ask the server for: a part number such as "1.2", or "text" for a message with a single part. */
  key: string;
  encoding: string;
  charset: string;
  /** Bytes as the server counts them (before the transfer encoding is undone). */
  size: number;
}

/** Which parts of a message hold what, worked out from its structure alone (nothing downloaded yet). */
export interface BodyPlan {
  /** The readable parts, in the order the message lists them. */
  html: PartRef[];
  text: PartRef[];
  /** The calendar invitation, if the message has one. */
  calendar: PartRef | null;
  /** Images the text may embed by `cid:`; their transfer encoding is what `decodeBinary` needs. */
  inline: (InlineRef & { encoding: string })[];
  /** The files, by name and size only. Their `id` is the part number to download one with. */
  attachments: AttachmentInfo[];
}

/** The most downloaded of one readable part; the rest of a bigger one is cut off. */
export const MAX_TEXT_PART_BYTES = 4 * 1024 * 1024;

const paramOf = (node: MessageStructureObject, name: string): string | undefined =>
  node.parameters?.[name] ?? undefined;

/** What the server reports as a part's size is the encoded size; a base64 file is about 3/4 of that. */
function decodedSize(node: MessageStructureObject): number {
  const size = node.size ?? 0;
  return node.encoding === "base64" ? Math.floor((size * 3) / 4) : size;
}

function filenameOf(node: MessageStructureObject): string {
  const named = node.dispositionParameters?.filename ?? paramOf(node, "name");
  if (named) return named;
  if (node.type === "message/rfc822") return node.envelope?.subject ? `${node.envelope.subject}.eml` : "message.eml";
  return "attachment";
}

/**
 * Sorts the parts of a message into text, invitation, embedded images and files, the way a mail reader
 * shows them: a part is a file when the sender marked it as one or when it is neither readable nor
 * embedded in the text. Images that live inside a `multipart/related` and carry a Content-ID belong to the
 * text and are not listed as files. Embedded messages are files, and are not looked into.
 */
export function planBody(root: MessageStructureObject | undefined): BodyPlan {
  const plan: BodyPlan = { html: [], text: [], calendar: null, inline: [], attachments: [] };
  if (!root) return plan;

  const walk = (node: MessageStructureObject, related: boolean, onlyPart: boolean): void => {
    const type = (node.type ?? "").toLowerCase();
    if (!type) return;
    if (type.startsWith("multipart/")) {
      const inRelated = related || type === "multipart/related";
      for (const child of node.childNodes ?? []) walk(child, inRelated, false);
      return;
    }
    // A message with no children is read as a whole ("text"); inside a multipart a part has its number.
    const key = node.part ?? (onlyPart ? "text" : undefined);
    if (!key) return;
    const attached = node.disposition?.toLowerCase() === "attachment";

    if (type === "text/calendar") {
      plan.calendar ??= { key, encoding: node.encoding ?? "7bit", charset: paramOf(node, "charset") ?? "utf-8", size: node.size ?? 0 };
      return;
    }
    if ((type === "text/html" || type === "text/plain") && !attached) {
      const part: PartRef = { key, encoding: node.encoding ?? "7bit", charset: paramOf(node, "charset") ?? "utf-8", size: node.size ?? 0 };
      (type === "text/html" ? plan.html : plan.text).push(part);
      return;
    }
    if (related && node.id && !attached) {
      plan.inline.push({
        id: key,
        contentType: type,
        size: decodedSize(node),
        cid: node.id.replace(/^<|>$/g, ""),
        encoding: node.encoding ?? "7bit",
      });
      return;
    }
    plan.attachments.push({ id: key, filename: filenameOf(node), contentType: type || "application/octet-stream", size: decodedSize(node) });
  };

  walk(root, false, !root.childNodes?.length);
  return plan;
}

/** Undoes quoted-printable: `=XX` is a byte, a trailing `=` joins the next line. */
function decodeQuotedPrintable(input: Buffer): Buffer {
  const out: number[] = [];
  const hex = (code: number): number => (code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1);
  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (byte !== 0x3d) {
      out.push(byte);
      continue;
    }
    // "=" at the end of a line is a soft break (CRLF or LF); "=XX" is one byte.
    if (input[index + 1] === 0x0d && input[index + 2] === 0x0a) {
      index += 2;
    } else if (input[index + 1] === 0x0a) {
      index += 1;
    } else {
      const high = hex(input[index + 1] ?? -1);
      const low = hex(input[index + 2] ?? -1);
      if (high >= 0 && low >= 0) {
        out.push(high * 16 + low);
        index += 2;
      } else {
        out.push(byte);
      }
    }
  }
  return Buffer.from(out);
}

/** The bytes of a part with its transfer encoding undone. */
export function decodeBinary(content: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").toLowerCase()) {
    case "base64":
      return Buffer.from(content.toString("latin1"), "base64");
    case "quoted-printable":
      return decodeQuotedPrintable(content);
    default:
      return content;
  }
}

/** A readable part as text: transfer encoding undone, then the charset the sender named (UTF-8 if it names none we know). */
export function decodeText(content: Buffer, encoding: string | undefined, charset: string | undefined): string {
  const bytes = decodeBinary(content, encoding);
  const label = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // expected: a charset name this runtime does not know; UTF-8 shows the ASCII part of the text at least.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Whether the text refers to an image by `cid:`, so the embedded images are worth downloading. */
export function usesCidImages(html: string | null): boolean {
  return html !== null && /\bcid:/i.test(html);
}

/** Replaces `cid:` references with the images themselves, so they show without a network. */
export function embedImages(html: string, images: readonly { cid: string; contentType: string; data: Buffer }[]): string {
  let result = html;
  for (const image of images) {
    const dataUri = `data:${image.contentType};base64,${image.data.toString("base64")}`;
    result = result.split(`cid:${image.cid}`).join(dataUri);
  }
  return result;
}
