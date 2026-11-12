import { useEffect, useMemo, useRef, useState } from "react";

import { CircleAlert, CircleCheck, ExternalLink, GripVertical, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  categoryProblems,
  DEFAULT_CATEGORIES,
  iconFor,
  MAX_CATEGORIES,
  MAX_CRITERIA_LENGTH,
  MAX_NAME_LENGTH,
} from "@shared/categories";
import { SORT_FOLDERS, type AiStatus, type Category, type CategoryState, type SortFolder } from "@shared/types";
import { CODE_MODEL_PATTERN, DEFAULT_CODE_MODEL } from "@shared/verification-code";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { hexToHue, hslToHex } from "@/lib/color";
import { sortMailAgain } from "@/lib/sort-progress";
import { retryMissingCodes } from "@/lib/verification-codes";
import { cn } from "@/lib/utils";

import { CategoryIcon } from "./category-icon";
import { IconPicker } from "./icon-picker";
import { SortAgainMenu } from "./sort-again-menu";

const SWATCH_HUES = [210, 265, 150, 35, 340, 180, 95, 20];
/** Presets in the color picker: the hues categories are drawn with, at their usual saturation. */
const PRESET_HUES = [0, 20, 35, 55, 95, 150, 180, 195, 210, 235, 265, 300, 320, 340];
const PRESET_COLORS = PRESET_HUES.map((hue) => hslToHex(hue));
const FOLDER_LABELS: Record<SortFolder, string> = { inbox: "Inbox", archive: "Archive", spam: "Spam", trash: "Trash" };
const KEYS_URL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Connection = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "error"; message: string };

/** The gateway model that reads verification codes the on-device rules cannot; the user may swap it. */
function CodeModelField({
  ai,
  onState,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}) {
  const saved = ai?.codeModel ?? DEFAULT_CODE_MODEL;
  const [model, setModel] = useState(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setModel(saved), [saved]);

  const trimmed = model.trim();
  const valid = CODE_MODEL_PATTERN.test(trimmed);

  const save = async (next: string) => {
    setSaving(true);
    try {
      onState(await api.categories.setCodeModel(next));
      retryMissingCodes();
      toast.success(next ? `Verification codes will use ${next} when the rules fail.` : "Verification codes: rules only.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-2 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void save(trimmed);
      }}
    >
      <h4 className="text-sm font-semibold">Verification code fallback</h4>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={DEFAULT_CODE_MODEL}
          aria-label="Verification code model"
          aria-invalid={!valid}
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-w-[220px] flex-1 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={saving || !valid || trimmed === saved}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
        {saved !== DEFAULT_CODE_MODEL && (
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(DEFAULT_CODE_MODEL)}>
            Use {DEFAULT_CODE_MODEL}
          </Button>
        )}
      </div>
      {!valid && <p className="text-xs text-red-300">Use a gateway model id like &quot;{DEFAULT_CODE_MODEL}&quot;.</p>}
      {saved === "" && <p className="text-xs text-muted-foreground">Rules only: no email text is sent for codes.</p>}
      {saved !== "" && !ai?.configured && (
        <p className="text-xs text-muted-foreground">The fallback starts working once a gateway key is saved.</p>
      )}
    </form>
  );
}

/** Which folders' newly arrived mail is sorted automatically. Saves as soon as a box is toggled. */
function SortFoldersField({
  ai,
  onState,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}) {
  const saved = ai?.sortFolders ?? ["inbox"];
  const [saving, setSaving] = useState(false);

  const toggle = async (folder: SortFolder, on: boolean) => {
    const next = SORT_FOLDERS.filter((name) => (name === folder ? on : saved.includes(name)));
    setSaving(true);
    try {
      onState(await api.categories.setSortFolders(next));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="space-y-2 border-t border-border pt-3" disabled={saving}>
      <legend className="float-left mb-2 w-full text-sm font-semibold">Sort new mail in</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 clear-both">
        {SORT_FOLDERS.map((folder) => {
          const checked = saved.includes(folder);
          return (
            <label key={folder} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => void toggle(folder, value === true)}
              />
              {FOLDER_LABELS[folder]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Where the Vercel AI Gateway key is entered and checked; Jev runs through that gateway. */
function AiSection({
  ai,
  onState,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<Connection>({ state: "idle" });

  const test = async () => {
    setConnection({ state: "testing" });
    try {
      await api.categories.testGateway();
      setConnection({ state: "ok" });
    } catch (error) {
      setConnection({ state: "error", message: errorText(error) });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onState(await api.categories.setGatewayKey(key));
      setKey("");
      await test();
    } catch (error) {
      setConnection({ state: "error", message: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      onState(await api.categories.clearGatewayKey());
      setConnection({ state: "idle" });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const configured = ai?.configured ?? false;

  return (
    <section className="corner-squircle space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <KeyRound className="size-4 text-muted-foreground" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">AI sorting with Jev</h3>
      </div>

      {api.system.demo && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Browser demo: categories are assigned by simple keyword rules and nothing leaves this page.
        </p>
      )}

      {configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4 text-emerald-400" />
            Key saved
          </span>
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={connection.state === "testing"}>
            {connection.state === "testing" && <Loader2 className="animate-spin" />}
            Test connection
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            Remove key
          </Button>
          {ai && ai.pending > 0 && (
            <span className="text-xs text-muted-foreground">Sorting {ai.pending}…</span>
          )}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Vercel AI Gateway API key"
            aria-label="Vercel AI Gateway API key"
            autoComplete="off"
            spellCheck={false}
            className="h-9 min-w-[220px] flex-1"
          />
          <Button type="submit" size="sm" disabled={saving || key.trim().length < 8}>
            {saving && <Loader2 className="animate-spin" />}
            Save key
          </Button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => void api.system.openExternal(KEYS_URL)}
          >
            Create a key <ExternalLink className="size-3" />
          </button>
        </form>
      )}

      <SortFoldersField ai={ai} onState={onState} />

      <CodeModelField ai={ai} onState={onState} />

      {connection.state === "ok" && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CircleCheck className="size-3.5" /> Connected: Jev answered a test question.
        </p>
      )}
      {connection.state === "error" && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {connection.message}
        </p>
      )}
      {connection.state !== "error" && ai?.lastError && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> Last sorting attempt failed: {ai.lastError}
        </p>
      )}
    </section>
  );
}

/**
 * The color picker for a category. Categories store only a hue (they are all drawn at the same
 * saturation so the palette stays even), so the picker keeps the exact color you are dragging
 * while it is open and saves the hue of it.
 */
function CategoryColor({ hue, onChange, label }: { hue: number; onChange: (hue: number) => void; label: string }) {
  const [picked, setPicked] = useState(() => hslToHex(hue));
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setPicked((current) => (hexToHue(current) === hue ? current : hslToHex(hue)));
  }, [hue]);

  return (
    <span ref={anchor} className="contents">
    <ColorPicker
      value={picked}
      onValueChange={(next) => {
        setPicked(next);
        onChange(hexToHue(next));
      }}
      presets={PRESET_COLORS}
      trigger={
        <button
          type="button"
          aria-label={`${label}: choose color`}
          title="Color"
          className="size-6 shrink-0 rounded-full border border-white/20 shadow-inner outline-none ring-offset-background transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ backgroundColor: `hsl(${hue} 70% 55%)` }}
        />
      }
      container={container}
      align="end"
      onOpenChange={(open) => {
        if (open) setContainer(anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined);
      }}
    />
    </span>
  );
}

interface CategoryCardProps {
  category: Category;
  index: number;
  editing: boolean;
  dragging: boolean;
  onEdit: (editing: boolean) => void;
  onChange: (patch: Partial<Category>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** A compact category card: icon, name and a line of its description, with Edit and Delete. */
function CategoryCard({
  category,
  index,
  editing,
  dragging,
  onEdit,
  onChange,
  onDelete,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onMove,
}: CategoryCardProps) {
  const label = category.name || `Category ${index + 1}`;
  const card = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={card}
      className={cn(
        "corner-squircle rounded-xl border border-border bg-card/30 p-2 transition-opacity",
        dragging && "opacity-40",
      )}
      role="group"
      aria-label={`Category ${index + 1}`}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={onDragEnter}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          draggable
          aria-label={`Reorder ${label}. Drag, or press Alt with the up or down arrow.`}
          title="Drag to reorder"
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", category.id);
            if (card.current) event.dataTransfer.setDragImage(card.current, 16, 16);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            event.preventDefault();
            onMove(event.key === "ArrowUp" ? -1 : 1);
          }}
        >
          <GripVertical className="size-4" />
        </button>

        {editing ? (
          <IconPicker
            value={iconFor(category)}
            hue={category.hue}
            label={label}
            onChange={(icon) => onChange({ icon })}
          />
        ) : (
          <span
            aria-hidden="true"
            className="corner-squircle flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `hsl(${category.hue} 70% 55% / 0.16)`, color: `hsl(${category.hue} 70% 62%)` }}
          >
            <CategoryIcon icon={iconFor(category)} className="size-4" />
          </span>
        )}

        {editing ? (
          <Input
            value={category.name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Category name"
            aria-label="Category name"
            autoFocus={category.name === ""}
            className="h-9 flex-1 font-medium"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{category.name || "Untitled"}</p>
            <p className="line-clamp-1 text-xs text-muted-foreground">{category.criteria || "No description yet."}</p>
          </div>
        )}

        {editing && <CategoryColor hue={category.hue} onChange={(hue) => onChange({ hue })} label={label} />}

        {editing ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(false)}>
            Done
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            aria-label={`Edit ${label}`}
            title="Edit"
            onClick={() => onEdit(true)}
          >
            <Pencil />
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${label}`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>

      {editing && (
        <Textarea
          value={category.criteria}
          maxLength={MAX_CRITERIA_LENGTH}
          rows={4}
          placeholder="Describe what belongs here, for example: receipts and invoices for things I bought."
          aria-label="Classification criteria"
          className="mt-2 resize-none text-sm"
          onChange={(event) => onChange({ criteria: event.target.value })}
        />
      )}
    </div>
  );
}

interface CategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly Category[];
  ai: AiStatus | null;
  /** Receives the new state after a save, so the list and filters update right away. */
  onState: (state: CategoryState) => void;
}

/** Create, rename, delete and redefine categories, and connect the AI that sorts mail into them. */
export function CategoriesDialog({ open, onOpenChange, categories, ai, onState }: CategoriesDialogProps) {
  const [draft, setDraft] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Each opening starts from what is saved, never from an abandoned edit.
  useEffect(() => {
    if (open) {
      setDraft(categories.map((category) => ({ ...category })));
      setEditingId(null);
      setDragId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problems = useMemo(() => categoryProblems(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(categories), [draft, categories]);
  const missingDefaults = DEFAULT_CATEGORIES.filter(
    (candidate) => !draft.some((category) => category.id === candidate.id),
  );

  const update = (id: string, patch: Partial<Category>) =>
    setDraft((previous) => previous.map((category) => (category.id === id ? { ...category, ...patch } : category)));

  /** Moves a category to where another one is: its position decides the order groups are listed in. */
  const moveTo = (id: string, targetId: string) =>
    setDraft((previous) => {
      const from = previous.findIndex((category) => category.id === id);
      const to = previous.findIndex((category) => category.id === targetId);
      if (from < 0 || to < 0 || from === to) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const add = () => {
    const id = crypto.randomUUID();
    setEditingId(id);
    setDraft((previous) => [
      ...previous,
      {
        id,
        name: "",
        criteria: "",
        hue: SWATCH_HUES[previous.length % SWATCH_HUES.length],
      },
    ]);
  };

  const resort = () => void sortMailAgain();

  const save = async () => {
    setSaving(true);
    try {
      const criteriaChanged = draft.some((category) => {
        const before = categories.find((candidate) => candidate.id === category.id);
        return before !== undefined && before.criteria.trim() !== category.criteria.trim();
      });
      onState(await api.categories.save(draft));
      onOpenChange(false);
      toast.success("Categories saved", {
        description:
          criteriaChanged && ai?.configured
            ? "Mail already sorted keeps its category until you sort it again."
            : undefined,
        action:
          criteriaChanged && ai?.configured
            ? { label: "Sort mail again", onClick: resort }
            : undefined,
      });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Every new conversation goes into the category whose criteria fit it best, or stays a normal
            conversation when none does.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <AiSection ai={ai} onState={onState} />

          <section className="space-y-3" aria-label="Category list">
            {draft.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No categories. Add one to start sorting mail.
              </p>
            )}
            {draft.map((category, index) => (
              <CategoryCard
                key={category.id}
                category={category}
                index={index}
                editing={editingId === category.id}
                dragging={dragId === category.id}
                onEdit={(editing) => setEditingId(editing ? category.id : null)}
                onChange={(patch) => update(category.id, patch)}
                onDelete={() => setDraft((previous) => previous.filter((item) => item.id !== category.id))}
                onDragStart={() => setDragId(category.id)}
                onDragEnter={() => dragId && moveTo(dragId, category.id)}
                onDragEnd={() => setDragId(null)}
                onMove={(direction) => {
                  const target = draft[index + direction];
                  if (target) moveTo(category.id, target.id);
                }}
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={add}
                disabled={draft.length >= MAX_CATEGORIES}
              >
                <Plus /> Add category
              </Button>
              {missingDefaults.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft((previous) => [...previous, ...missingDefaults.map((c) => ({ ...c }))])}
                >
                  Restore {missingDefaults.map((c) => c.name.toLowerCase()).join(", ")}
                </Button>
              )}
            </div>

            {problems.length > 0 && dirty && (
              <ul role="alert" className="space-y-0.5 text-xs text-red-300">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {ai?.configured ? (
            <SortAgainMenu />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty || problems.length > 0 || saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
