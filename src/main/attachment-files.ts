import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { AttachmentFile } from "./providers/types";

/** The largest attachment MiniMail writes to disk. */
export const MAX_OPEN_BYTES = 100 * 1024 * 1024;

/**
 * File types that are safe to hand straight to the system's default app: documents, pictures,
 * audio and video. Anything else (programs, scripts, installers, archives, disk images, shortcuts)
 * is only shown in its folder, because opening it could run it.
 */
const OPENABLE = new Set([
  ".pdf", ".txt", ".md", ".rtf", ".csv", ".tsv", ".json", ".log", ".ics", ".vcf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".pages", ".numbers", ".key",
  ".mp3", ".m4a", ".wav", ".aac", ".flac", ".mp4", ".mov", ".m4v", ".webm",
]);

/** A name that stays inside one folder and is plain to read: no paths, control characters or leading dots. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, "_").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!cleaned) return "attachment";
  if (cleaned.length <= 120) return cleaned;
  const extension = extname(cleaned).slice(0, 12);
  return `${cleaned.slice(0, 120 - extension.length)}${extension}`;
}

export function canOpenDirectly(filename: string): boolean {
  return OPENABLE.has(extname(filename).toLowerCase());
}

export interface AttachmentFilesDeps {
  /** A folder of our own for the files that are opened; emptied by `cleanup`. */
  tempRoot: string;
  /** Opens a file with the system's app; answers an error message, or "" on success (Electron's `shell.openPath`). */
  openPath(path: string): Promise<string>;
  showInFolder(path: string): void;
  /** Asks where to save; null when the user cancels. */
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Marks a file as downloaded from the internet, so the system asks before running it (macOS). */
  quarantine?(path: string): Promise<void>;
}

/** Writes downloaded attachments to disk and opens or reveals them. */
export class AttachmentFiles {
  constructor(private readonly deps: AttachmentFilesDeps) {}

  private check(file: AttachmentFile): void {
    if (file.data.length > MAX_OPEN_BYTES) throw new Error("This attachment is too large to open here.");
  }

  /** Opens the file with the system's app, or shows it in its folder when its type could run. */
  async open(file: AttachmentFile): Promise<void> {
    this.check(file);
    await mkdir(this.deps.tempRoot, { recursive: true });
    const folder = await mkdtemp(join(this.deps.tempRoot, "a-"));
    const path = join(folder, safeFileName(file.filename));
    await writeFile(path, file.data, { mode: 0o600 });
    await this.deps.quarantine?.(path).catch(() => undefined);
    if (!canOpenDirectly(path)) {
      this.deps.showInFolder(path);
      return;
    }
    const failure = await this.deps.openPath(path);
    if (failure) throw new Error(`Could not open "${file.filename}": ${failure}`);
  }

  /** Saves the file where the user chooses; false when they cancel. */
  async save(file: AttachmentFile): Promise<boolean> {
    this.check(file);
    const path = await this.deps.chooseSavePath(safeFileName(file.filename));
    if (!path) return false;
    await writeFile(path, file.data);
    await this.deps.quarantine?.(path).catch(() => undefined);
    return true;
  }

  /** Removes the files left from opening attachments. */
  async cleanup(): Promise<void> {
    await rm(this.deps.tempRoot, { recursive: true, force: true });
  }
}
