import { describe, expect, it } from "vitest";

import type { MailFolder } from "@shared/types";

import { actionsForThread, rowHoverActions } from "./row-actions";

const thread = { pinned: false, unread: false } as Parameters<typeof actionsForThread>[1];
const names = (folder: MailFolder) => actionsForThread(folder, thread).map((entry) => entry.action);

describe("actionsForThread", () => {
  it("offers the same actions in every folder, minus the move to where it already is", () => {
    expect(names("inbox")).toEqual(["pin", "markUnread", "archive", "trash", "spam"]);
    expect(names("archive")).toEqual(["pin", "markUnread", "unarchive", "trash", "spam"]);
    expect(names("trash")).toEqual(["pin", "markUnread", "unarchive", "archive", "spam", "deleteForever"]);
    expect(names("spam")).toEqual(["pin", "markUnread", "unarchive", "archive", "trash", "deleteForever"]);
  });

  it("treats the Pinned view as the Inbox", () => {
    expect(names("pinned")).toEqual(names("inbox"));
  });

  it("lets Sent and Drafts mail be archived and trashed", () => {
    expect(names("sent")).toEqual(["pin", "markUnread", "archive", "trash"]);
  });

  it("matches the row's hover buttons", () => {
    for (const folder of ["inbox", "archive", "trash", "spam"] as const) {
      const hover = rowHoverActions(folder, thread).map((entry) => entry.action);
      expect(hover).toEqual(names(folder).filter((a) => a !== "markUnread" && a !== "deleteForever"));
    }
  });
});
