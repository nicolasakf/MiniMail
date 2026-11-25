import { useState } from "react";

import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";

import { AI_PROVIDERS, isChatProvider, noKeys, PROVIDER_KEY_URLS, PROVIDER_LABELS, type AiProvider } from "@shared/ai-providers";
import type { AiStatus, CategoryState } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { noteShownError } from "@/lib/events";
import { toast } from "@/lib/toast";

import { ConnectionNote, type Connection } from "./model-field";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every provider as a row, each with its own key: add one, add another, remove any. One of the saved keys
 * sorts the mail (the first one saved takes the job, and "Use for sorting" moves it); removing that key
 * hands the job to another saved one. Same calls as the provider field in Settings, so nothing here works
 * differently from there.
 */
export function AiKeysList({ ai, onState }: { ai: AiStatus | null; onState: (state: CategoryState) => void }) {
  const [adding, setAdding] = useState<AiProvider | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ provider: AiProvider; connection: Connection } | null>(null);

  const keys = ai?.keys ?? noKeys();

  const startAdding = (provider: AiProvider) => {
    setAdding(provider);
    setKey("");
    setNote(null);
  };

  const save = async (provider: AiProvider) => {
    setSaving(true);
    try {
      let state = await api.categories.setAiKey(provider, key);
      onState(state);
      setKey("");
      setAdding(null);
      // The first key saved is the one that sorts, so the step can go on.
      if (!state.ai.configured && state.ai.sortProvider !== provider) {
        state = await api.categories.setSortProvider(provider);
        onState(state);
      }
      if (state.ai.sortProvider === provider && state.ai.model) {
        setNote({ provider, connection: { state: "testing" } });
        await api.categories.testModel("sorting", state.ai.model);
        setNote({ provider, connection: { state: "ok" } });
      }
    } catch (error) {
      setNote({ provider, connection: { state: "error", message: errorText(error) } });
      noteShownError("The AI key could not be used", errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (provider: AiProvider) => {
    try {
      const state = await api.categories.clearAiKey(provider);
      onState(state);
      setNote(null);
      const other = AI_PROVIDERS.find((candidate) => candidate !== provider && state.ai.keys[candidate]);
      if (state.ai.sortProvider === provider && other) onState(await api.categories.setSortProvider(other));
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const useForSorting = async (provider: AiProvider) => {
    try {
      onState(await api.categories.setSortProvider(provider));
      setNote(null);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <ul aria-label="AI providers" className="space-y-2">
      {AI_PROVIDERS.map((provider) => {
        const label = PROVIDER_LABELS[provider];
        // "TypeSafe API key", not "TypeSafe API API key".
        const keyName = label.endsWith("API") ? `${label} key` : `${label} API key`;
        const saved = keys[provider];
        const sorts = saved && ai?.sortProvider === provider;
        const open = adding === provider;
        const connection = note?.provider === provider ? note.connection : null;
        return (
          <li key={provider} className="corner-squircle plate-2 space-y-3 rounded-2xl p-3">
            <div className="flex items-center gap-3">
              <span className="corner-squircle plate-3 flex size-9 shrink-0 items-center justify-center rounded-lg">
                <KeyRound className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{label}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {saved ? (
                    <>
                      <CircleCheck className="size-3.5 text-success" /> Key saved{sorts && " · Sorts your mail"}
                    </>
                  ) : isChatProvider(provider) ? (
                    "Sorting and AI-enabled features"
                  ) : (
                    "Sorting only"
                  )}
                </div>
              </div>
              {saved ? (
                <div className="flex items-center gap-1">
                  {!sorts && (
                    <Button size="sm" variant="ghost" onClick={() => void useForSorting(provider)}>
                      Use for sorting
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void remove(provider)}>
                    Remove
                  </Button>
                </div>
              ) : (
                !open && (
                  <Button size="sm" variant="outline" disabled={ai === null} onClick={() => startAdding(provider)}>
                    Add key
                  </Button>
                )
              )}
            </div>
            {open && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(provider);
                }}
              >
                <Input
                  autoFocus
                  type="password"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={keyName}
                  aria-label={keyName}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 min-w-[200px] flex-1"
                />
                <Button type="submit" size="sm" disabled={saving || key.trim().length < 8}>
                  {saving && <Loader2 className="animate-spin" />}
                  Save key
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setAdding(null)}>
                  Cancel
                </Button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => void api.system.openExternal(PROVIDER_KEY_URLS[provider])}
                >
                  Create a key <ExternalLink className="size-3" />
                </button>
              </form>
            )}
            {connection && <ConnectionNote connection={connection} okText="Connected: the key works." />}
          </li>
        );
      })}
    </ul>
  );
}
