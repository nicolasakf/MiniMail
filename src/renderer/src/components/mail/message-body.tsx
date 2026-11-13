import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DOMPurify from "dompurify";
import { ImageOff, ShieldCheck } from "lucide-react";

import { autoLoadsImages, trustKey } from "@shared/trust";
import type { MessageDetail } from "@shared/types";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { trustSender, untrustSender, useTrustedSenders } from "@/lib/trusted-senders";

const REMOTE_CONTENT = /(?:src|background)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;
const EXTERNAL_LINK = /^(https?:|mailto:)/i;
const URL_PATTERN = /(https?:\/\/[^\s<>"')]+)/g;

/**
 * Removes anything that can run code or navigate. Scripts would be blocked by the
 * frame's sandbox and CSP anyway; stripping them here is defense in depth.
 */
export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      // Form controls could fake a login box inside a message.
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
    ],
    FORBID_ATTR: ["srcset"],
    ALLOW_DATA_ATTR: false,
    // Keeps leading <style> blocks, which the HTML parser would otherwise hoist out of the body.
    FORCE_BODY: true,
  });
}

/** Wraps sanitized HTML in a document whose CSP blocks everything but inline styles and images. */
function buildDocument(body: string, allowRemote: boolean): string {
  const images = allowRemote ? "data: https: http:" : "data:";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src data:;">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#fff;color:#1f2328;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
  body{padding:16px}
  img{max-width:100%;height:auto}
  a{color:#0b57d0}
  table{max-width:100%}
  blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a}
</style></head><body>${body}</body></html>`;
}

type Sender = Pick<MessageDetail, "from" | "authenticated">;

function HtmlBody({ html, from, authenticated }: { html: string } & Sender) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [clicked, setClicked] = useState(false);
  const trusted = useTrustedSenders();

  const isTrusted = trusted !== null && trusted.has(trustKey(from.email));
  const autoLoad = trusted !== null && autoLoadsImages(trusted, from, authenticated);
  const allowRemote = clicked || autoLoad;

  const clean = useMemo(() => sanitizeEmailHtml(html), [html]);
  const hasRemote = useMemo(() => REMOTE_CONTENT.test(clean), [clean]);
  const document_ = useMemo(() => buildDocument(clean, allowRemote), [clean, allowRemote]);

  /** Sizes the frame to its content and routes link clicks to the system browser. */
  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    const resize = () =>
      setHeight(Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(doc.documentElement);
    observer.observe(doc.body);
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", resize));

    doc.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (href && EXTERNAL_LINK.test(href)) void api.system.openExternal(href);
    });
  }, []);

  useEffect(() => {
    setHeight(160);
  }, [document_]);

  return (
    <div className="space-y-2">
      {hasRemote && !allowRemote && trusted !== null && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <ImageOff className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">
            {isTrusted
              ? `You trust ${from.email}, but the mail server could not verify this message came from them, so images stay blocked.`
              : "Remote images are blocked so senders cannot track when you open this."}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => {
              setClicked(true);
              // Only a verified message can earn trust; a forged one must not vouch for the address.
              if (authenticated === true && !isTrusted) trustSender(from.email);
            }}
          >
            Load images
          </Button>
        </div>
      )}
      {hasRemote && autoLoad && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span className="flex-1">Images load automatically for {from.email}.</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => {
              setClicked(false);
              untrustSender(from.email);
            }}>
            Stop trusting
          </Button>
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Message content"
        // allow-same-origin lets us measure the content; with no allow-scripts nothing inside can run.
        sandbox="allow-same-origin"
        scrolling="no"
        srcDoc={document_}
        onLoad={handleLoad}
        className="w-full overflow-hidden rounded-lg border-0 bg-white"
        style={{ height }}
      />
    </div>
  );
}

function PlainBody({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            className="text-sidebar-ring underline underline-offset-2"
            onClick={(event) => {
              event.preventDefault();
              void api.system.openExternal(part);
            }}
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </div>
  );
}

/** Renders a message as sandboxed HTML when it has any, otherwise as plain text. */
export function MessageBody({ message }: { message: Pick<MessageDetail, "html" | "text" | "from" | "authenticated"> }) {
  if (message.html) return <HtmlBody html={message.html} from={message.from} authenticated={message.authenticated} />;
  return <PlainBody text={message.text ?? ""} />;
}
