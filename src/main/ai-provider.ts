import type { LanguageModel } from "ai";
import { z } from "zod";

import { SYSTEM_ONE_URLS, type AiProvider, type ChatProvider } from "@shared/ai-providers";

/**
 * The two ways MiniMail reaches a model, whichever provider the person chose.
 *
 *  - A chat model (the AI-enabled features) goes through the AI SDK: the Vercel AI Gateway or OpenRouter.
 *  - A decision model (sorting, Jev) is asked a typed question. The Vercel AI Gateway has an AI SDK
 *    adapter for it; OpenRouter and TypeSafe's own API share one HTTP shape (`POST /v1/systemone`),
 *    which `callSystemOne` speaks directly.
 */

/** A failed HTTP call, carrying the status the way the AI SDK's own errors do (`statusCode`). */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** A chat model of `provider`. The SDK is loaded on demand: it is large and most launches never call a model. */
export async function chatModel(provider: ChatProvider, apiKey: string, modelId: string): Promise<LanguageModel> {
  if (provider === "openrouter") {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({ apiKey }).chat(modelId);
  }
  const { createGateway } = await import("ai");
  return createGateway({ apiKey })(modelId);
}

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, unknown>;
}

const answerSchema = z.object({
  type: z.string(),
  choice: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const responseSchema = z.object({ answers: z.record(z.string(), answerSchema) });

export type SystemOneAnswers = z.infer<typeof responseSchema>["answers"];

/** What a failed System One call says, from the error shapes OpenRouter and TypeSafe use. */
function failureText(body: unknown, status: number): string {
  const read = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
    return null;
  };
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    return read(record.error) ?? read(record.detail) ?? read(record.message) ?? `The request failed (${status}).`;
  }
  return `The request failed (${status}).`;
}

/** Asks a System One model the typed questions, through OpenRouter or TypeSafe's own API. */
export async function callSystemOne(
  provider: Exclude<AiProvider, "vercel">,
  apiKey: string,
  request: SystemOneRequest,
  signal: AbortSignal,
): Promise<SystemOneAnswers> {
  const url = SYSTEM_ONE_URLS[provider];
  if (!url) throw new Error(`No decision endpoint is known for ${provider}.`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request),
    signal,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // expected: an error page or an empty body is not JSON; the status below says what went wrong.
  }
  if (!response.ok) throw new ProviderHttpError(failureText(body, response.status), response.status);
  return responseSchema.parse(body).answers;
}
