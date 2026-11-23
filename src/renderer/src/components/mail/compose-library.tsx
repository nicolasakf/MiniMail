import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/core";
import { ArrowLeft, Code2, Pencil, PenLine, Plus, Trash2 } from "lucide-react";

import type { ComposeLibrary } from "@shared/compose-library";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cleanEditorHtml } from "@/lib/rich-compose";

import { ToolButton } from "./composer-ui";
import { RichEditor } from "./rich-editor";
import { noteShownError } from "@/lib/events";

export type Signature = ComposeLibrary["signatures"][number];

/** A signature being written: no id yet for a new one. */
export interface SignatureDraft {
  id: string | null;
  name: string;
  html: string;
}

/** The limits the stored library enforces (see `composeLibrarySchema`). */
const MAX_SIGNATURES = 50;
const MAX_HTML = 100_000;
/** What is left of a body once tags and blanks are gone; a picture still counts as something. */
const visibleContent = (html: string) => html.replace(/<(?!img\b)[^>]*>|&nbsp;|\s/gi, "");

/** The signatures kept on this computer (encrypted, with the drafts) and the account's share of them. */
export function useSignatureLibrary(accountId: string, onError: (message: string) => void) {
  const [library, setLibrary] = useState<ComposeLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });

  useEffect(() => {
    let live = true;
    api.composeLibrary.get().then(
      (value) => {
        if (live) setLibrary(value);
      },
      (reason: unknown) => {
        if (live) report.current(`Could not load signatures: ${String(reason)}`);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const write = useCallback(async (next: ComposeLibrary): Promise<boolean> => {
    setBusy(true);
    try {
      setLibrary(await api.composeLibrary.set(next));
      report.current("");
      return true;
    } catch (reason) {
      report.current(reason instanceof Error ? reason.message : String(reason));
      noteShownError("Could not save signatures and templates", reason);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(
    async (draft: SignatureDraft): Promise<boolean> => {
      if (!library || !accountId || busy) return false;
      if (!draft.id && library.signatures.length >= MAX_SIGNATURES) {
        report.current(`Keep up to ${MAX_SIGNATURES} signatures.`);
        return false;
      }
      const signatures = draft.id
        ? library.signatures.map((item) => (item.id === draft.id ? { ...item, name: draft.name, html: draft.html } : item))
        : [...library.signatures, { id: crypto.randomUUID(), name: draft.name, accountId, html: draft.html }];
      return write({ signatures });
    },
    [accountId, busy, library, write],
  );

  const remove = useCallback(
    async (id: string) => {
      if (library && !busy) await write({ signatures: library.signatures.filter((item) => item.id !== id) });
    },
    [busy, library, write],
  );

  return {
    loaded: library !== null,
    busy,
    signatures: library?.signatures.filter((item) => item.accountId === accountId) ?? [],
    save,
    remove,
  };
}

type MenuAction = { type: "insert"; signature: Signature } | { type: "edit"; draft: SignatureDraft };

/** Picks a signature to insert, or starts writing, editing or removing one. */
export function SignatureMenu({ library, disabled, onInsert, onEdit }: {
  library: ReturnType<typeof useSignatureLibrary>;
  disabled: boolean;
  onInsert: (html: string) => void;
  onEdit: (draft: SignatureDraft) => void;
}) {
  const { signatures } = library;
  // What was chosen runs once the menu has closed and given focus back, or that hand-back would
  // take focus away from whatever the choice just focused (the editor, the sheet).
  const chosen = useRef<MenuAction | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolButton label="Signature" disabled={disabled || !library.loaded || library.busy}>
          <PenLine />
        </ToolButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-80 min-w-56 overflow-y-auto"
        onCloseAutoFocus={(event) => {
          const action = chosen.current;
          chosen.current = null;
          if (!action) return;
          event.preventDefault();
          if (action.type === "insert") onInsert(action.signature.html);
          else onEdit(action.draft);
        }}
      >
        {signatures.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => { chosen.current = { type: "insert", signature: item }; }}>
            <PenLine className="text-muted-foreground" />
            <span className="min-w-0 truncate">{item.name}</span>
          </DropdownMenuItem>
        ))}
        {signatures.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => { chosen.current = { type: "edit", draft: { id: null, name: "", html: "" } }; }}>
          <Plus />New signature…
        </DropdownMenuItem>
        {signatures.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Pencil />Manage</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-48">
              {signatures.map((item) => (
                <DropdownMenuItem key={`edit-${item.id}`}
                  onSelect={() => { chosen.current = { type: "edit", draft: { id: item.id, name: item.name, html: item.html } }; }}>
                  <Pencil /><span className="min-w-0 truncate">Edit {item.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {signatures.map((item) => (
                <DropdownMenuItem key={`remove-${item.id}`} className="text-muted-foreground" onSelect={() => void library.remove(item.id)}>
                  <Trash2 /><span className="min-w-0 truncate">Remove {item.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Writes or edits one signature, over the composer's own area rather than in a window of its own:
 * a second modal on top of the composer is what used to leave the page unclickable. Every saved
 * body goes through the same sanitizer as the composer's, so what is stored is what can be sent.
 */
export function SignatureSheet({ draft, busy, onCancel, onSave }: {
  draft: SignatureDraft;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: SignatureDraft) => void;
}) {
  const editor = useRef<Editor | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [name, setName] = useState(draft.name);
  const [html, setHtml] = useState(() => cleanEditorHtml(draft.html, true));
  const [source, setSource] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [error, setError] = useState("");

  const toggleSource = () => {
    if (source) {
      // The visual editor mounts again from `html`, so the cleaned source is all it needs.
      setHtml(cleanEditorHtml(sourceText, true));
      setSource(false);
    } else {
      setSourceText(html);
      setSource(true);
    }
    setError("");
  };

  const save = () => {
    if (busy) return;
    const body = source ? cleanEditorHtml(sourceText, true) : html;
    if (!name.trim()) return setError("Give the signature a name.");
    if (!visibleContent(body)) return setError("Add some content to the signature.");
    if (body.length > MAX_HTML) return setError("This signature is too large. Use smaller or fewer images.");
    onSave({ id: draft.id, name: name.trim(), html: body });
  };

  return (
    <section
      role="region"
      aria-label={draft.id ? "Edit signature" : "New signature"}
      className="absolute inset-x-0 bottom-0 top-12 z-30 flex flex-col bg-background"
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          // The composer behind this sheet sends on ⌘↵; here it saves.
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 edge-b px-3">
        <ToolButton label="Back" className="size-8" onClick={onCancel}><ArrowLeft /></ToolButton>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{draft.id ? "Edit signature" : "New signature"}</h3>
        <Button type="button" variant="ghost" className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
          aria-pressed={source} onClick={toggleSource}>
          <Code2 className="size-3.5" />{source ? "Visual editor" : "Edit HTML"}
        </Button>
        <Button type="button" disabled={busy} onClick={save}
          className="h-8 rounded-lg bg-sidebar-primary px-3.5 text-sm text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
          Save
        </Button>
      </div>

      <div className="flex items-center gap-3 edge-b px-5">
        <label htmlFor="signature-name" className="w-12 shrink-0 text-[13px] text-muted-foreground">Name</label>
        <input id="signature-name" autoFocus value={name} maxLength={80} placeholder="Work, Personal…"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          onChange={(event) => { setName(event.target.value); setError(""); }} />
      </div>

      {/* The toolbar is placed here by the editor; menus open downward from this top edge. */}
      <div ref={setToolbarHost} className="mail-format-host shrink-0 edge-b empty:hidden" />

      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
        {source ? (
          <textarea aria-label="Signature HTML" spellCheck={false} value={sourceText} maxLength={MAX_HTML}
            placeholder={"<p>Best regards,<br><b>Your name</b></p>"}
            className="block h-full min-h-[220px] w-full resize-none bg-transparent px-5 py-4 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
            onChange={(event) => { setSourceText(event.target.value); setError(""); }} />
        ) : (
          <RichEditor editorRef={editor} overlayRef={overlay} scrollRef={scroll} initialText="" initialHtml={html}
            autoFocus={false} showToolbar disabled={busy} compact onError={setError}
            label="Signature" placeholder="Write your signature…" toolbarHost={toolbarHost}
            onChange={(value) => { setHtml(value); setError(""); }} onSubmit={save} onEscape={onCancel} />
        )}
      </div>
      <div ref={overlay} className="relative h-0" />

      {(error || source) && (
        <p role={error ? "alert" : undefined}
          className={error ? "shrink-0 edge-t px-5 py-2.5 text-[13px] text-destructive" : "shrink-0 edge-t px-5 py-2.5 text-xs text-muted-foreground"}>
          {error || "Scripts and unsupported markup are removed when you save."}
        </p>
      )}
    </section>
  );
}
