import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@shared/types";

const mail = vi.hoisted(() => ({
  imapOptions: vi.fn(),
  smtpOptions: vi.fn(),
  smtpVerify: vi.fn(),
  smtpClose: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    usable = true;
    constructor(options: unknown) { mail.imapOptions(options); }
    on() {}
    async connect() {}
    async list() { return [{ path: "INBOX" }]; }
    async logout() {}
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport(options: unknown) {
      mail.smtpOptions(options);
      return { verify: mail.smtpVerify, close: mail.smtpClose };
    },
  },
}));

import { ImapProvider } from "./providers/imap";

const account: Account = {
  id: "generic",
  provider: "imap",
  email: "user@example.com",
  displayName: "User",
  auth: "password",
  hue: 40,
  imapSettings: {
    incoming: { host: "imap.example.com", port: 143, security: "starttls", username: "user" },
    outgoing: { host: "smtp.example.com", port: 587, security: "starttls", username: "user@example.com" },
    serverSavesSent: false,
  },
};

afterEach(() => vi.resetAllMocks());

describe("generic IMAP account verification", () => {
  it("authenticates both servers with the configured usernames and requires STARTTLS", async () => {
    const provider = new ImapProvider(account, async () => ({ pass: "app-password" }));
    try {
      await provider.verify();
      expect(mail.imapOptions).toHaveBeenCalledWith(expect.objectContaining({
        host: "imap.example.com", port: 143, secure: false, doSTARTTLS: true,
        auth: { user: "user", pass: "app-password" },
      }));
      expect(mail.smtpOptions).toHaveBeenCalledWith(expect.objectContaining({
        host: "smtp.example.com", port: 587, secure: false, requireTLS: true,
        auth: { user: "user@example.com", pass: "app-password" },
      }));
      expect(mail.smtpVerify).toHaveBeenCalledOnce();
      expect(mail.smtpClose).toHaveBeenCalledOnce();
    } finally {
      await provider.close();
    }
  });

  it("reports outgoing authentication failures before the service can save the account", async () => {
    mail.smtpVerify.mockRejectedValueOnce(new Error("Authentication failed"));
    const provider = new ImapProvider(account, async () => ({ pass: "app-password" }));
    try {
      await expect(provider.verify()).rejects.toThrow("Outgoing mail: Authentication failed");
      expect(mail.smtpClose).toHaveBeenCalledOnce();
    } finally {
      await provider.close();
    }
  });
});
