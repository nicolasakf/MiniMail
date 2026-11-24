import { describe, expect, it } from "vitest";

import { canContinue, firstOpenStep, onboardingDecision, ONBOARDING_STEPS } from "./onboarding";

describe("onboardingDecision", () => {
  it("opens on a fresh install and remembers that it was offered", () => {
    expect(onboardingDecision(null, 0)).toEqual({ open: true, save: false });
  });

  it("stays closed for someone who already has accounts, and records that they are set up", () => {
    expect(onboardingDecision(null, 2)).toEqual({ open: false, save: true });
  });

  it("opens again when it was started but not finished, with or without accounts", () => {
    expect(onboardingDecision(false, 0)).toEqual({ open: true });
    expect(onboardingDecision(false, 1)).toEqual({ open: true });
  });

  it("never opens once finished or skipped, even with no account left", () => {
    expect(onboardingDecision(true, 0)).toEqual({ open: false });
    expect(onboardingDecision(true, 3)).toEqual({ open: false });
  });
});

describe("firstOpenStep", () => {
  it("carries on at the first step that is still missing", () => {
    expect(firstOpenStep(0, false)).toBe("account");
    expect(firstOpenStep(0, true)).toBe("account");
    expect(firstOpenStep(1, false)).toBe("ai");
    expect(firstOpenStep(1, true)).toBe("categories");
  });
});

describe("ONBOARDING_STEPS", () => {
  it("ends with three optional steps, the last one being the AI agent", () => {
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual(["account", "ai", "categories", "notifications", "agent"]);
    const optional = ONBOARDING_STEPS.filter((step) => "optional" in step && step.optional).map((step) => step.id);
    expect(optional).toEqual(["categories", "notifications", "agent"]);
  });

  it("never reopens at the AI agent step: a guide that was left carries on at the first required one, or categories", () => {
    expect(firstOpenStep(1, true)).toBe("categories");
  });
});

describe("canContinue", () => {
  it("needs an account, then the key, and nothing for the optional categories", () => {
    expect(canContinue("account", 0, true)).toBe(false);
    expect(canContinue("account", 1, false)).toBe(true);
    expect(canContinue("ai", 1, false)).toBe(false);
    expect(canContinue("ai", 1, true)).toBe(true);
    expect(canContinue("categories", 0, false)).toBe(true);
    expect(canContinue("notifications", 0, false)).toBe(true);
    expect(canContinue("agent", 0, false)).toBe(true);
  });
});
