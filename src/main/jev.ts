import { NO_CATEGORY_NAME } from "@shared/categories";
import type { Category, Contact, SmartCategory } from "@shared/types";

/**
 * Jev (TypeSafe AI's System One model) reached through the Vercel AI Gateway. It answers a
 * typed Choice question with a probability for every option, which is exactly what sorting
 * mail into the user's categories needs, and it is far cheaper and faster than a chat model.
 */
export const JEV_MODEL = "typesafe-ai/jev";

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

/** Maps the gateway's failures to something a person can act on. */
export function describeGatewayError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : undefined;
  if (status === 401 || /unauthenticated|invalid api key|no authentication/i.test(raw)) {
    return "The Vercel AI Gateway rejected the API key. Check it and save it again.";
  }
  if (status === 402 || /credit|billing|payment/i.test(raw)) {
    return "The Vercel AI Gateway says this key has no credit left.";
  }
  if (status === 429 || /rate limit/i.test(raw)) {
    return "The Vercel AI Gateway is rate limiting requests; MiniMail will retry shortly.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return "Could not reach the Vercel AI Gateway. Check your connection.";
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

/** The real classifier: one Jev call per conversation through the Vercel AI Gateway. */
export function createJevClassifier(getKey: () => string | undefined): Classifier {
  return async (input, categories) => {
    const apiKey = getKey();
    if (!apiKey) throw new Error("No Vercel AI Gateway key is set.");

    // Loaded on demand: the SDK is large and most launches never classify anything.
    const { createGateway, experimental_decide: decide } = await import("ai");
    const request = buildClassificationRequest(input, categories);
    const result = await decide({
      model: createGateway({ apiKey }).decisionModel(JEV_MODEL),
      state: request.state,
      questions: request.questions,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(20_000),
    });
    return readClassification(result.answers.category, request.optionToId);
  };
}
