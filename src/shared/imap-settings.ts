import { z } from "zod";

const serverSchema = z.object({
  host: z.string().trim().max(253).regex(
    /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/i,
    "Enter a server hostname without a protocol or port.",
  ),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls"]),
  username: z.string().trim().min(1).max(320).regex(/^[^\r\n\0]+$/),
});

export const imapSettingsSchema = z.object({
  incoming: serverSchema,
  outgoing: serverSchema,
  serverSavesSent: z.boolean(),
});

export type MailServer = z.infer<typeof serverSchema>;
export type ImapSettings = z.infer<typeof imapSettingsSchema>;

export function zohoSettings(email: string, region: string, workplace: boolean): ImapSettings {
  const prefix = workplace ? "pro" : "";
  return {
    incoming: { host: `imap${prefix}.zoho.${region}`, port: 993, security: "tls", username: email },
    outgoing: { host: `smtp${prefix}.zoho.${region}`, port: 465, security: "tls", username: email },
    serverSavesSent: true,
  };
}
