import { z } from "zod";

import { textForModel, type CodeSource } from "@shared/verification-code";
import type { Contact } from "@shared/types";

/** Reads a code out of an email the rules could not make sense of; null when there is none. */
export type CodeFallback = (input: CodeSource & { from: Contact }) => Promise<string | null>;

const SYSTEM =
  "You read one email and return its one-time verification code (an OTP, 2FA or sign-in code, or the PIN " +
  "to confirm an email address), exactly as written in the email. Return null when the email has no such " +
  "code: a link-only message has none. Never guess and never return an order number, phone number, " +
  "amount, date or tracking number. Links are masked on purpose.";

const answerSchema = z.object({ code: z.string().nullable() });

/** The prompt for one email: sender, subject and the start of the body, links masked. */
export function buildCodePrompt(input: CodeSource & { from: Contact }): string {
  return [
    `From: ${input.from.name} <${input.from.email}>`,
    `Subject: ${input.subject}`,
    "",
    textForModel(input.text),
  ].join("\n");
}

/**
 * The fallback: one small chat model call through the Vercel AI Gateway, the same key as sorting.
 * The caller checks the answer against the email, so a wrong answer here is harmless.
 */
export function createCodeFallback(apiKey: string, modelId: string): CodeFallback {
  return async (input) => {
    // Loaded on demand: the SDK is large and most launches never need it.
    const { createGateway, generateText, Output } = await import("ai");
    const result = await generateText({
      model: createGateway({ apiKey })(modelId),
      output: Output.object({ schema: answerSchema }),
      system: SYSTEM,
      prompt: buildCodePrompt(input),
      temperature: 0,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(20_000),
    });
    return result.output.code;
  };
}
