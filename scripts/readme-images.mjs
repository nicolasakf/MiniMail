// Rebuilds the images of the README (docs/images/*.webp) from the demo app, in a headless Chrome.
//
//   npm run dev:web -- --port 5199 --strictPort      (in one terminal; never on 5173, the Electron app's port)
//   node scripts/readme-images.mjs [app] [categories] [before-after] [hero]
//
// Needs Google Chrome (set CHROME for another path), Node 22+ and `cwebp` (brew install webp). The demo has
// invented senders and mail, so nothing private reaches the pictures. The page's clock is set to Monday
// 23 November 2026, so the date sections (Pinned, Yesterday, Last Week, ...) come out the same on any day.
// The left half of before-after is scripts/readme-images/traditional-email.svg; the hero shows src/renderer/public/minimail.svg.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "./lib/chrome.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const URL = process.env.DEMO_URL ?? "http://localhost:5199/";
const TMP = mkdtempSync(join(tmpdir(), "minimail-readme-"));
const OUT = join(here, "../docs/images");
mkdirSync(OUT, { recursive: true });

// ---- The pictures ---------------------------------------------------------------------------------
const only = process.argv.slice(2);
const wants = (name) => only.length === 0 || only.includes(name);

const FREEZE_DATE = `(() => {
  const Real = Date, start = Real.now(), fixed = new Real(2026, 10, 23, 13, 0, 0).getTime();
  const now = () => fixed + (Real.now() - start);
  class Fake extends Real { constructor(...a) { if (a.length === 0) super(now()); else super(...a); } static now() { return now(); } }
  globalThis.Date = Fake;
})();`;

const SETTINGS = `localStorage.clear();
localStorage.setItem("theme", "light");
localStorage.setItem("minimail:appearance", JSON.stringify({ textSize: "default", showPreviews: true, categoryLayout: "vertical", splitView: false, splitListWidth: 400, accentColor: null, emailWidth: "default", emailBackground: "theme" }));
localStorage.setItem("minimail.priority", JSON.stringify({ threads: [], senders: ["support@northwind-support.example"], domains: [] }));
true`;

const centerOf = (find) => `(() => { const el = ${find}; if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

async function open(chrome, width, height, dpr) {
  await chrome.viewport(width, height, dpr);
  await chrome.goto(URL);
  await chrome.eval(SETTINGS);
  await chrome.goto(URL);
  await chrome.sleep(2500);
}

async function click(chrome, find) {
  const point = await chrome.eval(centerOf(find));
  if (!point) throw new Error(`Nothing to click: ${find}`);
  await chrome.click(...point);
  await chrome.sleep(500);
}

const dialogButton = (label) => `[...document.querySelectorAll('[role=dialog] button')].find(b => (b.getAttribute('aria-label') || b.textContent || '').trim() === ${JSON.stringify(label)})`;

/** Settings, Categories, with an AI key saved (the demo takes any key of 8 characters) so the list shows. */
async function openCategories(chrome) {
  await click(chrome, `[...document.querySelectorAll('button')].find(b => /^settings/i.test(b.getAttribute('aria-label') || ''))`);
  await click(chrome, dialogButton("Categories"));
  const hasKeyField = await chrome.eval(`!!document.querySelector('[role=dialog] input')`);
  if (hasKeyField) {
    await click(chrome, `document.querySelector('[role=dialog] input')`);
    await chrome.type("demo-key-12345678");
    await click(chrome, dialogButton("Save key"));
    await chrome.sleep(800);
  }
}

/** A transparent PNG of `html`, which fills a stage of the given size, at `dpr`. */
async function framed(chrome, file, { html, width, height, dpr }) {
  const page = `${TMP}/frame.html`;
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${html}`);
  await chrome.viewport(width, height, dpr);
  await chrome.goto(`file://${page}`);
  await chrome.sleep(400);
  await chrome.shot(file, { clip: { x: 0, y: 0, width, height }, transparent: true });
}

/** The three window buttons, at the top left of a 1560 by 930 window. */
const LIGHTS = [27, 47, 67]
  .map((x, i) => `<i style="position:absolute;left:${x - 6}px;top:21px;width:12px;height:12px;border-radius:50%;background:${["#ff5f57", "#febc2e", "#28c840"][i]};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)"></i>`)
  .join("");

/** The app window as the README shows it: zoomed to 130%, drawn 1560 by 930 units with a narrow margin so it fills the page's width. */
const ZOOM = 1.3;
const APP = { width: Math.round(1560 / ZOOM), height: Math.round(930 / ZOOM), dpr: 1.25 * ZOOM };
const APP_SHADOW = "0 0 0 1px rgba(60,50,40,.16), 0 18px 34px -12px rgba(40,30,20,.36), 0 5px 12px rgba(40,30,20,.14)";

const WINDOW_SHADOW = "0 0 0 1px rgba(60,50,40,.16), 0 34px 70px -14px rgba(40,30,20,.38), 0 10px 22px rgba(40,30,20,.16)";

function toWebp(png, webp, quality = 90) {
  execFileSync("cwebp", ["-quiet", "-q", String(quality), "-alpha_q", "100", "-m", "6", png, "-o", webp]);
}


/** Runs in the page: swaps the app for the "from folders to four places" picture, built from the app's own keys. */
function composeBeforeAfter({ art, shadow }) {
  const group = document.querySelector('[role=group][aria-label="Folders shown"]');
  const rail = document.querySelector('nav[aria-label="Folders"]');
  const compose = document.querySelector('button[aria-label="Compose"]');
  const keys = [...group.querySelectorAll("button")];
  const railIcon = (label) => rail.querySelector(`button[aria-label="${label}"] svg`);
  const style = document.createElement("style");
  style.textContent = "body::before{display:none!important}html,body{background:transparent!important}";
  document.head.append(style);
  document.getElementById("root").style.display = "none";

  const make = (css, parent = document.body, tag = "div") => {
    const el = document.createElement(tag);
    el.style.cssText = css;
    parent.append(el);
    return el;
  };
  const label = "font:600 12px Saira,sans-serif;letter-spacing:.2em;";
  const caption = "font:500 15px Saira,sans-serif;";

  const stage = make("position:absolute;left:0;top:0;width:944px;height:642px");
  const card = make(`position:absolute;left:28px;top:20px;width:888px;height:578px;border-radius:24px;box-shadow:${shadow}`, stage);
  card.className = "plate-1";
  card.style.boxShadow = shadow;

  make(`position:absolute;left:26px;top:24px;${label}color:hsl(var(--muted-foreground))`, card).textContent = "TRADITIONAL EMAIL";
  const mock = make(`position:absolute;left:24px;top:54px;width:284px;height:462px;border-radius:8px;background:url(${art}) 0 0 / 284px 462px no-repeat;box-shadow:var(--raise-1)`, card);
  mock.setAttribute("aria-hidden", "true");
  make(`position:absolute;left:26px;top:534px;${caption}color:hsl(var(--muted-foreground))`, card).textContent = "Folders to build, nest and keep tidy.";

  const arrow = compose.cloneNode(true);
  arrow.classList.remove("ml-1");
  arrow.querySelector("svg").innerHTML = '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>';
  arrow.style.cssText = "position:absolute;left:322px;top:266px;margin:0;transform:scale(1.45)";
  card.append(arrow);

  make(`position:absolute;left:372px;top:24px;${label}color:hsl(var(--sidebar-primary))`, card).textContent = "MINIMAIL";
  make(`position:absolute;left:372px;top:534px;${caption}color:hsl(var(--foreground))`, card).textContent = "Four places. The rest sorts itself.";

  // The folder keys, as the app draws them, enlarged; a label under each.
  const names = ["Inbox", "Archive", "Trash", "Spam"];
  const pill = group.cloneNode(false);
  const sent = ["Sent", "Drafts"].map((name) => {
    const key = keys[1].cloneNode(true);
    key.removeAttribute("aria-pressed");
    key.removeAttribute("data-state");
    key.querySelector("svg").innerHTML = railIcon(name).innerHTML;
    pill.append(key);
    return key;
  });
  const four = group.cloneNode(true);

  const area = { left: 372, width: 490, top: 54, height: 462 };
  const place = (el, top, scale) => {
    const wrap = make("position:absolute;left:0;top:0;transform-origin:0 0", card);
    wrap.append(el);
    const natural = el.getBoundingClientRect();
    wrap.style.transform = `scale(${scale})`;
    wrap.style.left = `${area.left + (area.width - natural.width * scale) / 2}px`;
    wrap.style.top = `${top}px`;
    return natural.height * scale;
  };
  const scale = 2.7;
  const labelsFor = (els, texts, active) => {
    const cardBox = card.getBoundingClientRect();
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const t = make(`position:absolute;transform:translateX(-50%);font:${i === active ? 600 : 500} 16px Saira,sans-serif;color:hsl(var(--${i === active ? "sidebar-primary" : "muted-foreground"}))`, card);
      t.textContent = texts[i];
      t.style.left = `${r.left - cardBox.left + r.width / 2}px`;
      t.style.top = `${r.bottom - cardBox.top + 14}px`;
    });
  };
  const probe = make("position:absolute;visibility:hidden", card);
  probe.append(four.cloneNode(true));
  const h = probe.getBoundingClientRect().height * scale;
  probe.remove();
  const gap = 44, labelH = 34;
  const total = 2 * h + 2 * labelH + gap;
  const top1 = area.top + (area.height - total) / 2;
  place(four, top1, scale);
  place(pill, top1 + h + labelH + gap, scale);
  labelsFor([...four.querySelectorAll("button")], names, 0);
  labelsFor(sent, ["Sent", "Drafts"], -1);
}

/** Runs in the page: swaps the app for the README banner. */
function composeHero({ shadow, logo }) {
  const style = document.createElement("style");
  style.textContent = "body::before{display:none!important}html,body{background:transparent!important}";
  document.head.append(style);
  document.getElementById("root").style.display = "none";
  const make = (css, parent = document.body) => {
    const el = document.createElement("div");
    el.style.cssText = css;
    parent.append(el);
    return el;
  };
  const card = make("position:absolute;left:0;top:0;width:1280px;height:360px;border-radius:36px;overflow:hidden");
  card.className = "plate-1";
  card.style.boxShadow = shadow;
  const mark = document.createElement("img");
  mark.src = logo;
  mark.alt = "";
  mark.style.cssText = "position:absolute;left:555px;top:14px;width:170px;height:170px";
  card.append(mark);
  const name = make("position:absolute;left:0;width:1280px;top:198px;text-align:center;font:700 80px/1 Saira,sans-serif;letter-spacing:-1px;color:hsl(var(--foreground))", card);
  name.textContent = "MiniMail";
  const tag = make("position:absolute;left:0;width:1280px;top:298px;text-align:center;font:400 30px/1 Saira,sans-serif;color:hsl(var(--muted-foreground))", card);
  tag.textContent = "Email made simple";
}

const chrome = await launch();
try {
  await chrome.send("Page.addScriptToEvaluateOnNewDocument", { source: FREEZE_DATE });

  // ---- The categories screen, then the window -------------------------------------------------
  let clip = null;
  if (wants("app") || wants("categories")) {
    await open(chrome, 1560, 950, 1.25);
    await openCategories(chrome);

    if (wants("categories")) {
      await chrome.viewport(1560, 950, 2);
      await click(chrome, `document.querySelector('[role=dialog] button[aria-label="Edit Receipts"]')`);
      await chrome.sleep(600);
      // Hide the close button, show the whole description, and note what the text box is for.
      clip = await chrome.eval(`(() => {
        const dialog = document.querySelector('[role=dialog]');
        const close = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close');
        if (close) close.style.visibility = 'hidden';
        const box = dialog.querySelector('textarea');
        box.rows = Math.ceil(box.scrollHeight / (box.clientHeight / box.rows));
        const heading = [...dialog.querySelectorAll('h2, h3')].find(h => h.textContent.trim() === 'Categories');
        const save = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
        const pill = document.createElement('div');
        pill.setAttribute('data-readme-pill', '');
        pill.textContent = 'Write it in your own words';
        pill.className = 'grain bg-sidebar-primary text-sidebar-primary-foreground shadow-raise-1';
        pill.style.cssText = 'position:fixed;z-index:99;padding:5px 12px;border-radius:999px;font:600 12px Saira;white-space:nowrap;pointer-events:none;';
        document.body.appendChild(pill);
        const r = box.getBoundingClientRect();
        const pw = pill.getBoundingClientRect(), ph = pw.height;
        pill.style.left = (r.right - pw.width - 18) + 'px';
        pill.style.top = (r.bottom - ph / 2) + 'px';
        const h = heading.getBoundingClientRect(), s = save.getBoundingClientRect();
        return { x: 598, y: Math.round(h.top - 26), width: 616, height: Math.round(s.bottom - h.top + 26 + 14) };
      })()`);
      console.log("categories clip", clip);
      await chrome.shot(`${TMP}/categories-raw.png`, { clip });
      await chrome.eval(`document.querySelectorAll('[data-readme-pill]').forEach(el => el.remove()); true`);
      await chrome.viewport(APP.width, APP.height, APP.dpr);
    }

    if (wants("app")) {
      await chrome.viewport(APP.width, APP.height, APP.dpr);
      await chrome.key("Escape", "Escape", 27);
      await chrome.sleep(600);
      await chrome.key("ArrowDown", "ArrowDown", 40);
      await chrome.sleep(400);
      await chrome.move(0, 0);
      await chrome.sleep(300);
      await chrome.shot(`${TMP}/app-raw.png`, { clip: { x: 0, y: 0, width: APP.width, height: APP.height } });
    }

    if (clip) {
      await framed(chrome, `${TMP}/categories.png`, {
        width: clip.width + 80,
        height: clip.height + 90,
        dpr: 2,
        html: `<div style="position:absolute;left:40px;top:30px;width:${clip.width}px;height:${clip.height}px;border-radius:22px;overflow:hidden;box-shadow:${WINDOW_SHADOW}"><img src="categories-raw.png" style="display:block;width:100%;height:100%"></div>`,
      });
      toWebp(`${TMP}/categories.png`, `${OUT}/categories.webp`);
    }
    if (wants("app")) {
      await framed(chrome, `${TMP}/app.png`, {
        width: 1600,
        height: 990,
        dpr: 1.25,
        html: `<div style="position:absolute;left:20px;top:14px;width:1560px;height:930px;border-radius:22px;overflow:hidden;box-shadow:${APP_SHADOW}"><img src="app-raw.png" style="display:block;width:100%;height:100%">${LIGHTS}<div style="position:absolute;inset:0;border-radius:22px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)"></div></div>`,
      });
      toWebp(`${TMP}/app.png`, `${OUT}/app.webp`);
    }
  }

  // ---- From folders to four places ------------------------------------------------------------
  if (wants("before-after")) {
    await open(chrome, 1560, 930, 1.5);
    await chrome.eval(`(${composeBeforeAfter.toString()})(${JSON.stringify({ art: `data:image/svg+xml;base64,${readFileSync(join(here, "readme-images/traditional-email.svg")).toString("base64")}`, shadow: WINDOW_SHADOW })})`);
    await chrome.viewport(944, 642, 1.5);
    await chrome.sleep(500);
    await chrome.shot(`${TMP}/before-after.png`, { clip: { x: 0, y: 0, width: 944, height: 642 }, transparent: true });
    toWebp(`${TMP}/before-after.png`, `${OUT}/before-after.webp`);
  }

  // ---- The banner -----------------------------------------------------------------------------
  if (wants("hero")) {
    await open(chrome, 1560, 930, 1.5);
    await chrome.eval(`(${composeHero.toString()})(${JSON.stringify({ shadow: "inset 2px 2px 0 rgba(255,255,255,.9), inset -3px -3px 6px rgba(72,64,55,.18)", logo: `data:image/svg+xml;base64,${readFileSync(join(here, "../src/renderer/public/minimail.svg")).toString("base64")}` })})`);
    await chrome.viewport(1280, 360, 1.5);
    await chrome.sleep(500);
    await chrome.shot(`${TMP}/hero.png`, { clip: { x: 0, y: 0, width: 1280, height: 360 }, transparent: true });
    toWebp(`${TMP}/hero.png`, `${OUT}/hero.webp`);
  }
} finally {
  await chrome.close();
}
