/**
 * Updates to MiniMail itself. Pure on purpose: the main process runs the check, the page shows
 * the result, and the tests run both without Electron.
 */

/** Where the installed app looks for a new version: the newest published GitHub release. */
export const UPDATE_FEED_URL = "https://github.com/nicolasakf/MiniMail/releases/latest/download";

export const UPDATE_STATUSES = [
  /** A development run: updates exist only in the installed app. */
  "unsupported",
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  /** Downloaded and checked; it installs when MiniMail restarts or quits. */
  "downloaded",
  "installing",
] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** The newest version found; set from `available` on. */
  latestVersion?: string;
  /** 0 to 100 while `downloading`. */
  progress?: number;
  /** Why the last check, download or restart did not work. Cleared by the next one. */
  error?: string;
  /** The person closed the notice about `latestVersion`, so it is not shown again. */
  dismissed?: boolean;
}

export interface UpdateSettings {
  /** Look for a new version when MiniMail starts and once a day. A check made by hand always works. */
  check: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { check: true };

/** Statuses in which something is already under way, so the person cannot start another step. */
export function isUpdateBusy(status: UpdateStatus): boolean {
  return status === "checking" || status === "downloading" || status === "installing";
}

/** What the single update button says and does, in the one wording every place uses. */
export type UpdateButton =
  | { label: string; step: "check" | "download" | "install"; disabled: boolean }
  | null;

export function updateButton(state: UpdateState): UpdateButton {
  switch (state.status) {
    case "unsupported":
      return null;
    case "available":
      return { label: `Update to ${state.latestVersion ?? "the new version"}`, step: "download", disabled: false };
    case "downloading":
      return {
        label: state.progress === undefined ? "Downloading…" : `Downloading ${Math.round(state.progress)}%`,
        step: "download",
        disabled: true,
      };
    case "downloaded":
      return { label: "Restart and update", step: "install", disabled: false };
    case "installing":
      return { label: "Restarting…", step: "install", disabled: true };
    case "checking":
      return { label: "Checking…", step: "check", disabled: true };
    default:
      return { label: "Check for updates", step: "check", disabled: false };
  }
}

/** What the notice on screen says for this state; null when there is none. */
export interface UpdateNotice {
  kind: "available" | "downloading" | "ready" | "installing";
  message: string;
  action?: { label: string; step: "download" | "install" };
}

export function updateNotice(state: UpdateState): UpdateNotice | null {
  const version = state.latestVersion ?? "update";
  switch (state.status) {
    case "available":
      if (state.dismissed) return null;
      return { kind: "available", message: `MiniMail ${version} is available.`, action: { label: "Update", step: "download" } };
    case "downloading":
      return {
        kind: "downloading",
        message: state.progress === undefined ? "Downloading the update…" : `Downloading the update… ${Math.round(state.progress)}%`,
      };
    case "downloaded":
      return { kind: "ready", message: `MiniMail ${version} is ready.`, action: { label: "Restart and update", step: "install" } };
    case "installing":
      return { kind: "installing", message: "Restarting MiniMail…" };
    default:
      return null;
  }
}
