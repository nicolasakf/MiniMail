/** The first-run setup guide: which steps it has, when it opens, and what each step needs. */

export const ONBOARDING_STEPS = [
  { id: "account", title: "Email" },
  { id: "ai", title: "AI key" },
  { id: "categories", title: "Categories", optional: true },
  { id: "notifications", title: "Notifications", optional: true },
  { id: "agent", title: "AI agent", optional: true },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export interface OnboardingDecision {
  /** Show the guide now. */
  open: boolean;
  /** The value of the saved `onboarded` choice to write, when it has to change. */
  save?: boolean;
}

/**
 * Whether the guide opens at launch, from the saved choice and the accounts connected.
 * - Finished or skipped (`true`): never again.
 * - Started but not finished (`false`): opens again, at the first step still missing.
 * - Never offered (`null`) with no account: a fresh install, so it opens, and remembers that it did.
 * - Never offered with accounts: someone who set the app up before the guide existed; it stays closed.
 */
export function onboardingDecision(saved: boolean | null, accountCount: number): OnboardingDecision {
  if (saved === true) return { open: false };
  if (saved === false) return { open: true };
  if (accountCount === 0) return { open: true, save: false };
  return { open: false, save: true };
}

/** The first step whose requirement is not met yet, so a guide that reopens carries on where it stopped. */
export function firstOpenStep(accountCount: number, keySaved: boolean): OnboardingStepId {
  if (accountCount === 0) return "account";
  if (!keySaved) return "ai";
  return "categories";
}

/** Whether "Continue" is available: an account is needed to go on, and so is the key. Categories and the AI agent ask for nothing. */
export function canContinue(step: OnboardingStepId, accountCount: number, keySaved: boolean): boolean {
  if (step === "account") return accountCount > 0;
  if (step === "ai") return keySaved;
  return true;
}
