import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronRight, CircleAlert, GripVertical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import {
  categoryProblems,
  DEFAULT_CATEGORIES,
  iconFor,
  MAX_CATEGORIES,
  MAX_CRITERIA_LENGTH,
  MAX_NAME_LENGTH,
} from "@shared/categories";
import { SORT_MODEL_PATTERN } from "@shared/ai-models";
import { DEFAULT_SORT_MODELS } from "@shared/ai-providers";
import { SORT_FOLDERS, type AiStatus, type Category, type CategoryState, type SortFolder } from "@shared/types";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { hexToHue, hslToHex } from "@/lib/color";
import { FOLDER_STYLE, raisedActive } from "@/lib/folder-style";
import { categoryChanges, needsResort } from "@/lib/category-changes";
import { cn } from "@/lib/utils";

import { SettingsPageHeader } from "../settings/fields";
import { SettingsMultiTileField } from "../settings/visual-fields";

import { CategoryIcon } from "./category-icon";
import { IconPicker } from "./icon-picker";
import { AiProviderField, KeyGate } from "./key-gate";
import { ModelField } from "./model-field";
import { ResortDialog, type ResortChoice } from "./resort-dialog";
import { SortAgainMenu } from "./sort-again-menu";
import { noteShownError } from "@/lib/events";

const SWATCH_HUES = [210, 265, 150, 35, 340, 180, 95, 20];
/** Presets in the color picker: the hues categories are drawn with, at their usual saturation. */
const PRESET_HUES = [0, 20, 35, 55, 95, 150, 180, 195, 210, 235, 265, 300, 320, 340];
const PRESET_COLORS = PRESET_HUES.map((hue) => hslToHex(hue));
const FOLDER_HELP: Record<SortFolder, string> = {
  inbox: "Sort mail that arrives in your Inbox.",
  archive: "Sort mail your own filters file straight into Archive.",
  trash: "Sort mail that lands in Trash.",
  spam: "Sort junk mail too. Turn it off to save calls, or if you only want to watch for false positives.",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Which folders' newly arrived mail is sorted automatically, as the same colored tiles the notifications use. */
function SortFoldersField({
  ai,
  onState,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}) {
  const saved = ai?.sortFolders ?? [...SORT_FOLDERS];
  /** What the tiles show while a save is in flight, so a tile flips at once and nothing is disabled. */
  const [shown, setShown] = useState<SortFolder[] | null>(null);
  const inFlight = useRef(0);
  const current = shown ?? saved;

  const toggle = async (folder: SortFolder, on: boolean) => {
    const next = SORT_FOLDERS.filter((name) => (name === folder ? on : current.includes(name)));
    setShown(next);
    inFlight.current += 1;
    try {
      onState(await api.categories.setSortFolders(next));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      inFlight.current -= 1;
      // Only the last save of a quick run hands the tiles back to the saved value, so they do not jump between answers.
      if (inFlight.current === 0) setShown(null);
    }
  };

  return (
    <section className="space-y-2 edge-t pt-3" aria-label="Folders that are sorted">
      <div>
        <h3 className="text-sm font-semibold">Sort new mail in</h3>
        <p className="text-xs text-muted-foreground">New mail that arrives in the highlighted folders is sorted into your categories.</p>
      </div>
      <SettingsMultiTileField
        ariaLabel="Folders that are sorted"
        values={current}
        className="justify-center py-4"
        options={SORT_FOLDERS.map((folder) => {
          const { label, icon: Icon } = FOLDER_STYLE[folder];
          return {
            value: folder,
            label,
            description: FOLDER_HELP[folder],
            activeClassName: raisedActive(folder),
            content: <Icon aria-hidden="true" className="size-6" />,
          };
        })}
        onToggle={(folder, on) => void toggle(folder, on)}
      />
      {ai?.lastError && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> Last sorting attempt failed: {ai.lastError}
        </p>
      )}
    </section>
  );
}

/** The part most people never open: the provider and its key, and the sorting model. */
function AdvancedSection({
  ai,
  onState,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
}) {
  const [open, setOpen] = useState(false);

  const saveSortModel = async (next: string) => {
    try {
      onState(await api.categories.setSortModel(next));
      toast.success(`Mail will be sorted with ${next}.`, {
        description: "Mail already sorted keeps its category until you sort it again.",
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <section className="space-y-3 edge-t pt-3" aria-label="Advanced">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="categories-advanced"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        Advanced
      </button>

      {open && (
        <div id="categories-advanced" className="corner-squircle space-y-5 rounded-2xl plate-2 p-4">
          {api.system.demo && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Browser demo: categories are assigned by simple keyword rules and nothing leaves this page.
            </p>
          )}

          <AiProviderField ai={ai} onState={onState} purpose="sorting" />

          <ModelField
            title="Sorting model"
            help="The model that sorts mail into your categories."
            purpose="sorting"
            saved={ai?.model ?? DEFAULT_SORT_MODELS.vercel}
            defaultModel={DEFAULT_SORT_MODELS[ai?.sortProvider ?? "vercel"]}
            allowEmpty={false}
            pattern={SORT_MODEL_PATTERN}
            ariaLabel="Model for sorting mail"
            configured={ai?.configured ?? false}
            onSave={saveSortModel}
          />
        </div>
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
        "corner-squircle rounded-2xl plate-2 p-2 transition-opacity",
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

interface CategoriesPanelProps {
  categories: readonly Category[];
  ai: AiStatus | null;
  /** Receives the new state after a save, so the list and filters update right away. */
  onState: (state: CategoryState) => void;
  /**
   * Inside the setup guide: just the list and its buttons, without the page title, the key prompt
   * (the guide has asked for the key already), the settings below the list (folders, model) or
   * anything about sorting mail again (nothing has been sorted yet).
   */
  embedded?: boolean;
  /** Tells the parent whether the list has changes that are not saved yet, so it can hold back a step. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Create, rename, delete and redefine categories, and connect the AI that sorts mail into them. */
export function CategoriesPanel({ categories, ai, onState, embedded = false, onDirtyChange }: CategoriesPanelProps) {
  const [draft, setDraft] = useState<Category[]>(() => categories.map((category) => ({ ...category })));
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Set while the "sort again?" dialog waits for an answer to Save. */
  const [asking, setAsking] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const problems = useMemo(() => categoryProblems(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(categories), [draft, categories]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
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

  const changes = useMemo(() => categoryChanges(categories, draft), [categories, draft]);

  /**
   * Without a key nothing can be sorted, so there is nothing to advise. The setup guide never asks
   * either: nothing has been sorted yet, so there is nothing to sort again; it takes the dialog's own
   * default (a deleted category's mail has no category, the rest is left alone).
   */
  const onSave = () => {
    if (embedded) void save(changes.deleted.length > 0 ? "none" : "keep");
    else if (ai?.configured && needsResort(changes)) setAsking(true);
    else void save("keep");
  };

  const save = async (choice: ResortChoice) => {
    setSaving(true);
    try {
      onState(await api.categories.save(draft, choice === "none" ? { orphans: "none" } : undefined));
      setEditingId(null);
      setAsking(false);
      toast.success("Categories saved");
      if (choice === "sort") setSortOpen(true);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const editor = (
        <div className="space-y-4">
          <section className="space-y-3" aria-label="Category list">
            {draft.length === 0 && (
              <p className="rounded-xl shadow-stamped px-3 py-6 text-center text-sm text-muted-foreground">
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
              {ai?.configured && !embedded && <SortAgainMenu open={sortOpen} onOpenChange={setSortOpen} />}
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!dirty || saving}
                  onClick={() => {
                    setDraft(categories.map((category) => ({ ...category })));
                    setEditingId(null);
                  }}
                >
                  Revert
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={!dirty || problems.length > 0 || saving}
                >
                  {saving && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </div>

            {problems.length > 0 && dirty && (
              <ul role="alert" className="space-y-0.5 text-xs text-destructive">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </section>

          <ResortDialog
            changes={asking ? changes : null}
            saving={saving}
            onChoose={(choice) => void save(choice)}
            onCancel={() => setAsking(false)}
          />

          {!embedded && <SortFoldersField ai={ai} onState={onState} />}

          {!embedded && <AdvancedSection ai={ai} onState={onState} />}
        </div>
  );

  if (embedded) return editor;
  return (
    <div className="flex max-w-2xl flex-col gap-4 p-6">
      <SettingsPageHeader title="Categories" />

      <KeyGate
        ai={ai}
        onState={onState}
        purpose="sorting"
        intro="MiniMail sorts your mail into categories with TypeSafe AI's Jev, reached through the Vercel AI Gateway, OpenRouter or TypeSafe's own API: pick one and add its key. You can pick another model later under Advanced."
      >
        {editor}
      </KeyGate>
    </div>
  );
}
