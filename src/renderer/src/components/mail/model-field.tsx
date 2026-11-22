import { useEffect, useState, type ReactNode } from "react";

import { CircleAlert, CircleCheck, Loader2, RotateCcw } from "lucide-react";

import type { ModelPurpose } from "@shared/ai-models";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoIcon } from "@/components/settings/fields";
import { api } from "@/lib/api";
import { noteShownError } from "@/lib/events";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Connection = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "error"; message: string };

/** What a connection test says under its field. */
export function ConnectionNote({ connection, okText }: { connection: Connection; okText: string }) {
  if (connection.state === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CircleCheck className="size-3.5" /> {okText}
      </p>
    );
  }
  if (connection.state === "error") {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-xs text-red-300">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {connection.message}
      </p>
    );
  }
  return null;
}

interface ModelFieldProps {
  title: string;
  /** One line under the title: what this model is used for. */
  help?: string;
  /** Explains the model in a tooltip next to the title, in place of `help` under it. */
  info?: ReactNode;
  purpose: ModelPurpose;
  /** The model that is saved now. */
  saved: string;
  /** What Reset goes back to. */
  defaultModel: string;
  /** Whether the field may be empty (the AI-enabled features then run on rules only). */
  allowEmpty: boolean;
  /** What a model id of the chosen provider looks like. */
  pattern: RegExp;
  ariaLabel: string;
  /** The chosen provider has a key saved; the model cannot be tested without one. */
  configured: boolean;
  /** Saves the model and tells the user how it went (it shows its own errors). */
  onSave: (model: string) => Promise<void>;
  /** Said under the field when it is saved empty. */
  emptyNote?: string;
}

/**
 * One model choice with its own Save and Test connection. The test tries what is typed
 * in the field, saved or not, so a model can be checked before it is used. Save (and Reset) run
 * the same test first and keep the old model when it fails.
 */
export function ModelField({
  title,
  help,
  info,
  purpose,
  saved,
  defaultModel,
  allowEmpty,
  pattern,
  ariaLabel,
  configured,
  onSave,
  emptyNote,
}: ModelFieldProps) {
  const [model, setModel] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<Connection>({ state: "idle" });
  useEffect(() => setModel(saved), [saved]);

  const trimmed = model.trim();
  const valid = pattern.test(trimmed) && (allowEmpty || trimmed !== "");
  const testable = configured && valid && trimmed !== "";

  const change = (next: string) => {
    setModel(next);
    setConnection({ state: "idle" });
  };

  /** One real call to `candidate`; shows how it went under the field. True when the model answered. */
  const check = async (candidate: string): Promise<boolean> => {
    setConnection({ state: "testing" });
    try {
      await api.categories.testModel(purpose, candidate);
      setConnection({ state: "ok" });
      return true;
    } catch (error) {
      setConnection({ state: "error", message: errorText(error) });
      noteShownError(`The ${title.toLowerCase()} model could not be used`, errorText(error));
      return false;
    }
  };

  /**
   * Saves `next`, but only after the connection test passes: a model that cannot answer is never
   * saved. An empty model (rules only) has nothing to test, and without a key there is nothing to test with.
   */
  const save = async (next: string) => {
    setSaving(true);
    try {
      if (configured && next !== "" && !(await check(next))) return;
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  /** Back to the default: saves it when something else is saved, and otherwise only clears what was typed. */
  const reset = () => {
    setConnection({ state: "idle" });
    if (saved === defaultModel) setModel(defaultModel);
    else void save(defaultModel);
  };

  const test = () => void check(trimmed);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && trimmed !== saved) void save(trimmed);
      }}
    >
      <div>
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold">{title}</h4>
          {info ? <InfoIcon info={info} label={title} /> : null}
        </div>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={model}
          onChange={(event) => change(event.target.value)}
          placeholder={defaultModel}
          aria-label={ariaLabel}
          aria-invalid={!valid}
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-w-[220px] flex-1 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={saving || !valid || trimmed === saved}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!testable || connection.state === "testing"}
          title={configured ? undefined : "Save a key first"}
          onClick={test}
        >
          {connection.state === "testing" && <Loader2 className="animate-spin" />}
          Test connection
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving || (saved === defaultModel && trimmed === defaultModel)}
          title={`Go back to ${defaultModel}`}
          onClick={reset}
        >
          <RotateCcw /> Reset
        </Button>
      </div>
      {!valid && <p className="text-xs text-red-300">Use a model id like &quot;{defaultModel}&quot;.</p>}
      {saved === "" && emptyNote && <p className="text-xs text-muted-foreground">{emptyNote}</p>}
      <ConnectionNote connection={connection} okText={`Connected: ${trimmed} answered a test question.`} />
    </form>
  );
}
