import { existsSync, readFileSync } from "node:fs";

import { composeLibrarySchema, type ComposeLibrary } from "@shared/compose-library";

import { writePrivateFile, type Cipher } from "./category-store";

/** Account signatures stay encrypted on the same machine as local drafts. */
export class ComposeLibraryStore {
  constructor(private readonly path: string, private readonly cipher: Cipher) {}

  get(): ComposeLibrary {
    if (!existsSync(this.path)) return { signatures: [] };
    if (!this.cipher.isEncryptionAvailable()) throw new Error("Secure storage is unavailable.");
    const data = readFileSync(this.path, "utf8");
    return composeLibrarySchema.parse(JSON.parse(this.cipher.decryptString(Buffer.from(data, "base64"))));
  }

  set(value: ComposeLibrary): ComposeLibrary {
    if (!this.cipher.isEncryptionAvailable()) throw new Error("Secure storage is unavailable.");
    writePrivateFile(this.path, this.cipher.encryptString(JSON.stringify(value)).toString("base64"));
    return value;
  }
}
