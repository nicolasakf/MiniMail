import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where things are saved. The page's own storage (`localStorage`) is kept separately for every
 * address the page is loaded from (the development server, a built copy, the installed app), so
 * anything kept there looks lost when the app is started another way. It is only for the state of
 * the screen: how wide a panel is, what is folded open, what was last looked at. Everything the person
 * chose or set up (settings, lists, blocks, priority, pins, appearance) belongs in `settings.json`
 * through `saved-prefs.ts`, or in a file of its own in the main process.
 *
 * Adding a file to this list is a decision: say why what it keeps is only the state of the screen.
 */
const SCREEN_STATE: Readonly<Record<string, string>> = {
  "renderer/src/components/mail-app.tsx": "which date groups, the minimized list and the pinned list are folded open",
  "renderer/src/components/mail/log-popover.tsx": "the newest entry of the Log that was looked at",
  "renderer/src/components/mail/sender-panel.tsx": "the width of the sender panel",
  "renderer/src/lib/composer-layout.ts": "the size and place of the composer",
  // Where the old choices are taken over (and removed once they are in `settings.json`), and the color mode library's own copy.
  "renderer/src/lib/saved-prefs.ts": "the color mode library's copy of the saved color mode, and the takeover of the old values",
  "renderer/src/lib/drafts.ts": "the drafts the oldest version kept in the page, moved to disk once",
  "renderer/src/main.tsx": "the color mode library's copy",
};

const ROOT = join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without its comments, which may well talk about the storage. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("where things are saved", () => {
  const using = sourceFiles(ROOT)
    .map((file) => ({ name: relative(ROOT, file), text: withoutComments(readFileSync(file, "utf8")) }))
    .filter(({ text }) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(text))
    .map(({ name }) => name);

  it("keeps the page's own storage for the state of the screen", () => {
    const unexpected = using.filter((name) => !(name in SCREEN_STATE));
    expect(
      unexpected,
      `${unexpected.join(", ")} use the page's own storage. Choices and lists belong in settings.json (see saved-prefs.ts); ` +
        "if this is only the state of the screen, add the file to SCREEN_STATE with a reason.",
    ).toEqual([]);
  });

  it("does not list a file that no longer uses it", () => {
    expect(Object.keys(SCREEN_STATE).filter((name) => !using.includes(name))).toEqual([]);
  });
});
