import DOMPurify from "dompurify";

import { MAX_INLINE_IMAGE_BYTES, type DraftAttachment } from "@shared/types";

const TAGS = [
  "p", "div", "br", "span", "b", "strong", "i", "em", "u", "s", "strike", "del", "a",
  "mark", "h1", "h2", "ol", "ul", "li", "blockquote", "hr", "img", "table", "thead",
  "tbody", "tfoot", "tr", "td", "th",
];

const CSS = new Map<string, RegExp>([
  ["color", /^(?:#[\da-f]{3,8}|rgba?\([\d.,% /]+\)|[a-z]+)$/i],
  ["background-color", /^(?:#[\da-f]{3,8}|rgba?\([\d.,% /]+\)|[a-z]+)$/i],
  ["font-family", /^[\w ,"'\u00a0-\uffff-]{1,100}$/u],
  ["font-size", /^(?:\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)|small|medium|large)$/i],
  ["margin-left", /^\d{1,3}px$/],
  ["text-decoration", /^(?:underline|line-through)$/],
  ["text-align", /^(?:left|center|right|justify)$/],
  ["font-weight", /^(?:bold|[1-9]00)$/],
  ["font-style", /^italic$/],
]);

export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const IMAGE_DATA = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/]+={0,2})$/i;

export function base64Bytes(content: string): number {
  return Math.floor(content.length * 3 / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
}

export function imageData(src: string) {
  const match = IMAGE_DATA.exec(src);
  return match && base64Bytes(match[2]) <= MAX_INLINE_IMAGE_BYTES
    ? { contentType: match[1].toLowerCase(), contentBase64: match[2] }
    : null;
}

export function webUrl(value: string, allowMail = true): string | null {
  const input = value.trim();
  if (!input || /\s/.test(input)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "https:" || url.protocol === "http:" || (allowMail && url.protocol === "mailto:"))
      && !url.username && !url.password ? url.href : null;
  } catch {
    // expected: a pasted or typed link that is not a valid address is simply not a link.
    return null;
  }
}

/** Clipboard and saved drafts are parsed as inert HTML before any node enters the live editor. */
export function cleanEditorHtml(html: string, allowRemoteImages: boolean): string {
  const template = document.createElement("template");
  template.content.append(DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ["href", "src", "alt", "title", "style", "colspan", "rowspan", "start", "width", "height"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  }));
  for (const element of template.content.querySelectorAll<HTMLElement>("[style]")) {
    const declarations = Array.from(CSS).flatMap(([name, pattern]) => {
      const value = element.style.getPropertyValue(name).trim();
      return pattern.test(value) ? [`${name}: ${value}`] : [];
    });
    if (declarations.length) element.setAttribute("style", declarations.join("; "));
    else element.removeAttribute("style");
  }
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    if (imageData(src) || (allowRemoteImages && /^https?:\/\//i.test(src) && webUrl(src, false))) continue;
    image.replaceWith(document.createTextNode(image.alt));
  }
  return template.innerHTML;
}

/**
 * Plain text as paragraphs, one per line. A blank line is an empty paragraph, not one holding a
 * line break: with a break in it the editor never counts a blank message as empty, so its
 * placeholder stays hidden.
 */
export function plainEditorHtml(text: string): string {
  return text.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Keep useful structure for mail clients showing the plain-text alternative. */
export function plainBody(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const children = () => Array.from(node.childNodes, text).join("");
    switch (node.tagName) {
      case "BR": return "\n";
      case "P":
      case "H1":
      case "H2": return node.innerHTML === "<br>" ? "\n" : `${children()}\n`;
      case "UL":
      case "OL":
        return Array.from(node.children, (item, index) => {
          const prefix = node instanceof HTMLOListElement ? `${(node.start || 1) + index}. ` : "• ";
          return `${prefix}${text(item).trimEnd().replaceAll("\n", "\n   ")}\n`;
        }).join("");
      case "BLOCKQUOTE": return children().trimEnd().split("\n").map((line) => `> ${line}\n`).join("");
      case "A": {
        const label = children();
        const href = node.getAttribute("href");
        return href && label.trim() && href.replace(/\/$/, "") !== label.trim() ? `${label} (${href})` : label;
      }
      case "IMG": return `[${(node as HTMLImageElement).alt || "Image"}]\n`;
      case "HR": return "\n---\n";
      case "TR": return `${Array.from(node.children, (cell) => text(cell).trim()).join("\t")}\n`;
      default: return children();
    }
  };
  return Array.from(template.content.childNodes, text).join("").replace(/\n$/, "").replaceAll("\u00a0", " ");
}

export function prepareRichBody(html: string, quoted: string) {
  const template = document.createElement("template");
  template.innerHTML = cleanEditorHtml(html, true);
  const inline: DraftAttachment[] = [];
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const data = imageData(src);
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    if (!data) continue;
    const contentId = `${crypto.randomUUID()}@minimail.local`;
    const ext = data.contentType.split("/")[1];
    inline.push({ ...data, filename: image.alt || `image.${ext}`, contentId });
    image.setAttribute("src", `cid:${contentId}`);
  }
  // Basic table and paragraph styling travels with the message.
  template.content.querySelectorAll<HTMLElement>("p").forEach((p) => {
    p.style.marginTop = "0";
    p.style.marginBottom = "0";
    if (!p.hasChildNodes()) p.append(document.createElement("br"));
  });
  template.content.querySelectorAll("table").forEach((table) => {
    table.style.borderCollapse = "collapse";
    table.style.maxWidth = "100%";
  });
  template.content.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    cell.style.border = "1px solid #9ca3af";
    cell.style.padding = "6px 10px";
    cell.style.minWidth = "32px";
  });
  const quote = quoted.trim() ? `<blockquote style="margin:16px 0 0;padding-left:12px;border-left:2px solid #9ca3af">${escapeHtml(quoted).replace(/\r?\n/g, "<br>")}</blockquote>` : "";
  return { html: template.innerHTML + quote, inline };
}
