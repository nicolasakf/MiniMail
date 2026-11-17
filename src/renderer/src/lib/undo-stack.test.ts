import { beforeEach, describe, expect, it, vi } from "vitest";

import { undoStack } from "./undo-stack";

const entry = (ref: string, run: () => void = () => undefined) => ({ ref, label: ref, run });

describe("undoStack", () => {
  beforeEach(() => undoStack.clear());

  it("takes back the newest action first, so ⌘Z twice undoes the last two", () => {
    const order: string[] = [];
    undoStack.push(entry("a", () => order.push("a")));
    undoStack.push(entry("b", () => order.push("b")));
    undoStack.push(entry("c", () => order.push("c")));
    expect(undoStack.undoLast()).toBe(true);
    expect(undoStack.undoLast()).toBe(true);
    expect(order).toEqual(["c", "b"]);
    expect(undoStack.has("a")).toBe(true);
  });

  it("says so when there is nothing to take back", () => {
    expect(undoStack.undoLast()).toBe(false);
    expect(undoStack.undo("nope")).toBe(false);
  });

  it("takes back one particular action and leaves the others", () => {
    const run = vi.fn();
    undoStack.push(entry("a"));
    undoStack.push(entry("b", run));
    undoStack.push(entry("c"));
    expect(undoStack.undo("b")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(undoStack.entries().map((item) => item.ref)).toEqual(["a", "c"]);
    expect(undoStack.undo("b")).toBe(false);
  });

  it("keeps only the newest 50", () => {
    for (let index = 0; index < 60; index++) undoStack.push(entry(`e${index}`));
    expect(undoStack.entries()).toHaveLength(50);
    expect(undoStack.has("e9")).toBe(false);
    expect(undoStack.has("e10")).toBe(true);
  });

  it("tells subscribers when it changes", () => {
    const listener = vi.fn();
    const stop = undoStack.subscribe(listener);
    undoStack.push(entry("a"));
    undoStack.undoLast();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    undoStack.push(entry("b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("folds what a group pushes into one entry that undoes all of it", () => {
    const order: string[] = [];
    undoStack.push(entry("before"));
    undoStack.group(entry("block", () => order.push("unblock")), () => {
      undoStack.push(entry("trash", () => order.push("restore")));
    });
    expect(undoStack.entries().map((item) => item.ref)).toEqual(["before", "block"]);
    expect(undoStack.has("trash")).toBe(false);
    undoStack.undoLast();
    expect(order).toEqual(["unblock", "restore"]);
  });

  it("still lets the folded action be undone on its own, once", () => {
    const run = vi.fn();
    undoStack.group(entry("block"), () => undoStack.push(entry("trash", run)));
    expect(undoStack.undo("trash")).toBe(true);
    expect(undoStack.undo("trash")).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not throw when an undo does, and does not offer it again", () => {
    undoStack.push(
      entry("a", () => {
        throw new Error("offline");
      }),
    );
    expect(() => undoStack.undoLast()).not.toThrow();
    expect(undoStack.has("a")).toBe(false);
  });
});
