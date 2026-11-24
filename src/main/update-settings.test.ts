import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as string[]);
vi.mock("./events", () => ({
  reportError: (_area: string, title: string) => void reported.push(title),
  recordInfo: () => undefined,
  recordAction: () => undefined,
}));

import { updateSettingsSchema } from "@shared/schemas";

import { savedSection, sectionAt, seedSection } from "./test-settings";
import { UpdateSettingsStore } from "./update-settings";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-updates-"));
  file = join(dir, "settings.json");
  reported.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () => new UpdateSettingsStore(sectionAt(file, "updates"));

describe("UpdateSettingsStore", () => {
  it("looks for updates by default, and has no notice closed", () => {
    const store = open();
    expect(store.get()).toEqual({ check: true });
    expect(store.dismissed()).toBeUndefined();
  });

  it("saves the choice in its own section, with its version, and reads it back after a restart", () => {
    open().set({ check: false });
    expect(savedSection(file, "updates")).toEqual({ version: 1, check: false });
    expect(open().get()).toEqual({ check: false });
  });

  it("remembers the closed notice next to the choice, and keeps it when the choice changes", () => {
    const store = open();
    store.dismiss("0.17.0");
    store.set({ check: false });
    expect(savedSection(file, "updates")).toEqual({ version: 1, check: false, dismissed: "0.17.0" });
    const again = open();
    expect(again.dismissed()).toBe("0.17.0");
    expect(again.get()).toEqual({ check: false });
  });

  it("keeps the choice when a notice is closed", () => {
    const store = open();
    store.set({ check: false });
    store.dismiss("0.18.0");
    expect(open().get()).toEqual({ check: false });
  });

  it("reads a section that names no version as version 1 and fills in what it lacks", () => {
    seedSection(file, "updates", {});
    expect(open().get()).toEqual({ check: true });
    expect(reported).toEqual([]);
  });

  it("uses the defaults and reports a value that is out of range or not an object", () => {
    seedSection(file, "updates", { version: 1, check: "yes" });
    expect(open().get()).toEqual({ check: true });
    seedSection(file, "updates", "nonsense");
    expect(open().get()).toEqual({ check: true });
    expect(reported).toHaveLength(2);
  });

  it("leaves a section from a newer version of the app alone and refuses to overwrite it", () => {
    seedSection(file, "updates", { version: 9, check: false, channel: "beta" });
    const store = open();
    expect(store.get()).toEqual({ check: true });
    expect(reported).toHaveLength(1);
    expect(() => store.set({ check: false })).toThrow(/newer version/);
    expect(() => store.dismiss("0.17.0")).toThrow(/newer version/);
    expect(savedSection(file, "updates")).toEqual({ version: 9, check: false, channel: "beta" });
  });

  it("validates what the page sends", () => {
    expect(updateSettingsSchema.parse({ check: false })).toEqual({ check: false });
    expect(() => updateSettingsSchema.parse({ check: "no" })).toThrow();
    expect(() => updateSettingsSchema.parse({})).toThrow();
  });
});
