import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

import { MAX_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS, type DraftAttachment } from "@shared/types";

const TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".ics": "text/calendar",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

export function contentTypeOf(filename: string): string {
  return TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The files named by `--attach`, one path per line (the command line makes them absolute), read for a
 * draft. Throws an Error that says what is wrong: nothing is attached unless every file can be.
 * The person sees the files on the draft before anything is sent.
 */
export function readAttachments(paths: string | undefined, alreadyAttached = 0, alreadyBytes = 0): DraftAttachment[] {
  const list = (paths ?? "").split("\n").map((path) => path.trim()).filter(Boolean);
  if (list.length === 0) return [];
  if (alreadyAttached + list.length > MAX_DRAFT_ATTACHMENTS) throw new Error(`A draft takes up to ${MAX_DRAFT_ATTACHMENTS} files`);
  let total = alreadyBytes;
  const files: DraftAttachment[] = [];
  for (const path of list) {
    let size: number;
    try {
      const info = statSync(path);
      if (!info.isFile()) throw new Error(`${path} is not a file`);
      size = info.size;
    } catch (error) {
      // Said in the answer: the caller named a path that is not there or not a file.
      throw new Error(error instanceof Error && error.message.endsWith("is not a file") ? error.message : `Cannot read ${path}: no such file`, { cause: error });
    }
    total += size;
    if (total > MAX_ATTACHMENT_BYTES) throw new Error(`The files are over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB a message can carry`);
    const filename = basename(path);
    files.push({ filename, contentType: contentTypeOf(filename), contentBase64: readFileSync(path).toString("base64") });
  }
  return files;
}
