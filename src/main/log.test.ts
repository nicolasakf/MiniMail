import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushLog, initLog, logEvent, logIdle, logPath, scrub, setLogSink } from "./log";

describe("log", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-log-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setLogSink(null);
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one line per event to main.log", () => {
    initLog(dir);
    logEvent("sync", "list inbox failed for outlook: UnknownError (HTTP 500)");
    logEvent("graph", "GET /me/mailFolders/inbox/messages -> HTTP 500");
    flushLog();
    const lines = readFileSync(logPath()!, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z ERROR \[sync\] list inbox failed for outlook: UnknownError \(HTTP 500\)$/);
  });

  it("does not write on the caller's turn, only a moment later", async () => {
    initLog(dir);
    logEvent("app", "queued", "info");
    expect(existsSync(join(dir, "main.log"))).toBe(false);
    await vi.waitFor(() => expect(existsSync(join(dir, "main.log"))).toBe(true));
    await logIdle();
    expect(readFileSync(join(dir, "main.log"), "utf8")).toMatch(/INFO \[app\] queued/);
  });

  it("hands events to the journal instead of writing them itself once one is installed", () => {
    initLog(dir);
    const sink = vi.fn();
    setLogSink(sink);
    logEvent("sync", "failed");
    flushLog();
    expect(sink).toHaveBeenCalledWith("error", "sync", "failed");
    expect(existsSync(join(dir, "main.log"))).toBe(false);
  });

  it("scrubs email addresses and tokens", () => {
    expect(scrub("failed for me@hotmail.com")).toBe("failed for <email>");
    expect(scrub("authorization: Bearer abc.DEF-123")).toBe("authorization: Bearer <token>");
  });

  it("rotates the file once it grows past the limit", () => {
    initLog(dir);
    writeFileSync(join(dir, "main.log"), "x".repeat(5 * 1024 * 1024 + 1));
    logEvent("app", "after rotation", "info");
    flushLog();
    expect(existsSync(join(dir, "main.log.1"))).toBe(true);
    expect(readFileSync(join(dir, "main.log"), "utf8")).toContain("after rotation");
  });

  it("does not throw when the folder is unusable", () => {
    writeFileSync(join(dir, "blocker"), "");
    initLog(join(dir, "blocker", "logs"));
    expect(logPath()).toBeNull();
    expect(() => logEvent("app", "still fine")).not.toThrow();
    expect(() => flushLog()).not.toThrow();
  });
});
