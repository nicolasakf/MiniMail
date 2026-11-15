import { z } from "zod";

const snippet = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  html: z.string().min(1).max(100_000),
});

export const composeLibrarySchema = z.object({
  signatures: z.array(snippet.extend({ accountId: z.string().min(1).max(128) })).max(50),
});

export type ComposeLibrary = z.infer<typeof composeLibrarySchema>;
