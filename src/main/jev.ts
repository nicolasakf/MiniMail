import { NO_CATEGORY_NAME } from "@shared/categories";
import { DEFAULT_SORT_MODEL } from "@shared/ai-models";
import { DEFAULT_SORT_MODELS, PROVIDER_LABELS, type AiProvider } from "@shared/ai-providers";
import type { Category, Contact, SmartCategory } from "@shared/types";

import { callSystemOne } from "./ai-provider";

/**
 * Jev (TypeSafe AI's System One model), reached through the Vercel AI Gateway, OpenRouter or TypeSafe's
 * own API, whichever the person chose. It answers a
 * typed Choice question with a probability for every option, which is exactly what sorting
 * mail into the user's categories needs, and it is far cheaper and faster than a chat model.
 */
export const JEV_MODEL = DEFAULT_SORT_MODEL;

/** Below this probability the answer is treated as "no category": better a plain row than a wrong group. */
export const MIN_PROBABILITY = 0.4;

const PREVIEW_CHARS = 1000;

export interface ClassificationInput {
  from: Contact;
  subject: string;
  /** Start of the message body, plain text. */
  preview: string;
  /** What the headers say; see `SmartCategory`. */
  signal: SmartCategory;
}

export interface Classification {
  /** Null when the classifier says nothing fits (or is not sure enough). */
  categoryId: string | null;
  probability: number;
}

export type Classifier = (
  input: ClassificationInput,
  categories: readonly Category[],
  /** `model` tries a model other than the saved one (the connection test of an unsaved choice). */
  options?: { model?: string },
) => Promise<Classification>;

const SIGNAL_FACTS: Record<SmartCategory, string> = {
  person: "No automation or bulk-mail headers.",
  notification: "Sent by an automated sender (no-reply style address or a known service).",
  newsletter: "Carries bulk-mail headers (List-Unsubscribe / List-Id).",
  invitation: "Contains a calendar invitation (text/calendar request).",
  "invitation-response": "Contains a calendar reply (accept, decline or tentative).",
};

/**
 * Strips what the classifier does not need and should not receive. Verification emails carry
 * live secrets in the body, so digit runs (codes) and URL paths and query strings (magic-link
 * tokens) are masked; the sender and the shape of the text stay, which is all that matters.
 */
export function redactForClassification(text: string): string {
  return text
    .replace(/https?:\/\/([^\s/<>"')]+)[^\s<>"')]*/gi, "[link $1]")
    .replace(/\b\d{4,}\b/g, "[digits]")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_CHARS);
}

export interface ClassificationRequest {
  state: {
    email: { from: { name: string; address: string }; subject: string; preview: string };
    headerFacts: string;
  };
  questions: {
    category: {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    };
  };
  /** Option name (what the model sees) back to the category it stands for. */
  optionToId: Map<string, string>;
}

/** Builds the one Choice question that sorts an email into the user's categories. */
export function buildClassificationRequest(
  input: ClassificationInput,
  categories: readonly Category[],
): ClassificationRequest {
  const criteria: Record<string, string> = {};
  const optionToId = new Map<string, string>();
  for (const category of categories) {
    criteria[category.name] = category.criteria;
    optionToId.set(category.name, category.id);
  }
  criteria[NO_CATEGORY_NAME] =
    "A regular message written by a person to the recipient, such as a conversation, a request, a question or a reply, or anything that clearly fits none of the other categories.";

  return {
    state: {
      email: {
        from: { name: input.from.name, address: input.from.email },
        subject: input.subject,
        preview: redactForClassification(input.preview),
      },
      headerFacts: SIGNAL_FACTS[input.signal],
    },
    questions: {
      category: {
        type: "choice",
        instructions:
          "Which category does this email belong to? Decide by what the email is for, using its sender, subject and preview, and pick the single best match. Digits and links in the preview are masked on purpose.",
        criteria,
      },
    },
    optionToId,
  };
}

/** Turns the model's answer into a category, applying the confidence floor. */
export function readClassification(
  answer: { choice: string; probabilities?: Record<string, number> },
  optionToId: ReadonlyMap<string, string>,
): Classification {
  const probability = answer.probabilities?.[answer.choice] ?? 1;
  const categoryId = optionToId.get(answer.choice) ?? null;
  if (categoryId === null || probability < MIN_PROBABILITY) {
    return { categoryId: null, probability };
  }
  return { categoryId, probability };
}

/** An error whose text is already fit for a person (it names its provider), so it is shown as it is. */
export class DescribedError extends Error {}

/** How a provider is named at the start of a sentence. */
function subject(provider: AiProvider): string {
  return provider === "openrouter" ? PROVIDER_LABELS.openrouter : `The ${PROVIDER_LABELS[provider]}`;
}

/** Maps a provider's failures to something a person can act on. */
export function describeAiError(error: unknown, provider: AiProvider = "vercel"): string {
  if (error instanceof DescribedError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;
  const who = subject(provider);
  if (status === 401 || /unauthenticated|invalid api key|no authentication/i.test(raw)) {
    return `${who} rejected the API key. Check it and save it again.`;
  }
  if (status === 402 || /credit|billing|payment/i.test(raw)) {
    return `${who} says this key has no credit left.`;
  }
  if (status === 429 || /rate limit/i.test(raw)) {
    return `${who} is rate limiting requests; MiniMail will retry shortly.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return `Could not reach ${who.replace(/^The /, "the ")}. Check your connection.`;
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

/**
 * The real classifier: one call per conversation to the sorting model (Jev unless changed), through the
 * provider the person chose: the Vercel AI Gateway, OpenRouter or TypeSafe's own API.
 */
export function createJevClassifier(
  getProvider: () => AiProvider,
  getKey: (provider: AiProvider) => string | undefined,
  getModel: () => string = () => DEFAULT_SORT_MODELS[getProvider()],
): Classifier {
  return async (input, categories, options) => {
    const provider = getProvider();
    const apiKey = getKey(provider);
    if (!apiKey) throw new DescribedError(`No ${PROVIDER_LABELS[provider]} key is set.`);

    const request = buildClassificationRequest(input, categories);
    const model = options?.model || getModel();

    if (provider === "vercel") {
      // Loaded on demand: the SDK is large and most launches never classify anything.
      const { createGateway, experimental_decide: decide } = await import("ai");
      const result = await decide({
        model: createGateway({ apiKey }).decisionModel(model),
        state: request.state,
        questions: request.questions,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(20_000),
      });
      return readClassification(result.answers.category, request.optionToId);
    }

    const answers = await callSystemOne(
      provider,
      apiKey,
      { model, state: request.state, questions: request.questions },
      AbortSignal.timeout(20_000),
    );
    const answer = answers.category;
    if (!answer?.choice) throw new DescribedError(`${subject(provider)} did not answer the sorting question.`);
    return readClassification({ choice: answer.choice, probabilities: answer.probabilities }, request.optionToId);
  };
}
