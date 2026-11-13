import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@shared/types";
import { zohoSettings } from "@shared/imap-settings";

// A transparent "keychain": enough to exercise the store without Electron.
const keychain = vi.hoisted(() => ({ available: true }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (data: Buffer) => data.toString("utf8"),
  },
}));

import type { Categorizer } from "./categorizer";
import { MailService } from "./service";
import { AccountStore } from "./store";
import { endpointsFor } from "./providers/imap";

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  provider: "zoho",
  email: `${id}@example.com`,
  displayName: id,
  auth: "password",
  hue: 40,
  ...extra,
});

let dir: string;
let file: string;

beforeEach(() => {
  keychain.available = true;
  dir = mkdtempSync(join(tmpdir(), "minimail-accounts-"));
  file = join(dir, "accounts.json");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const secret = { kind: "password", password: "pw" } as const;

it("reloads generic settings and keeps an existing Zoho account connected with its original details", () => {
  const store = new AccountStore(file);
  const old = account("legacy", { alias: "Work", zohoRegion: "eu", zohoWorkplace: true });
  const current = account("new", {
    provider: "imap",
    imapSettings: zohoSettings("new@example.com", "com.au", true),
  });
  store.add(old, secret);
  store.add(current, secret);

  const reloaded = new AccountStore(file);
  expect(reloaded.get(old.id)).toEqual({ account: old, secret });
  expect(reloaded.get(current.id)).toEqual({ account: current, secret });
  expect(endpointsFor(reloaded.list()[0])).toEqual({
    imapHost: "imappro.zoho.eu",
    smtpHost: "smtppro.zoho.eu",
  });
});

describe("AccountStore alias", () => {
  it("sets an alias, keeps everything else, and survives a restart", () => {
    const store = new AccountStore(file);
    store.add(account("a"), secret);

    const updated = store.setAlias("a", "Work");
    expect(updated).toMatchObject({ id: "a", alias: "Work", email: "a@example.com" });
    expect(new AccountStore(file).list()[0].alias).toBe("Work");
    expect(new AccountStore(file).get("a")?.secret).toEqual(secret);
  });

  it("clears an alias so the file no longer mentions it", () => {
    const store = new AccountStore(file);
    store.add(account("a", { alias: "Work" }), secret);

    expect(store.setAlias("a", undefined)?.alias).toBeUndefined();
    expect(new AccountStore(file).list()[0].alias).toBeUndefined();
    expect(readFileSync(file, "utf8")).not.toContain("alias");
  });

  it("returns undefined for an unknown account", () => {
    expect(new AccountStore(file).setAlias("missing", "x")).toBeUndefined();
  });

  it("undoes the change when the file cannot be written", () => {
    const store = new AccountStore(file);
    store.add(account("a", { alias: "Old" }), secret);

    keychain.available = false;
    expect(() => store.setAlias("a", "New")).toThrow(/Secure storage/);
    expect(store.list()[0].alias).toBe("Old");
  });
});

describe("MailService alias", () => {
  const service = (store: AccountStore) =>
    new MailService(store, {}, async () => undefined, {} as Categorizer);

  it("cleans the alias before saving it", () => {
    const store = new AccountStore(file);
    store.add(account("a"), secret);

    expect(service(store).setAlias("a", "  My   ​work  ").alias).toBe("My work");
    expect(service(store).listAccounts()[0].alias).toBe("My work");
  });

  it("clears the alias when given a blank one", () => {
    const store = new AccountStore(file);
    store.add(account("a", { alias: "Work" }), secret);

    expect(service(store).setAlias("a", "   ").alias).toBeUndefined();
  });

  it("explains when the account is gone", () => {
    expect(() => service(new AccountStore(file)).setAlias("gone", "x")).toThrow(
      "That account no longer exists.",
    );
  });
});

describe("Microsoft account reconnect", () => {
  const realFetch = globalThis.fetch;
  const oldSecret = { kind: "oauth", refreshToken: "old", calendarAccess: false } as const;

  function connect(email: string) {
    const store = new AccountStore(file);
    store.add(account("a", { provider: "outlook", auth: "oauth", alias: "School" }), oldSecret);
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/token")) {
        return Response.json({ access_token: "access", refresh_token: "new", expires_in: 3600 });
      }
      if (url.includes("/me?$select=")) return Response.json({ mail: email });
      if (url.includes("/me/mailFolders/inbox")) return Response.json({ id: "inbox" });
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = new MailService(store, { microsoftClientId: "test-client" }, async (url) => {
      const request = new URL(url);
      const callback = new URL(request.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", request.searchParams.get("state")!);
      callback.searchParams.set("code", "test-code");
      await realFetch(callback);
    }, {} as Categorizer);
    return service.reconnectAccount("a", true);
  }

  it("updates credentials and leaves the existing account and alias in place", async () => {
    await connect("a@example.com");
    const stored = new AccountStore(file).get("a");
    expect(stored?.account).toMatchObject({ id: "a", alias: "School" });
    expect(stored?.secret).toMatchObject({ refreshToken: "new", calendarAccess: true });
  });

  it("rejects the wrong account and keeps the old credentials", async () => {
    await expect(connect("other@example.com")).rejects.toThrow(/Sign in as a@example.com/);
    expect(new AccountStore(file).get("a")?.secret).toEqual(oldSecret);
  });
});

describe("account pictures", () => {
  // The smallest valid PNG and JPEG headers are enough: the service checks the bytes, not decoding.
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("body")]).toString("base64")}`;
  const service = (store: AccountStore) =>
    new MailService(store, {}, async () => undefined, {} as Categorizer);

  it("stores a picture, keeps it across restarts, and removes it", () => {
    const store = new AccountStore(file);
    store.add(account("a"), secret);

    expect(service(store).setAvatar("a", png).avatar).toBe(png);
    expect(new AccountStore(file).list()[0].avatar).toBe(png);
    expect(service(store).setAvatar("a", null).avatar).toBeUndefined();
    expect(readFileSync(file, "utf8")).not.toContain("avatar");
  });

  it("refuses bytes that are not a real PNG, JPEG or WebP, whatever the label says", () => {
    const store = new AccountStore(file);
    store.add(account("a"), secret);
    const fake = (mime: string, body: Buffer) => `data:${mime};base64,${body.toString("base64")}`;

    expect(() => service(store).setAvatar("a", fake("image/png", Buffer.from("<script>alert(1)</script>")))).toThrow(/cannot be used/);
    expect(() => service(store).setAvatar("a", fake("image/png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toThrow(/cannot be used/);
    expect(() => service(store).setAvatar("a", fake("image/png", Buffer.alloc(61 * 1024, 0x89)))).toThrow(/cannot be used/);
  });

  it("undoes the change when the file cannot be written, and explains a missing account", () => {
    const store = new AccountStore(file);
    store.add(account("a", { avatar: png }), secret);
    keychain.available = false;
    expect(() => store.setAvatar("a", undefined)).toThrow(/Secure storage/);
    expect(store.list()[0].avatar).toBe(png);

    keychain.available = true;
    expect(() => service(store).setAvatar("gone", png)).toThrow("That account no longer exists.");
  });
});
