import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { Editor } from "@tiptap/core";
import { ALargeSmall, Maximize2, Minimize2, Minus, Paperclip, SquareArrowOutUpRight, Trash2, X } from "lucide-react";

import type { Account } from "@shared/types";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ComposeSeed } from "@/lib/compose";
import { cleanEditorHtml } from "@/lib/rich-compose";
import { cn } from "@/lib/utils";

import { SignatureMenu, SignatureSheet, useSignatureLibrary, type SignatureDraft } from "./compose-library";
import { ComposerFields } from "./composer-fields";
import { AttachmentList, DropOverlay, ErrorNotice, MinimizedBar, QuotedText, ScheduleNotice, SendButton } from "./composer-parts";
import { useComposerSession } from "./composer-session";
import { ToolButton } from "./composer-ui";
import { RichEditor } from "./rich-editor";

const TITLES: Record<ComposeSeed["mode"], string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

interface ComposerProps {
  seed: ComposeSeed;
  accounts: readonly Account[];
  /** Called once the message was sent, kept as a draft or moved to its own window. */
  onClose: () => void | Promise<void>;
  /** Fills a window of its own instead of floating over the mail. */
  detached?: boolean;
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
}

/**
 * The message composer. It floats over the mail instead of blocking it: a modal dialog traps
 * focus, locks the page and stacks its menus in layers that can fail to unwind, which is how the
 * page used to be left unclickable after closing it. Here the only things that take over are the
 * menus themselves, and each one closes on its own.
 *
 * Replies arrive with the quoted original folded under an ellipsis, and a forward carries the
 * forwarded message in its body; everything stays editable. Closing it (the close button or Esc)
 * keeps what was written as a draft.
 */
export function Composer({ seed, accounts, onClose, detached, minimized, onMinimizedChange }: ComposerProps) {
  const session = useComposerSession({ seed, accounts, onClose });
  const { fields, set, locked, error, setError } = session;

  const panel = useRef<HTMLElement>(null);
  const editor = useRef<Editor | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pickingTime, setPickingTime] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const signatures = useSignatureLibrary(fields.accountId, setError);

  const title = fields.subject.trim() || TITLES[seed.mode];
  // The demo backend cannot queue mail for later.
  const canSchedule = !api.system.demo;

  // Where focus was when the composer opened, so closing it puts the user back there.
  const [returnFocusTo] = useState(() => (detached ? null : document.activeElement));
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        // A strict-mode rehearsal unmounts and remounts at once; the panel is still on screen then.
        if (panel.current?.isConnected) return;
        if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected && returnFocusTo !== document.body) {
          returnFocusTo.focus({ preventScroll: true });
        }
      });
    },
    [returnFocusTo],
  );

  // Coming back from minimized, the user wants to type: the To box if nobody is addressed yet.
  const wasMinimized = useRef(minimized);
  useEffect(() => {
    if (wasMinimized.current && !minimized) {
      requestAnimationFrame(() => {
        if (fields.to.length === 0) panel.current?.querySelector<HTMLInputElement>('input[aria-label="To"]')?.focus();
        else editor.current?.commands.focus("end");
      });
    }
    wasMinimized.current = minimized;
  }, [fields.to.length, minimized]);

  const insertSignature = (html: string) => {
    const current = editor.current;
    if (!current) return;
    const content = cleanEditorHtml(html, true);
    if (current.isEmpty) current.chain().focus().insertContent(content).run();
    else current.chain().focus("end").insertContentAt(current.state.doc.content.size, `<p></p>${content}`).run();
  };

  const setTime = (time: number | undefined) => {
    set.setSendAt(time);
    setPickingTime(false);
  };

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");

  // Esc and ⌘↵ only reach the composer from inside it. Whenever the focused element goes away
  // (a button that swaps itself for another, a strip that closes, a form that unlocks) focus falls
  // to the page, so these put it back, and the shortcuts also work while nothing at all is focused.
  const lastFocus = useRef<HTMLElement | null>(null);
  const focusEditor = () => {
    // After the render that removes whatever held focus, and past any `inert` still on its way off.
    requestAnimationFrame(() => editor.current?.commands.focus());
  };
  const wasLocked = useRef(false);
  useEffect(() => {
    const nothingFocused = !document.activeElement || document.activeElement === document.body;
    if (wasLocked.current && !locked && nothingFocused) {
      const target = lastFocus.current?.isConnected ? lastFocus.current : panel.current?.querySelector<HTMLElement>(".mail-editor");
      target?.focus();
    }
    wasLocked.current = locked;
  }, [locked]);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirmDiscard) discardButton.current?.focus();
    wasConfirming.current = confirmDiscard;
  }, [confirmDiscard]);
  const keyWithNothingFocused = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.target !== document.body) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void session.requestClose();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void session.send();
    }
  });
  useEffect(() => {
    if (minimized) return;
    const listener = (event: KeyboardEvent) => keyWithNothingFocused(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [minimized]);

  return (
    <>
      {minimized && (
        <MinimizedBar title={title} locked={locked} onRestore={() => onMinimizedChange?.(false)}
          onClose={() => void session.requestClose()} />
      )}
      {/* Minimizing only hides the panel: the editor keeps its text, undo history and caret. */}
      <section
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        data-composer
        className={cn(
          minimized ? "hidden" : "flex",
          "flex-col bg-background text-foreground",
          detached
            ? "relative h-dvh w-full"
            : cn(
                "corner-squircle fixed z-40 border border-border shadow-[0_24px_70px_-12px_rgb(0_0_0/0.55)] duration-200 animate-in fade-in-0 slide-in-from-bottom-3",
                expanded
                  ? "inset-x-6 inset-y-6 mx-auto max-w-[1040px]"
                  : "bottom-4 right-4 h-[min(640px,calc(100dvh-32px))] w-[min(660px,calc(100vw-32px))]",
              ),
        )}
        onFocus={(event) => {
          if (event.target instanceof HTMLElement) lastFocus.current = event.target;
        }}
        onKeyDown={(event) => {
          // A menu, a suggestion list or a toolbar panel that used the key has marked it handled.
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            void session.requestClose();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void session.send();
          }
        }}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          dragDepth.current = 0;
          setDragging(false);
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          void session.addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {!detached && (
          <header className="flex h-12 shrink-0 items-center gap-0.5 pl-5 pr-2.5">
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h2>
            <ToolButton label="Minimize" className="size-7 rounded-lg" disabled={locked}
              onClick={() => onMinimizedChange?.(true)}><Minus /></ToolButton>
            <ToolButton label={expanded ? "Compact view" : "Expand"} className="size-7 rounded-lg"
              onClick={() => setExpanded((value) => !value)}>
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </ToolButton>
            {!api.system.demo && (
              <ToolButton label="Open in a new window" className="size-7 rounded-lg" disabled={locked}
                onClick={() => void session.detach()}><SquareArrowOutUpRight /></ToolButton>
            )}
            <ToolButton label="Close" className="size-7 rounded-lg" disabled={locked}
              onClick={() => void session.requestClose()}><X /></ToolButton>
          </header>
        )}

        {/* Locked while it saves, sends or moves, and while the signature sheet is over it. */}
        <div inert={locked || signatureDraft !== null} className="flex min-h-0 flex-1 flex-col">
          <ComposerFields session={session} accounts={accounts} focusTo={seed.to.length === 0} />

          <div
            ref={scroll}
            className="min-h-0 flex-1 overflow-y-auto"
            onMouseDown={(event) => {
              // The empty space under the text is part of the page: clicking it types there.
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              editor.current?.commands.focus("end");
            }}
          >
            <RichEditor
              editorRef={editor}
              overlayRef={overlay}
              scrollRef={scroll}
              initialText={seed.body}
              initialHtml={seed.bodyHtml}
              autoFocus={seed.to.length > 0}
              showToolbar={showToolbar}
              disabled={locked}
              compact={Boolean(fields.quoted)}
              toolbarHost={toolbarHost}
              onError={setError}
              onChange={(html) => { session.bodyHtml.current = html; }}
              onSubmit={() => void session.send()}
              onEscape={() => void session.requestClose()}
            />
            {fields.quoted && <QuotedText value={fields.quoted} onChange={set.setQuoted} />}
          </div>

          {/* Outside the scrolling text, so a long message never pushes the attachments out of sight. */}
          <AttachmentList
            files={fields.attachments}
            onRemove={(index) => {
              session.removeAttachment(index);
              focusEditor();
            }}
          />

          <ErrorNotice message={error} onDismiss={() => { setError(null); focusEditor(); }} />
          <ScheduleNotice
            sendAt={fields.sendAt}
            picking={pickingTime}
            onChange={() => setPickingTime(true)}
            onSet={(time) => { setTime(time); focusEditor(); }}
            onCancelPick={() => { setPickingTime(false); focusEditor(); }}
            onClear={() => { setTime(undefined); focusEditor(); }}
          />

          {/* The text bubble floats from here, and the formatting bar, when shown, sits in the next box. */}
          <div ref={overlay} className="relative z-10 h-0" />
          <div ref={setToolbarHost} className="mail-format-host mail-format-up shrink-0 border-t border-border/50 empty:hidden" />

          <footer
            className="flex shrink-0 items-center gap-1 border-t border-border/50 px-3 py-2.5"
            onKeyDown={(event) => {
              if (event.key === "Escape" && confirmDiscard) {
                event.preventDefault();
                setConfirmDiscard(false);
              }
            }}
          >
            <SendButton
              sendAt={fields.sendAt}
              sending={session.phase === "sending"}
              disabled={locked}
              canSchedule={canSchedule}
              onSend={() => void session.send()}
              onSchedule={setTime}
              onClear={() => setTime(undefined)}
              onPick={() => setPickingTime(true)}
            />
            <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
            <ToolButton label="Formatting options" aria-pressed={showToolbar} onClick={() => setShowToolbar((value) => !value)}>
              <ALargeSmall />
            </ToolButton>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void session.addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <ToolButton label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip /></ToolButton>
            <SignatureMenu library={signatures} disabled={locked} onInsert={insertSignature} onEdit={setSignatureDraft} />
            <span className="flex-1" />
            {confirmDiscard ? (
              <div className="flex items-center gap-1 text-[13px]">
                <span className="mr-1 text-muted-foreground">Discard this draft?</span>
                <Button type="button" variant="ghost" autoFocus className="h-8 rounded-lg px-2.5 text-xs" onClick={() => setConfirmDiscard(false)}>Keep</Button>
                <Button type="button" className="h-8 rounded-lg bg-red-600 px-2.5 text-xs text-white hover:bg-red-600/90"
                  onClick={() => void session.discard()}>Discard</Button>
              </div>
            ) : (
              <ToolButton ref={discardButton} label="Discard draft"
                onClick={() => (session.hasContent() ? setConfirmDiscard(true) : void session.discard())}>
                <Trash2 />
              </ToolButton>
            )}
          </footer>
        </div>

        {signatureDraft && (
          <SignatureSheet
            draft={signatureDraft}
            busy={signatures.busy}
            onCancel={() => { setSignatureDraft(null); focusEditor(); }}
            onSave={(next) => void signatures.save(next).then((saved) => {
              if (!saved) return;
              setSignatureDraft(null);
              focusEditor();
            })}
          />
        )}
        {dragging && <DropOverlay />}
      </section>
    </>
  );
}
