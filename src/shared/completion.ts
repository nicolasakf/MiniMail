import type { Contact } from "./types";

/**
 * Text completion in the composer: the model suggests what comes next as dimmed text after the
 * cursor, Tab accepts it and Esc refuses it. It has a model of its own, on the provider chosen for
 * the AI-enabled features.
 */

/** How much the model may write at once. */
export const COMPLETION_LENGTHS = ["sentence", "paragraph", "full"] as const;
export type CompletionLength = (typeof COMPLETION_LENGTHS)[number];

export interface CompletionSettings {
  /** Off until the person turns it on: it sends what they write, and the conversation, to the model. */
  enabled: boolean;
  length: CompletionLength;
  /** A small, fast chat model of the provider chosen for the AI-enabled features. Empty means no suggestions. */
  model: string;
}

export const DEFAULT_COMPLETION: CompletionSettings = { enabled: false, length: "sentence", model: "openai/gpt-4.1-nano" };

export const COMPLETION_LENGTH_LABELS: Record<CompletionLength, string> = {
  sentence: "Sentence",
  paragraph: "Paragraph",
  full: "Full message",
};

export const COMPLETION_LENGTH_HELP: Record<CompletionLength, string> = {
  sentence: "Finishes the sentence you are writing, or writes the next one.",
  paragraph: "Finishes the paragraph you are writing.",
  full: "Writes the rest of the message, signature aside.",
};

/** One earlier message of the conversation, as the model sees it. */
export interface CompletionMessage {
  from: Contact;
  /** ISO timestamp. */
  date: string;
  text: string;
}

/** What the composer knows about the message being written, other than the text itself. */
export interface CompletionContext {
  mode: "new" | "reply" | "replyAll" | "forward";
  subject: string;
  /** The account the message is sent from: who "I" is. */
  me: Contact;
  to: Contact[];
  cc: Contact[];
  /** The message being answered, as it is quoted under the reply. */
  quoted?: string;
  /** Earlier messages of the conversation, oldest first, when they are known. */
  earlier?: CompletionMessage[];
}

export interface CompletionRequest {
  /** Which composer asks: a newer request from the same one replaces the one still running. */
  session: string;
  /** What is written before the cursor, as plain text. */
  before: string;
  /** What is written after it (usually nothing: the dimmed text only shows at the end of a paragraph). */
  after: string;
  context: CompletionContext;
}

/** How much of each part is sent. The newest text matters most, so the beginning of a long one is cut. */
export const COMPLETION_LIMITS = {
  before: 4_000,
  after: 800,
  quoted: 3_000,
  earlierMessages: 4,
  earlierText: 1_500,
  subject: 300,
  recipients: 20,
} as const;

/**
 * The most the model may write for each length, in tokens. Reasoning models count their thinking
 * against the same limit, so `COMPLETION_THINKING_ROOM` is added on top when the call is made.
 */
export const COMPLETION_MAX_TOKENS: Record<CompletionLength, number> = {
  sentence: 60,
  paragraph: 180,
  full: 600,
};

/** Tokens a reasoning model may spend thinking before it writes, on top of the text itself. */
export const COMPLETION_THINKING_ROOM = 500;

/** Ghost text is a hint, not a letter: a slow answer is not worth waiting for. */
export const COMPLETION_TIMEOUT_MS = 12_000;
