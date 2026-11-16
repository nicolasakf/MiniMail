import { describe, expect, it } from "vitest";

import {
  addBlockEntry,
  EMPTY_BLOCKLIST,
  isBlockedAddress,
  mailToTrash,
  parseBlockList,
  toggleBlockEntry,
} from "./blocklist";
import type { MessageSummary } from "./types";

const message = (id: string, email: string, folder: MessageSummary["folder"] = "inbox") =>
  ({ id, folder, from: { name: "", email } }) as MessageSummary;

describe("block list", () => {
  it("toggles entries in lower case", () => {
    const on = toggleBlockEntry(EMPTY_BLOCKLIST, "senders", " Spammer@Example.com ");
    expect(on.senders).toEqual(["spammer@example.com"]);
    expect(toggleBlockEntry(on, "senders", "spammer@example.com").senders).toEqual([]);
  });

  it("adding twice keeps one entry", () => {
    const once = addBlockEntry(EMPTY_BLOCKLIST, "domains", "example.com");
    expect(addBlockEntry(once, "domains", "EXAMPLE.com")).toBe(once);
  });

  it("matches a blocked address or any address of a blocked domain", () => {
    const list = { senders: ["a@x.com"], domains: ["spam.org"] };
    expect(isBlockedAddress(list, "A@x.com")).toBe(true);
    expect(isBlockedAddress(list, "b@x.com")).toBe(false);
    expect(isBlockedAddress(list, "anyone@news.spam.org")).toBe(true);
  });

  it("sends blocked mail in the Inbox and Archive to the Trash, and nothing else", () => {
    const list = { senders: [], domains: ["spam.org"] };
    const rows = [
      message("1", "a@spam.org"),
      message("2", "a@spam.org", "archive"),
      message("3", "a@spam.org", "trash"),
      message("4", "a@spam.org", "spam"),
      message("5", "a@spam.org", "sent"),
      message("6", "me@spam.org"),
      message("7", "friend@ok.com"),
    ];
    expect(mailToTrash(list, rows, ["me@spam.org"]).map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("drops malformed stored values", () => {
    expect(parseBlockList({ senders: ["A@b.com", 3, "a@b.com"], domains: "x" })).toEqual({
      senders: ["a@b.com"],
      domains: [],
    });
    expect(parseBlockList(null)).toEqual(EMPTY_BLOCKLIST);
  });
});
