import { describe, expect, it } from "vitest";

import type { ConfirmCard } from "@shared/cli-page";

import { answerCard, askPerson, currentCard } from "./cli-confirm";

const card = (title: string): ConfirmCard => ({ action: "invitation", answer: "accept", title, when: null, organizer: null, location: null });
const titleOf = (value: ConfirmCard | null) => (value?.action === "invitation" ? value.title : null);

describe("askPerson", () => {
  it("shows the first card, resolves with what the person answered, and then shows the next", async () => {
    const first = askPerson(card("one"));
    const second = askPerson(card("two"));
    expect(titleOf(currentCard())).toBe("one");
    answerCard("once");
    expect(await first).toBe("once");
    expect(titleOf(currentCard())).toBe("two");
    answerCard("reject");
    expect(await second).toBe("reject");
    expect(currentCard()).toBeNull();
  });

  it("does nothing when there is no card to answer", () => {
    expect(() => answerCard("once")).not.toThrow();
    expect(currentCard()).toBeNull();
  });

  it("keeps each answer with its own card", async () => {
    const a = askPerson(card("a"));
    const b = askPerson(card("b"));
    const c = askPerson(card("c"));
    answerCard("always");
    answerCard("reject");
    answerCard("once");
    expect([await a, await b, await c]).toEqual(["always", "reject", "once"]);
  });
});
