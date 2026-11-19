import { useState, type ReactNode } from "react";

import { CircleCheck, ExternalLink, KeyRound, Loader2 } from "lucide-react";

import type { AiStatus, CategoryState } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { noteShownError } from "@/lib/events";
import { toast } from "@/lib/toast";

import { ConnectionNote, type Connection } from "./model-field";

const KEYS_URL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where the Vercel AI Gateway key is entered; every model runs through that gateway. */
export function GatewayKeyField({
  ai,
  onState,
  heading = true,
}: {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
  /** Show the "Vercel AI Gateway key" title (the key card has a bigger one of its own). */
  heading?: boolean;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<Connection>({ state: "idle" });

  const save = async () => {
    setSaving(true);
    try {
      const state = await api.categories.setGatewayKey(key);
      onState(state);
      setKey("");
      setConnection({ state: "testing" });
      await api.categories.testModel("sorting", state.ai.model);
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
      onState(await api.categories.clearGatewayKey());
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
          <h4 className="text-sm font-semibold">Vercel AI Gateway key</h4>
        </div>
      )}
      {ai?.configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4 text-emerald-400" />
            Key saved
          </span>
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            Remove key
          </Button>
          {ai.pending > 0 && <span className="text-xs text-muted-foreground">Sorting {ai.pending}…</span>}
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
      <ConnectionNote connection={connection} okText="Connected: the key works." />
    </div>
  );
}

interface KeyGateProps {
  ai: AiStatus | null;
  onState: (state: CategoryState) => void;
  /** What the key is for, on the card. */
  intro: ReactNode;
  /** The page itself. It is not shown until a key is saved. */
  children: ReactNode;
}

/**
 * Replaces a settings page with a card that asks for the Vercel AI Gateway key, until one is saved:
 * the page's features cannot work without it, so it is the one thing to do first. Both pages that
 * need the key use this, so the card looks and works the same on each.
 */
export function KeyGate({ ai, onState, intro, children }: KeyGateProps) {
  if (ai === null || ai.configured) return <>{children}</>;

  // The card sits in the middle of the room the page would have had.
  return (
    <div className="flex min-h-[calc(85vh-12rem)] items-center justify-center">
      <section
        aria-label="Connect the Vercel AI Gateway"
        className="corner-squircle w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <KeyRound className="size-4 text-muted-foreground" />
          </span>
          <h3 className="text-base font-semibold">Connect the Vercel AI Gateway</h3>
        </div>
        <p className="text-sm text-muted-foreground">{intro}</p>
        {api.system.demo && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Browser demo: nothing leaves this page, so any key of 8 characters or more works.
          </p>
        )}
        <GatewayKeyField ai={ai} onState={onState} heading={false} />
      </section>
    </div>
  );
}
