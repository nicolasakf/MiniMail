// Writes the macOS app icon, build/icon.icns, from the logo in src/renderer/public/minimail.svg.
//
//   node scripts/generate-icon.mjs
//
// Needs Google Chrome (set CHROME for another path) and macOS `iconutil`. The logo's tile fills 104 of its 128
// units, which leaves the margin macOS icons have, so each size is the whole SVG drawn on a transparent square.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "./lib/chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logo = readFileSync(join(root, "src/renderer/public/minimail.svg"), "utf8");
const work = mkdtempSync(join(tmpdir(), "minimail-icon-"));
const iconset = join(work, "icon.iconset");
mkdirSync(iconset);

const SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

const chrome = await launch();
try {
  for (const size of new Set(SIZES.map(([, px]) => px))) {
    const page = join(work, `logo-${size}.html`);
    const svg = logo.replace('width="128" height="128"', `width="${size}" height="${size}"`);
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">${svg}`);
    await chrome.viewport(size, size, 1);
    await chrome.goto(`file://${page}`);
    await chrome.sleep(300);
    await chrome.shot(join(work, `${size}.png`), { clip: { x: 0, y: 0, width: size, height: size }, transparent: true });
  }
} finally {
  await chrome.close();
}

for (const [name, px] of SIZES) execFileSync("/bin/cp", [join(work, `${px}.png`), join(iconset, name)]);
execFileSync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(root, "build/icon.icns")]);
console.log("Wrote build/icon.icns");
