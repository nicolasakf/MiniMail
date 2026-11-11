import { useEffect, useMemo, useState } from "react";

import { CircleAlert, CircleCheck, ExternalLink, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  categoryProblems,
  DEFAULT_CATEGORIES,
  iconFor,
  MAX_CATEGORIES,
  MAX_CRITERIA_LENGTH,
  MAX_NAME_LENGTH,
} from "@shared/categories";
import type { AiStatus, Category, CategoryState } from "@shared/types";

import { Button } from "@/components/ui/button";
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
import { sortMailAgain } from "@/lib/sort-progress";
import { cn } from "@/lib/utils";

import { IconPicker } from "./icon-picker";
import { SortAgainMenu } from "./sort-again-menu";

const SWATCH_HUES = [210, 265, 150, 35, 340, 180, 95, 20];
const KEYS_URL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Connection = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "error"; message: string };

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
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <KeyRound className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold">AI sorting with Jev</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Each new conversation is sorted into one of the categories below by{" "}
            <span className="font-medium text-foreground">{ai?.model ?? "typesafe-ai/jev"}</span> through
            the Vercel AI Gateway. Replies stay in their conversation&apos;s category without another call.
            MiniMail sends the sender, the subject and a short preview of the body, with numbers and link
            paths masked so codes and magic links are never included.
          </p>
        </div>
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
          <p className="basis-full text-xs text-muted-foreground">
            Until a key is saved, mail is sorted by a built-in guess from its headers. The key is stored
            encrypted with your system keychain.
          </p>
        </form>
      )}

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

  // Each opening starts from what is saved, never from an abandoned edit.
  useEffect(() => {
    if (open) setDraft(categories.map((category) => ({ ...category })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problems = useMemo(() => categoryProblems(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(categories), [draft, categories]);
  const missingDefaults = DEFAULT_CATEGORIES.filter(
    (candidate) => !draft.some((category) => category.id === candidate.id),
  );

  const update = (id: string, patch: Partial<Category>) =>
    setDraft((previous) => previous.map((category) => (category.id === id ? { ...category, ...patch } : category)));

  const add = () =>
    setDraft((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        name: "",
        criteria: "",
        hue: SWATCH_HUES[previous.length % SWATCH_HUES.length],
      },
    ]);

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
              <div
                key={category.id}
                className="corner-squircle space-y-2 rounded-xl border border-border p-3"
                role="group"
                aria-label={`Category ${index + 1}`}
              >
                <div className="flex items-center gap-2">
                  <IconPicker
                    value={iconFor(category)}
                    hue={category.hue}
                    label={category.name || `Category ${index + 1}`}
                    onChange={(icon) => update(category.id, { icon })}
                  />
                  <Input
                    value={category.name}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Category name"
                    aria-label="Category name"
                    className="h-9 flex-1 font-medium"
                    onChange={(event) => update(category.id, { name: event.target.value })}
                  />
                  <div className="hidden items-center gap-1 sm:flex" role="radiogroup" aria-label="Color">
                    {SWATCH_HUES.map((hue) => (
                      <button
                        key={hue}
                        type="button"
                        role="radio"
                        aria-checked={category.hue === hue}
                        aria-label={`Color ${hue}`}
                        onClick={() => update(category.id, { hue })}
                        className={cn(
                          "size-4 rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          category.hue === hue && "ring-2 ring-foreground ring-offset-2",
                        )}
                        style={{ background: `hsl(${hue} 70% 55%)` }}
                      />
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${category.name || "category"}`}
                    onClick={() => setDraft((previous) => previous.filter((item) => item.id !== category.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  value={category.criteria}
                  maxLength={MAX_CRITERIA_LENGTH}
                  rows={4}
                  placeholder="Describe what belongs here, for example: receipts and invoices for things I bought."
                  aria-label="Classification criteria"
                  className="resize-none text-sm"
                  onChange={(event) => update(category.id, { criteria: event.target.value })}
                />
              </div>
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
