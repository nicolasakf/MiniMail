import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Extension, type Editor } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, ChevronDown, Droplet, Eraser, Heading1, Highlighter, ImagePlus, IndentDecrease,
  IndentIncrease, Italic, Link2, List, ListOrdered, Quote, Strikethrough, Table2, Underline, X,
} from "lucide-react";

import { MAX_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS, MAX_INLINE_IMAGE_BYTES } from "@shared/types";

import { useGhostCompletion, type GhostCompletion } from "@/hooks/use-ghost-completion";
import { acceptSuggestion, dismissSuggestion, GhostText } from "@/lib/ghost-text";
import { base64Bytes, cleanEditorHtml, imageData, INLINE_IMAGE_TYPES, plainEditorHtml, webUrl } from "@/lib/rich-compose";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/events";

const Indent = Extension.create({
  name: "mailIndent",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Math.min(6, Math.max(0, Math.round((parseInt(element.style.marginLeft, 10) || 0) / 24))),
          renderHTML: ({ indent }) => indent ? { style: `margin-left: ${indent * 24}px` } : {},
        },
      },
    }];
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    code: false,
    codeBlock: false,
    link: { openOnClick: false, enableClickSelection: true, defaultProtocol: "https" },
  }),
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  TableKit,
  Image.configure({ allowBase64: true }),
  Indent,
  GhostText,
];

const fonts = ["Arial", "Georgia", "Helvetica", "Times New Roman", "Verdana", "Courier New", "Trebuchet MS"];
const sizes = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36];
const colors = ["#171717", "#737373", "#ffffff", "#dc2626", "#ea580c", "#a16207", "#15803d", "#0369a1", "#1d4ed8", "#7e22ce"];
const highlights = ["#fef08a", "#fed7aa", "#fecaca", "#fbcfe8", "#e9d5ff", "#bfdbfe", "#a7f3d0", "#d9f99d"];

type Panel = "link" | "image" | "text color" | "highlight color" | "text style" | "font" | "size" | "table";

function Tool({ label, pressed, disabled, expanded, onClick, children }: {
  label: string; pressed?: boolean; disabled?: boolean; expanded?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={pressed} aria-expanded={expanded}
      disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}
      className="mail-format-tool">
      {children}
    </button>
  );
}

function ToolOption({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="mail-format-option" onClick={onClick}
      onMouseDown={(event) => event.preventDefault()} disabled={disabled}>{children}</button>
  );
}

function indent(editor: Editor, direction: 1 | -1) {
  if (editor.isActive("listItem")) {
    if (direction === 1) editor.chain().focus().sinkListItem("listItem").run();
    else editor.chain().focus().liftListItem("listItem").run();
    return;
  }
  const { selection, tr } = editor.state;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
    const next = Math.max(0, Math.min(6, (node.attrs.indent ?? 0) + direction));
    if (next !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  editor.commands.focus();
}

async function insertImages(editor: Editor, files: File[], onError: (error: string) => void) {
  for (const file of files) {
    if (!INLINE_IMAGE_TYPES.some((type) => type === file.type) || file.size > MAX_INLINE_IMAGE_BYTES || !file.size) {
      onError("Use a PNG, JPEG, GIF or WebP image up to 2 MB.");
      continue;
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (editor.isDestroyed || !editor.isEditable) return;
      let bytes = file.size;
      let count = 1;
      editor.state.doc.descendants((node) => {
        const image = node.type.name === "image" ? imageData(node.attrs.src) : null;
        if (image) { bytes += base64Bytes(image.contentBase64); count++; }
      });
      if (count > MAX_DRAFT_ATTACHMENTS || bytes > MAX_ATTACHMENT_BYTES) {
        onError("The message has reached its inline image limit.");
        return;
      }
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    } catch (error) {
      onError(`Could not read ${file.name}.`);
      reportError("compose", `Could not read ${file.name}`, error);
    }
  }
}

function FormatTools({ editor, onError, panel, setPanel }: {
  editor: Editor; onError: (error: string) => void; panel: Panel | null; setPanel: (panel: Panel | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [urlError, setUrlError] = useState("");
  const [tableSize, setTableSize] = useState([0, 0]);
  const upload = useRef<HTMLInputElement>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      link: e.isActive("link"), bulletList: e.isActive("bulletList"), orderedList: e.isActive("orderedList"),
      quote: e.isActive("blockquote"), table: e.isActive("table"), heading: e.isActive("heading"),
      font: e.getAttributes("textStyle").fontFamily as string | undefined,
      size: e.getAttributes("textStyle").fontSize as string | undefined,
      color: e.getAttributes("textStyle").color as string | undefined,
      highlight: e.getAttributes("highlight").color as string | undefined,
    }),
  });
  const close = () => { setPanel(null); editor.commands.focus(); };
  const run = (command: () => unknown) => { setPanel(null); command(); };
  const toggle = (name: Panel) => {
    if (panel === name) return close();
    setUrl(name === "link" ? editor.getAttributes("link").href ?? "" : "");
    setLabel("");
    setUrlError("");
    setTableSize([0, 0]);
    setPanel(name);
  };
  // The keyboard shortcut opens the same URL editor, including when a link already exists.
  useEffect(() => {
    if (panel !== "link" && panel !== "image") return;
    setUrl(panel === "link" ? editor.getAttributes("link").href ?? "" : "");
    setLabel("");
    setUrlError("");
    const frame = requestAnimationFrame(() => urlField.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editor, panel]);

  const clear = () => run(() => editor.chain().focus().unsetAllMarks().clearNodes().resetAttributes("paragraph", "indent").run());
  const submit = () => {
    const href = webUrl(url, panel === "link");
    if (!href) return setUrlError(panel === "link" ? "Enter a web or mailto link." : "Enter an image or media URL.");
    if (panel === "image") {
      // Email clients block interactive embeds. Keep a playable URL as a regular link.
      const image = /\.(?:png|jpe?g|gif|webp|avif|bmp)(?:[?#]|$)/i.test(href);
      run(() => image
        ? editor.chain().focus().setImage({ src: href, alt: label.trim() || "Image" }).run()
        : editor.chain().focus().insertContent({ type: "text", text: label.trim() || href, marks: [{ type: "link", attrs: { href } }] }).run());
      return;
    }
    if (editor.state.selection.empty && !state.link) {
      run(() => editor.chain().focus().insertContent({ type: "text", text: label.trim() || href, marks: [{ type: "link", attrs: { href } }] }).run());
    } else {
      run(() => editor.chain().focus().extendMarkRange("link").setLink({ href }).run());
    }
  };

  const menu = (name: Panel, control: ReactNode, content: ReactNode, pressed?: boolean) => (
    <div className="relative">
      <Tool label={name[0].toUpperCase() + name.slice(1)} expanded={panel === name} pressed={pressed}
        onClick={() => toggle(name)}>{control}</Tool>
      {panel === name && <div className="mail-format-panel" aria-label={name}>{content}</div>}
    </div>
  );
  const palette = (values: string[], selected: string | undefined, apply: (value: string) => void, reset: () => void) => (
    <>
      <div className="grid grid-cols-5 gap-1 p-1">
        {values.map((color) => (
          <button key={color} type="button" aria-label={color} title={color} aria-pressed={color === selected}
            className="size-6 rounded border border-foreground/20 hover:ring-2 hover:ring-ring aria-pressed:ring-2 aria-pressed:ring-ring"
            style={{ backgroundColor: color }} onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => apply(color))} />
        ))}
      </div>
      <ToolOption onClick={() => run(reset)}>Default</ToolOption>
    </>
  );

  const urlFields = (
    <div className="grid w-64 gap-2 p-2">
      {panel === "image" && (
        <ToolOption onClick={() => upload.current?.click()}>Choose an image file…</ToolOption>
      )}
      <input ref={urlField} type="text" inputMode="url" aria-label={panel === "image" ? "Image or media URL" : "Link URL"}
        placeholder="Paste a URL" value={url}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); submit(); }
        }}
        onChange={(event) => { setUrl(event.target.value); setUrlError(""); }}
        className="rounded border border-border bg-background px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      {(panel === "image" || (editor.state.selection.empty && !state.link)) && (
        <input type="text" aria-label={panel === "image" ? "Description" : "Link text"} placeholder={panel === "image" ? "Description (optional)" : "Link text (optional)"}
          value={label} onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); submit(); }
          }}
          className="rounded border border-border bg-background px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      )}
      {urlError && <p role="alert" className="text-destructive">{urlError}</p>}
      <div className="flex items-center gap-2">
        {panel === "link" && state.link && <ToolOption onClick={() => run(() => editor.chain().focus().extendMarkRange("link").unsetLink().run())}>Remove link</ToolOption>}
        <button type="button" className="ml-auto rounded bg-primary px-2 py-1 text-primary-foreground" onClick={submit}>Apply</button>
        <Tool label="Cancel" onClick={close}><X /></Tool>
      </div>
    </div>
  );

  return (
    <div className="mail-format-bar" role="toolbar" aria-label="Message formatting">
      <Tool label="Bold" pressed={state.bold} onClick={() => run(() => editor.chain().focus().toggleBold().run())}><Bold /></Tool>
      <Tool label="Italic" pressed={state.italic} onClick={() => run(() => editor.chain().focus().toggleItalic().run())}><Italic /></Tool>
      <Tool label="Underline" pressed={state.underline} onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}><Underline /></Tool>
      <Tool label="Strikethrough" pressed={state.strike} onClick={() => run(() => editor.chain().focus().toggleStrike().run())}><Strikethrough /></Tool>
      {menu("link", <Link2 />, urlFields, state.link)}
      {menu("text color", <Droplet style={{ color: state.color }} />, palette(colors, state.color,
        (value) => editor.chain().focus().setColor(value).run(), () => editor.chain().focus().unsetColor().run()))}
      {menu("highlight color", <Highlighter style={{ color: state.highlight }} />, palette(highlights, state.highlight,
        (value) => editor.chain().focus().setHighlight({ color: value }).run(), () => editor.chain().focus().unsetHighlight().run()))}
      <Tool label="Bullet list" pressed={state.bulletList} onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}><List /></Tool>
      <Tool label="Numbered list" pressed={state.orderedList} onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}><ListOrdered /></Tool>
      <Tool label="Quote" pressed={state.quote} onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}><Quote /></Tool>
      <Tool label="Decrease indent" onClick={() => run(() => indent(editor, -1))}><IndentDecrease /></Tool>
      <Tool label="Increase indent" onClick={() => run(() => indent(editor, 1))}><IndentIncrease /></Tool>
      {menu("text style", <Heading1 />, <>
        <ToolOption onClick={() => run(() => editor.chain().focus().setHeading({ level: 1 }).run())}>Heading</ToolOption>
        <ToolOption onClick={() => run(() => editor.chain().focus().setHeading({ level: 2 }).run())}>Subheading</ToolOption>
        <ToolOption onClick={() => run(() => editor.chain().focus().setParagraph().run())}>Body text</ToolOption>
      </>, state.heading)}
      {menu("font", <><span className="max-w-20 truncate">{state.font || "Font"}</span><ChevronDown /></>, <>
        <ToolOption onClick={() => run(() => editor.chain().focus().unsetFontFamily().run())}>Default font</ToolOption>
        {fonts.map((font) => <ToolOption key={font} onClick={() => run(() => editor.chain().focus().setFontFamily(font).run())}>
          <span style={{ fontFamily: font }}>{font}</span>
        </ToolOption>)}
      </>)}
      {menu("size", <>{state.size ? parseFloat(state.size) : 14}<ChevronDown /></>, <>
        <ToolOption onClick={() => run(() => editor.chain().focus().unsetFontSize().run())}>Default</ToolOption>
        {sizes.map((size) => <ToolOption key={size} onClick={() => run(() => editor.chain().focus().setFontSize(`${size}px`).run())}>{size}</ToolOption>)}
      </>)}
      <Tool label="Clear formatting" onClick={clear}><Eraser /></Tool>
      {menu("image", <ImagePlus />, urlFields)}
      {menu("table", <Table2 />, state.table ? (
        <>
          <ToolOption onClick={() => run(() => editor.chain().focus().addRowBefore().run())}>Add row above</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().addRowAfter().run())}>Add row below</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}>Add column left</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}>Add column right</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().toggleHeaderRow().run())}>Toggle header row</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().deleteRow().run())}>Delete row</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().deleteColumn().run())}>Delete column</ToolOption>
          <ToolOption onClick={() => run(() => editor.chain().focus().deleteTable().run())}>Delete table</ToolOption>
        </>
      ) : (
        <div className="p-1">
          <div className="grid grid-cols-10 gap-0.5">
            {Array.from({ length: 100 }, (_, i) => {
              const rows = Math.floor(i / 10) + 1;
              const cols = i % 10 + 1;
              return (
                <button key={i} type="button" aria-label={`Insert table: ${rows} rows, ${cols} columns`}
                  className={cn("size-[15px] rounded-sm border border-border focus-visible:ring-1 focus-visible:ring-ring",
                    rows <= tableSize[0] && cols <= tableSize[1] ? "bg-primary/50" : "bg-muted")}
                  onMouseEnter={() => setTableSize([rows, cols])} onFocus={() => setTableSize([rows, cols])}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(() => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run())} />
              );
            })}
          </div>
          <p className="pt-1 text-center text-muted-foreground">{tableSize[0] ? tableSize.join(" × ") : "Choose table size"}</p>
        </div>
      ))}
      <input ref={upload} type="file" hidden accept={INLINE_IMAGE_TYPES.join(",")} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        close();
        void insertImages(editor, files, onError);
      }} />
    </div>
  );
}

export function RichEditor({ editorRef, overlayRef, scrollRef, initialText, initialHtml, autoFocus, showToolbar, disabled, compact, onError, onChange, label = "Message", placeholder = "Write your message…", toolbarHost, onSubmit, onEscape, completion }: {
  editorRef: React.RefObject<Editor | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  initialText: string; initialHtml?: string; autoFocus: boolean; showToolbar: boolean;
  disabled: boolean; compact: boolean; onError: (error: string) => void; onChange: (html: string) => void;
  label?: string; placeholder?: string;
  /** Runs on ⌘↵ or Ctrl+↵, which would otherwise insert a line break. */
  onSubmit?: () => void;
  /**
   * Runs on Esc. The editor marks that key as handled whatever it does (ProseMirror always does),
   * so the surrounding form could not tell it had not been used; it is passed up instead.
   */
  onEscape?: () => void;
  /**
   * Suggests what comes next as dimmed text after the cursor: Tab keeps it and Esc refuses it (Esc
   * then does not reach `onEscape`). Left out, nothing is suggested.
   */
  completion?: GhostCompletion;
  /**
   * Where the toolbar goes when it is shown in place (not as a bubble over a selection). An
   * element puts it there; null waits for that element to exist; undefined docks it above the text.
   */
  toolbarHost?: HTMLElement | null;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [keyboardToolbar, setKeyboardToolbar] = useState(false);
  const submit = useRef(onSubmit);
  const escape = useRef(onEscape);
  useEffect(() => {
    submit.current = onSubmit;
    escape.current = onEscape;
  });
  const docked = showToolbar || keyboardToolbar;
  const [content] = useState(() => initialHtml === undefined ? plainEditorHtml(initialText) : cleanEditorHtml(initialHtml, true));
  const updatePlaceholder = (editor: Editor) => { editor.view.dom.dataset.empty = String(editor.isEmpty); };
  const editor = useEditor({
    extensions,
    content,
    autofocus: autoFocus ? "start" : false,
    onCreate: ({ editor }) => updatePlaceholder(editor),
    onUpdate: ({ editor }) => { updatePlaceholder(editor); onChange(editor.getHTML()); },
    editorProps: {
      attributes: { class: cn("mail-editor", compact && "mail-editor-compact"), role: "textbox", "aria-label": label, "aria-multiline": "true", "data-placeholder": placeholder },
      transformPastedHTML: (html) => cleanEditorHtml(html, false),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length || !editorRef.current) return false;
        void insertImages(editorRef.current, files, onError);
        return true;
      },
      handleKeyDown: (view, event) => {
        // Tab keeps the suggestion on show, Esc refuses it; with none they do what they always do.
        if (event.isComposing === false) {
          if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && acceptSuggestion(view)) {
            return true;
          }
          if (event.key === "Escape" && dismissSuggestion(view)) return true;
        }
        if (event.key === "Escape" && !event.isComposing && escape.current) {
          escape.current();
          return true;
        }
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
        if (event.key === "Enter" && !event.shiftKey && submit.current) {
          submit.current();
          return true;
        }
        if (!event.shiftKey && event.key.toLowerCase() === "k") {
          if (editorRef.current?.state.selection.empty) setKeyboardToolbar(true);
          setPanel("link");
          return true;
        }
        if (event.shiftKey && (event.code === "Comma" || event.code === "Period")) {
          editorRef.current?.chain().focus().toggleHeading({ level: event.code === "Comma" ? 1 : 2 }).run();
          return true;
        }
        return false;
      },
    },
  });
  useGhostCompletion(editor, completion);
  useEffect(() => {
    editorRef.current = editor;
    return () => { editorRef.current = null; };
  }, [editor, editorRef]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);
  useEffect(() => {
    if (!panel) {
      if (keyboardToolbar) setKeyboardToolbar(false);
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".mail-format-bar")) setPanel(null);
    };
    // The toolbar's buttons never take focus, so Esc can arrive from anywhere in the composer. It
    // closes this menu and nothing else: caught first, before the composer would close on it.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setPanel(null);
      editorRef.current?.commands.focus();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [editorRef, keyboardToolbar, panel]);
  useEffect(() => {
    if (!editor || docked) return;
    editor.commands.setMeta("bubbleMenu", "updatePosition");
  }, [editor, panel, docked]);

  return (
    <div className="min-w-0" data-editor-panel={panel || undefined}>
      {editor && docked && (toolbarHost === undefined
        ? <div className="mail-format-docked"><FormatTools editor={editor} onError={onError} panel={panel} setPanel={setPanel} /></div>
        : toolbarHost && createPortal(<FormatTools editor={editor} onError={onError} panel={panel} setPanel={setPanel} />, toolbarHost))}
      <EditorContent editor={editor} />
      {editor && !docked && !disabled && (
        <BubbleMenu editor={editor} pluginKey="bubbleMenu" updateDelay={0} appendTo={() => overlayRef.current!}
          options={{ placement: "bottom-start", offset: 8, shift: { padding: 12 }, flip: true, hide: true, scrollTarget: scrollRef.current ?? undefined }}
          shouldShow={({ editor: e, state, element }) =>
            (e.isFocused || element.contains(document.activeElement)) &&
              (!state.selection.empty || e.isActive("link") || e.isActive("table") || panel !== null)}>
          <FormatTools editor={editor} onError={onError} panel={panel} setPanel={setPanel} />
        </BubbleMenu>
      )}
    </div>
  );
}
