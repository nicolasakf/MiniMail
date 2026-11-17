import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The rule of this app: no failure goes unrecorded. Every failure must reach main.log and the
 * Log popover, so a `catch` that swallows an error is a bug unless it says why it is not
 * a failure. This test reads the source and fails on any handler that neither records the error
 * (`reportError`, `noteShownError`, an error toast, ...), nor rethrows it, nor carries a comment
 * starting with `expected:` that gives the reason (for example "recorded by the main process").
 */

const ROOT = join(__dirname);

/** Where the recording machinery itself lives; it cannot report its own failures to itself. */
const EXEMPT = new Set([
  "main/event-journal.ts",
  "main/log.ts",
  "main/events.ts",
  "renderer/src/lib/events.ts",
  "renderer/src/lib/toast.ts",
]);

const RECORDS =
  /\b(reportError|reportEvent|reportToJournal|reportIpcFailure|recordAction|noteShownError|logEvent|writeLogLine|toast\.error|reject\(|throw\b|this\.report\(|report\.current)|expected:/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The text between the bracket at `open` and its partner. */
function balanced(text: string, open: number, left: string, right: string): { end: number; body: string } {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === left) depth++;
    else if (text[index] === right && --depth === 0) return { end: index, body: text.slice(open + 1, index) };
  }
  return { end: text.length, body: text.slice(open + 1) };
}

/** The two lines above the one holding `index`, where a note on why a failure is fine may sit. */
const linesAbove = (text: string, index: number): string => {
  const lines = text.slice(0, index).split("\n");
  return lines.slice(-3, -1).join("\n");
};

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

interface Finding {
  file: string;
  line: number;
  code: string;
}

function findSwallowed(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  const name = relative(ROOT, file);

  for (const match of text.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = match.index! + match[0].length - 1;
    const { body } = balanced(text, open, "{", "}");
    if (!RECORDS.test(body) && !RECORDS.test(linesAbove(text, match.index!))) found.push({ file: name, line: lineOf(text, match.index!), code: match[0] });
  }

  for (const match of text.matchAll(/\.catch\(/g)) {
    const open = match.index! + match[0].length - 1;
    const { end, body } = balanced(text, open, "(", ")");
    // Schema defaults (zod's `.catch(DEFAULT)`) and a named handler are not swallowing anything here.
    if (!/^\s*(\(|async\b|function\b)/.test(body)) continue;
    const restOfLine = text.slice(end, text.indexOf("\n", end) === -1 ? text.length : text.indexOf("\n", end));
    if (!RECORDS.test(body) && !RECORDS.test(restOfLine) && !RECORDS.test(linesAbove(text, match.index!))) {
      found.push({ file: name, line: lineOf(text, match.index!), code: `.catch(${body.trim().slice(0, 50)}` });
    }
  }
  return found;
}

describe("failures are never swallowed", () => {
  const files = sourceFiles(ROOT).filter((file) => !EXEMPT.has(relative(ROOT, file)));

  it("scans the app's source", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no catch that neither records, rethrows nor explains itself", () => {
    const swallowed = files.flatMap((file) => findSwallowed(file, readFileSync(file, "utf8")));
    expect(swallowed.map((item) => `${item.file}:${item.line}  ${item.code}`)).toEqual([]);
  });

  it("has no direct console.error or sonner import outside the recorders", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const name = relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      if (/\bconsole\.error\(/.test(text)) offenders.push(`${name}: console.error (use reportError)`);
      if (name !== "renderer/src/components/ui/sonner.tsx" && /from "sonner"/.test(text)) {
        offenders.push(`${name}: imports "sonner" (import { toast } from "@/lib/toast")`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises a swallowed error when it sees one", () => {
    expect(findSwallowed("x.ts", "try { a(); } catch { return null; }")).toHaveLength(1);
    expect(findSwallowed("x.ts", "p.catch(() => undefined);")).toHaveLength(1);
    expect(findSwallowed("x.ts", "try { a(); } catch (e) { reportError('a', 'b', e); }")).toEqual([]);
    expect(findSwallowed("x.ts", "try { a(); } catch { // expected: not a failure\n }")).toEqual([]);
    expect(findSwallowed("x.ts", "p.catch(() => undefined); // expected: recorded by main")).toEqual([]);
    expect(findSwallowed("x.ts", "schema.catch(DEFAULTS.view)")).toEqual([]);
  });
});
