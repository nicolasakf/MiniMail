import { useState, type ReactNode } from "react";

import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";

import {
  AI_PROVIDERS,
  CHAT_PROVIDERS,
  PROVIDER_KEY_URLS,
  PROVIDER_LABELS,
  type AiProvider,
} from "@shared/ai-providers";
import type { AiStatus, CategoryState } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { noteShownError } from "@/lib/events";
import { toast } from "@/lib/toast";

import { ConnectionNote, type Connection } from "./model-field";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The two jobs that need a provider; each has its own choice of where it runs. */
export type ProviderPurpose = "sorting" | "features";

const PURPOSE_PROVIDERS: Record<ProviderPurpose, readonly AiProvider[]> = {
  sorting: AI_PROVIDERS,
  features: CHAT_PROVIDERS,
};

/** The provider chosen for a job. */
export function providerFor(ai: AiStatus | null, purpose: ProviderPurpose): AiProvider {
  if (!ai) return "vercel";
  return purpose === "sorting" ? ai.sortProvider : ai.codeProvider;
}

/** Whether the provider chosen for a job has its key. */
export function isConnected(ai: AiStatus | null, purpose: ProviderPurpose): boolean {
  if (!ai) return false;
  return purpose === "sorting" ? ai.configured : ai.codeConfigured;
}

/**
 * Where a job runs and the key for it: a provider to pick (the Vercel AI Gateway, OpenRouter, and for
 * sorting also TypeSafe's own API) and that provider's key. Each provider keeps its own key, so
 * switching between them never asks for one twice.
 */
export function AiProviderField({
  ai,
  onState,
  purpose,
  heading = true,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
  purpose: ProviderPurpose;
  /** Show the "AI provider" title (the key card has a bigger one of its own). */
  heading?: boolean;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<Connection>({ state: "idle" });

  const provider = providerFor(ai, purpose);
  const label = PROVIDER_LABELS[provider];
  const saved = ai?.keys[provider] ?? false;
  // "TypeSafe API key", not "TypeSafe API API key".
  const keyName = label.endsWith("API") ? `${label} key` : `${label} API key`;

  const choose = async (next: string) => {
    const chosen = AI_PROVIDERS.find((candidate) => candidate === next);
    if (!chosen || chosen === provider) return;
    try {
      const state =
        purpose === "sorting"
          ? await api.categories.setSortProvider(chosen)
          : await api.categories.setCodeProvider(CHAT_PROVIDERS.find((candidate) => candidate === chosen) ?? "vercel");
      onState(state);
      setKey("");
      setConnection({ state: "idle" });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const state = await api.categories.setAiKey(provider, key);
      onState(state);
      setKey("");
      const model = purpose === "sorting" ? state.ai.model : state.ai.codeModel;
      if (model) {
        setConnection({ state: "testing" });
        await api.categories.testModel(purpose, model);
      }
      setConnection({ state: "ok" });
    } catch (error) {
      setConnection({ state: "error", message: errorText(error) });
      noteShownError("The AI key could not be used", errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      onState(await api.categories.clearAiKey(provider));
      setConnection({ state: "idle" });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div className="space-y-2">
      {heading && (
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">AI provider</h4>
        </div>
      )}
      <Select value={provider} onValueChange={(value) => void choose(value)}>
        <SelectTrigger aria-label={purpose === "sorting" ? "Provider for sorting mail" : "Provider for AI-enabled features"} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PURPOSE_PROVIDERS[purpose].map((candidate) => (
            <SelectItem key={candidate} value={candidate}>
              {PROVIDER_LABELS[candidate]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saved ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4 text-emerald-400" />
            {label} key saved
          </span>
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            Remove key
          </Button>
          {purpose === "sorting" && (ai?.pending ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">Sorting {ai?.pending}…</span>
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
            placeholder={keyName}
            aria-label={keyName}
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
            onClick={() => void api.system.openExternal(PROVIDER_KEY_URLS[provider])}
          >
            Create a key <ExternalLink className="size-3" />
          </button>
        </form>
      )}
      <ConnectionNote connection={connection} okText="Connected: the key works." />
    </div>
  );
}

interface KeyGateProps {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
  /** The job the page is for; the page waits for that job's provider to have a key. */
  purpose: ProviderPurpose;
  /** What the key is for, on the card. */
  intro: ReactNode;
  /** The page itself. It is not shown until a key is saved. */
  children: ReactNode;
}

/**
 * Replaces a settings page with a card that asks for a provider and its key, until one is saved:
 * the page's features cannot work without it, so it is the one thing to do first. Both pages that
 * need a key use this, so the card looks and works the same on each.
 */
export function KeyGate({ ai, onState, purpose, intro, children }: KeyGateProps) {
  if (ai === null || isConnected(ai, purpose)) return <>{children}</>;

  // The card sits in the middle of the room the page would have had.
  return (
    <div className="flex min-h-[calc(85vh-12rem)] items-center justify-center">
      <section
        aria-label="Connect an AI provider"
        className="corner-squircle w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <KeyRound className="size-4 text-muted-foreground" />
          </span>
          <h3 className="text-base font-semibold">Connect an AI provider</h3>
        </div>
        <p className="text-sm text-muted-foreground">{intro}</p>
        {api.system.demo && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Browser demo: nothing leaves this page, so any key of 8 characters or more works.
          </p>
        )}
        <AiProviderField ai={ai} onState={onState} purpose={purpose} heading={false} />
      </section>
    </div>
  );
}
