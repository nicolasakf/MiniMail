import { describe, expect, it } from "vitest";

import { diffList, refreshSummary } from "./list-changes";
import type { MessageSummary } from "./types";

function row(id: string, day: number, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return { id, date: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`, unread: true, pinned: false, ...overrides } as MessageSummary;
}

describe("diffList", () => {
  it("counts new, re-flagged and dropped conversations", () => {
    const before = [row("a", 10), row("b", 9), row("c", 10), row("old", 1)];
    const after = [row("n", 11), row("a", 10, { unread: false }), row("b", 9)];
    // "c" is inside the new window and gone; "old" is older than the window, so unknown.
    expect(diffList("x", before, after)).toEqual({ accountId: "x", added: 1, updated: 1, removed: 1 });
  });

  it("calls everything new when there was no copy", () => {
    expect(diffList("x", [], [row("a", 1), row("b", 2)])).toMatchObject({ added: 2, updated: 0, removed: 0 });
  });
});

describe("refreshSummary", () => {
  const label = (id: string) => `${id}@mail.test`;

  it("puts the totals in the title and the accounts in the context", () => {
    const text = refreshSummary(
      [
        { accountId: "a", added: 3, updated: 0, removed: 0 },
        { accountId: "a", added: 2, updated: 1, removed: 0 },
        { accountId: "b", added: 0, updated: 0, removed: 0 },
      ],
      [],
      label,
    );
    expect(text.title).toBe("Refreshed 2 accounts: 5 new, 1 updated");
    expect(text.context).toBe("a@mail.test: 5 new, 1 updated · b@mail.test: nothing new");
  });

  it("names the accounts that could not sync", () => {
    const text = refreshSummary([{ accountId: "a", added: 0, updated: 0, removed: 0 }], [{ accountId: "b", message: "x" }], label);
    expect(text.title).toBe("Refreshed 2 accounts: nothing new (1 could not sync)");
    expect(text.context).toContain("b@mail.test: could not sync");
  });
});
