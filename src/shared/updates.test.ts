import { describe, expect, it } from "vitest";

import { isUpdateBusy, updateButton, updateNotice, type UpdateState } from "./updates";

const state = (patch: Partial<UpdateState>): UpdateState => ({ status: "idle", currentVersion: "0.16.2", ...patch });

describe("updateButton", () => {
  it("has no button in a development run", () => {
    expect(updateButton(state({ status: "unsupported" }))).toBeNull();
  });

  it("offers the next step at each stage", () => {
    expect(updateButton(state({ status: "idle" }))).toEqual({ label: "Check for updates", step: "check", disabled: false });
    expect(updateButton(state({ status: "current" }))).toEqual({ label: "Check for updates", step: "check", disabled: false });
    expect(updateButton(state({ status: "checking" }))).toEqual({ label: "Checking…", step: "check", disabled: true });
    expect(updateButton(state({ status: "available", latestVersion: "0.17.0" }))).toEqual({ label: "Update to 0.17.0", step: "download", disabled: false });
    expect(updateButton(state({ status: "downloading", progress: 41.6 }))).toEqual({ label: "Downloading 42%", step: "download", disabled: true });
    expect(updateButton(state({ status: "downloaded", latestVersion: "0.17.0" }))).toEqual({ label: "Restart and update", step: "install", disabled: false });
    expect(updateButton(state({ status: "installing" }))).toEqual({ label: "Restarting…", step: "install", disabled: true });
  });

  it("does not claim a percentage before it knows one", () => {
    expect(updateButton(state({ status: "downloading" }))?.label).toBe("Downloading…");
  });
});

describe("updateNotice", () => {
  it("shows nothing unless there is something to act on or wait for", () => {
    for (const status of ["unsupported", "idle", "checking", "current"] as const) expect(updateNotice(state({ status }))).toBeNull();
  });

  it("announces a new version with a button to download it, until the person closes it", () => {
    const found = state({ status: "available", latestVersion: "0.17.0" });
    expect(updateNotice(found)).toEqual({ kind: "available", message: "MiniMail 0.17.0 is available.", action: { label: "Update", step: "download" } });
    expect(updateNotice({ ...found, dismissed: true })).toBeNull();
  });

  it("follows the download and offers the restart when it is ready", () => {
    expect(updateNotice(state({ status: "downloading", progress: 12.4 }))).toEqual({ kind: "downloading", message: "Downloading the update… 12%" });
    expect(updateNotice(state({ status: "downloaded", latestVersion: "0.17.0" }))).toEqual({
      kind: "ready",
      message: "MiniMail 0.17.0 is ready.",
      action: { label: "Restart and update", step: "install" },
    });
    expect(updateNotice(state({ status: "installing" }))).toEqual({ kind: "installing", message: "Restarting MiniMail…" });
  });

  it("shows the ready notice even when the version's first notice was closed", () => {
    expect(updateNotice(state({ status: "downloaded", latestVersion: "0.17.0", dismissed: true }))).not.toBeNull();
  });
});

describe("isUpdateBusy", () => {
  it("is true only while a step is under way", () => {
    expect(["checking", "downloading", "installing"].every((status) => isUpdateBusy(status as UpdateState["status"]))).toBe(true);
    expect(["unsupported", "idle", "current", "available", "downloaded"].some((status) => isUpdateBusy(status as UpdateState["status"]))).toBe(false);
  });
});
