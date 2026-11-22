import { useState } from "react";

import { Check, KeyRound, SquareTerminal } from "lucide-react";

import { iconFor } from "@shared/categories";
import type { Account, AiStatus, Category, CategoryState } from "@shared/types";

import { Button } from "@/components/ui/button";
import { CliSkillTargets } from "@/components/settings/cli-tab";
import { SettingsSwitchField } from "@/components/settings/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCli } from "@/hooks/use-cli";
import { api } from "@/lib/api";
import { canContinue, firstOpenStep, ONBOARDING_STEPS, type OnboardingStepId } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

import { AccountsPanel } from "./accounts-panel";
import { CategoryIcon } from "./category-icon";
import { AiProviderField } from "./key-gate";

interface OnboardingDialogProps {
  open: boolean;
  accounts: readonly Account[];
  categories: readonly Category[];
  ai: AiStatus | null;
  onAccountsChanged: () => void;
  onCategoryState: (state: CategoryState) => void;
  /** Closes the guide for good; `editCategories` also opens Settings on the Categories page. */
  onFinish: (editCategories: boolean) => void;
}

/** The steps as a row: done ones carry a check, the current one is filled. */
function Stepper({ current }: { current: OnboardingStepId }) {
  const index = ONBOARDING_STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Setup steps" className="flex items-center gap-2 text-xs">
      {ONBOARDING_STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className={cn("flex items-center gap-2", position > 0 && "flex-1")}
          >
            {position > 0 && <span aria-hidden="true" className={cn("h-px flex-1", done || active ? "bg-primary" : "bg-border")} />}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                (done || active) && "border-primary bg-primary text-primary-foreground",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : position + 1}
            </span>
            <span className={cn(active ? "font-medium" : "text-muted-foreground")}>
              {step.title}
              {"optional" in step && step.optional && <span className="text-muted-foreground"> (optional)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIntro({ title, children }: { title: string; children: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The last step: let an AI agent on this computer read mail through the `minimail` command. It is the
 * same switch and the same choice of agents as the CLI page in Settings (they share `useCli`), and
 * nothing happens until the person turns it on.
 */
function AgentStep() {
  const { state, update } = useCli();
  const enabled = state?.settings.enabled ?? false;
  return (
    <div className="space-y-5 px-6 py-5">
      <StepIntro title="Connect MiniMail with your AI agent">
        Let an AI agent on this computer, such as Claude Code or Codex, look through your mail with a command. It can read and search your mail, tidy it (archive, mark as read, block) and write drafts for you to look over. Sending a message, unsubscribing and answering invitations ask you first, and MiniMail never gives it sign-in codes.
      </StepIntro>
      {api.system.demo && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Browser demo: nothing is installed on this computer.</p>
      )}
      <SettingsSwitchField
        id="onboarding-cli"
        label="Allow the MiniMail CLI"
        description="You can switch it off any time. Nothing is installed or listening while it is off."
        checked={enabled}
        disabled={state === null}
        onCheckedChange={(next) => void update((current) => ({ ...current, enabled: next }))}
      />
      {state && enabled && (
        <section aria-label="Install the skill" className="space-y-3">
          <div className="flex items-center gap-2">
            <SquareTerminal className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Which agent do you use?</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            MiniMail adds a short skill file for each one you tick. It teaches the agent to use the command and to treat mail as untrusted.
          </p>
          <CliSkillTargets
            state={state}
            onToggle={(id, on) =>
              void update((current) => ({
                ...current,
                skillTargets: on ? [...new Set([...current.skillTargets, id])] : current.skillTargets.filter((target) => target !== id),
              }))
            }
          />
        </section>
      )}
      <p className="text-xs text-muted-foreground">Everything about it is in Settings, under CLI.</p>
    </div>
  );
}

/**
 * The first-run setup guide, a dialog in the middle of the window: connect an email account, add the
 * AI provider and its key, and (optionally) look over the categories mail is sorted into and connect an AI agent. Each step uses
 * the same parts as Settings, so nothing here works differently from there. It cannot be closed by
 * accident (no Escape, no click outside): "Skip setup" is the way out, and finishing it is remembered.
 */
export function OnboardingDialog({
  open,
  accounts,
  categories,
  ai,
  onAccountsChanged,
  onCategoryState,
  onFinish,
}: OnboardingDialogProps) {
  const keySaved = ai?.configured ?? false;
  const [step, setStep] = useState<OnboardingStepId>(() => firstOpenStep(accounts.length, keySaved));
  const position = ONBOARDING_STEPS.findIndex((candidate) => candidate.id === step);
  const last = position === ONBOARDING_STEPS.length - 1;
  const previous = ONBOARDING_STEPS[position - 1];
  const next = ONBOARDING_STEPS[position + 1];

  return (
    <Dialog open={open}>
      <DialogContent
        hideCloseButton
        className="flex h-[80vh] max-h-[640px] w-[90vw] max-w-xl flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Set up MiniMail</DialogTitle>
          <DialogDescription>Connect an email account, connect an AI provider, look over your categories and, if you like, connect an AI agent.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 border-b border-border px-6 pb-4 pt-5">
          <p className="text-sm font-semibold">Welcome to MiniMail</p>
          <Stepper current={step} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === "account" && (
            <div className="space-y-1">
              <div className="px-6 pt-5">
                <StepIntro title="Connect your email">
                  Add the account whose mail you want here. You can add more accounts later.
                </StepIntro>
              </div>
              <AccountsPanel startAdding accounts={accounts} onChanged={onAccountsChanged} />
            </div>
          )}

          {step === "ai" && (
            <div className="space-y-5 px-6 py-5">
              <StepIntro title="Connect an AI provider">
                MiniMail sorts your mail into categories with an AI model, reached through the Vercel AI Gateway, OpenRouter or TypeSafe&apos;s own API. The key is stored encrypted on this computer. Without it, mail is still sorted by simple rules.
              </StepIntro>
              <section
                aria-label="AI provider"
                className="corner-squircle space-y-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">AI provider</h3>
                </div>
                {api.system.demo && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Browser demo: nothing leaves this page, so any key of 8 characters or more works.
                  </p>
                )}
                <AiProviderField ai={ai} onState={onCategoryState} purpose="sorting" heading={false} />
              </section>
            </div>
          )}

          {step === "categories" && (
            <div className="space-y-4 px-6 py-5">
              <StepIntro title="Make the categories yours">
                Mail is filed into these categories. Each one is described in plain language, and the AI sorts by that description. Keep them, or rename, rewrite, add and remove them.
              </StepIntro>
              <ul aria-label="Your categories" className="space-y-2">
                {categories.map((category) => (
                  <li
                    key={category.id}
                    className="corner-squircle flex items-center gap-3 rounded-xl border border-border bg-card/30 p-2"
                  >
                    <span
                      aria-hidden="true"
                      className="corner-squircle flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `hsl(${category.hue} 70% 55% / 0.16)`, color: `hsl(${category.hue} 70% 62%)` }}
                    >
                      <CategoryIcon icon={iconFor(category)} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">{category.name}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{category.criteria}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">You can change them any time in Settings, under Categories.</p>
            </div>
          )}

          {step === "agent" && <AgentStep />}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-3">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => onFinish(false)}>
            Skip setup
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {previous && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(previous.id)}>
                Back
              </Button>
            )}
            {last ? (
              <Button type="button" size="sm" onClick={() => onFinish(false)}>
                Start using MiniMail
              </Button>
            ) : (
              <>
                {step === "categories" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => onFinish(true)}>
                    Edit categories
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={!canContinue(step, accounts.length, keySaved)}
                  onClick={() => next && setStep(next.id)}
                >
                  Continue
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
