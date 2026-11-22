import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CLI_SETTINGS, type CliSettings } from "@shared/cli";

import { CliSettingsStore } from "./settings";

const reportError = vi.fn();
vi.mock("../events", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

function section(initial?: unknown) {
  const writes: unknown[] = [];
  return {
    writes,
    read: () => initial,
    write: (value: unknown) => void writes.push(structuredClone(value)),
  };
}

beforeEach(() => reportError.mockClear());

describe("CliSettingsStore", () => {
  it("is off with links hidden when nothing was saved (every file from before the CLI existed)", () => {
    const store = new CliSettingsStore(section());
    expect(store.get()).toEqual(DEFAULT_CLI_SETTINGS);
    expect(store.get().enabled).toBe(false);
    expect(store.get().hideLinks).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reads a version 3 section", () => {
    const saved = { version: 3, pathLink: false, enabled: true, disabled: ["contacts"], ask: { send: "always", unsubscribe: "off", invitation: "ask" }, allowedRecipients: ["anna@example.com", "@example.org"], hideLinks: false, skillTargets: ["claude"] };
    expect(new CliSettingsStore(section(saved)).get()).toEqual({
      enabled: true,
      disabled: ["contacts"],
      ask: { send: "always", unsubscribe: "off", invitation: "ask" },
      allowedRecipients: ["anna@example.com", "@example.org"],
      hideLinks: false,
      pathLink: false,
      skillTargets: ["claude"],
    });
  });

  it("keeps the good choices when one is bad", () => {
    const store = new CliSettingsStore(
      section({ version: 3, enabled: true, disabled: "everything", ask: "whenever", allowedRecipients: 7, hideLinks: "no", pathLink: "yes", skillTargets: ["claude"] }),
    );
    expect(store.get()).toEqual({ ...DEFAULT_CLI_SETTINGS, enabled: true, skillTargets: ["claude"] });
  });

  it("drops command and agent names this version does not know and keeps the rest", () => {
    const store = new CliSettingsStore(
      section({ version: 3, enabled: true, disabled: ["contacts", "shout", "contacts"], hideLinks: true, skillTargets: ["cursor", "agents"] }),
    );
    expect(store.get().disabled).toEqual(["contacts"]);
    expect(store.get().skillTargets).toEqual(["agents"]);
  });

  it("leaves a section from a newer version untouched, keeps the CLI off and refuses to overwrite it", () => {
    const saved = { version: 4, enabled: true, disabled: [], hideLinks: false, skillTargets: [] };
    const target = section(saved);
    const store = new CliSettingsStore(target);
    expect(store.get().enabled).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(() => store.set({ ...DEFAULT_CLI_SETTINGS, enabled: true })).toThrow(/newer version/);
    expect(target.writes).toEqual([]);
  });

  it("reports a section that is not an object and starts from the defaults", () => {
    const store = new CliSettingsStore(section("nonsense"));
    expect(store.get()).toEqual(DEFAULT_CLI_SETTINGS);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("writes the whole section with its version on every change and returns what it stored", () => {
    const target = section();
    const store = new CliSettingsStore(target);
    const next: CliSettings = { ...DEFAULT_CLI_SETTINGS, enabled: true, disabled: ["wait", "wait"], skillTargets: ["agents", "claude"], allowedRecipients: ["a@b.test", "a@b.test"] };
    const stored = store.set(next);
    expect(stored.disabled).toEqual(["wait"]);
    expect(stored.allowedRecipients).toEqual(["a@b.test"]);
    expect(target.writes).toEqual([
      { version: 3, enabled: true, disabled: ["wait"], ask: { send: "ask", unsubscribe: "ask", invitation: "ask" }, allowedRecipients: ["a@b.test"], hideLinks: true, pathLink: true, skillTargets: ["agents", "claude"] },
    ]);
    expect(new CliSettingsStore(section(target.writes[0])).get()).toEqual(stored);
  });

  it("does not let a caller change the stored value through what get returns", () => {
    const store = new CliSettingsStore(section());
    store.get().disabled.push("list");
    expect(store.get().disabled).toEqual([]);
  });
});

describe("CliSettingsStore: from version 1", () => {
  // The file as step 1 of the CLI wrote it, before the ask-first commands existed.
  const v1 = { version: 1, enabled: true, disabled: ["contacts"], hideLinks: false, skillTargets: ["agents", "claude"] };

  it("keeps everything a version 1 file said and gives the new choices their defaults: ask first, no one allowed in advance", () => {
    const store = new CliSettingsStore(section(v1));
    expect(store.get()).toEqual({
      enabled: true,
      disabled: ["contacts"],
      hideLinks: false,
      skillTargets: ["agents", "claude"],
      ask: { send: "ask", unsubscribe: "ask", invitation: "ask" },
      allowedRecipients: [],
      pathLink: true,
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("is saved as version 3 the next time something changes, with nothing lost", () => {
    const target = section(v1);
    const store = new CliSettingsStore(target);
    store.set({ ...store.get(), ask: { ...store.get().ask, send: "off" } });
    expect(target.writes[0]).toMatchObject({ version: 3, enabled: true, disabled: ["contacts"], hideLinks: false, pathLink: true, ask: { send: "off", unsubscribe: "ask", invitation: "ask" } });
    expect(new CliSettingsStore(section(target.writes[0])).get().ask.send).toBe("off");
  });

  it("does not turn on anything that was off: a version 1 file with the CLI off stays off", () => {
    expect(new CliSettingsStore(section({ ...v1, enabled: false })).get().enabled).toBe(false);
  });
});

describe("CliSettingsStore: ask-first choices", () => {
  it("falls back to ask for a mode it does not know, command by command", () => {
    const store = new CliSettingsStore(section({ version: 3, enabled: true, disabled: [], ask: { send: "sometimes", unsubscribe: "off", invitation: "always" }, allowedRecipients: [], hideLinks: true, pathLink: true, skillTargets: [] }));
    expect(store.get().ask).toEqual({ send: "ask", unsubscribe: "off", invitation: "always" });
  });

  it("drops allowed recipients that are not an address or a domain that may be allowed, and lowercases the rest", () => {
    const store = new CliSettingsStore(
      section({ version: 3, enabled: true, disabled: [], ask: DEFAULT_CLI_SETTINGS.ask, allowedRecipients: ["Anna@Example.com", "@gmail.com", "nonsense", 7, "@example.org"], hideLinks: true, pathLink: true, skillTargets: [] }),
    );
    expect(store.get().allowedRecipients).toEqual(["anna@example.com", "@example.org"]);
  });
});

describe("CliSettingsStore: from version 2", () => {
  // The file as the ask-first step wrote it, before the link for the terminal existed.
  const v2 = { version: 2, enabled: true, disabled: [], ask: { send: "always", unsubscribe: "ask", invitation: "off" }, allowedRecipients: ["anna@example.com"], hideLinks: false, skillTargets: ["claude"] };

  it("keeps everything a version 2 file said and turns the link for the terminal on, as it is for a new one", () => {
    expect(new CliSettingsStore(section(v2)).get()).toEqual({
      enabled: true,
      disabled: [],
      ask: { send: "always", unsubscribe: "ask", invitation: "off" },
      allowedRecipients: ["anna@example.com"],
      hideLinks: false,
      pathLink: true,
      skillTargets: ["claude"],
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("is saved as version 3 the next time something changes", () => {
    const target = section(v2);
    const store = new CliSettingsStore(target);
    store.set({ ...store.get(), pathLink: false });
    expect(target.writes[0]).toMatchObject({ version: 3, pathLink: false, ask: { send: "always" }, allowedRecipients: ["anna@example.com"] });
  });

  it("remembers that the link was turned off", () => {
    expect(new CliSettingsStore(section({ ...v2, version: 3, pathLink: false })).get().pathLink).toBe(false);
  });
});
