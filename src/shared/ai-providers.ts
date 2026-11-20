/**
 * Where AI calls go. Two jobs use a provider, each with its own choice:
 *  - sorting mail into categories, which needs a decision model (Jev): reached through the Vercel AI
 *    Gateway, through OpenRouter, or straight at TypeSafe's own API;
 *  - the AI-enabled features (reading verification codes), which need a chat model: Vercel or OpenRouter.
 * Each provider has its own key, so changing the provider never loses another one's key.
 */
export const AI_PROVIDERS = ["vercel", "openrouter", "typesafe"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Providers that can run a chat model (TypeSafe's own API only serves its decision models). */
export const CHAT_PROVIDERS = ["vercel", "openrouter"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];

export function isChatProvider(provider: AiProvider): provider is ChatProvider {
  return (CHAT_PROVIDERS as readonly string[]).includes(provider);
}

export const DEFAULT_PROVIDER: AiProvider = "vercel";

/** What the person sees. */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  vercel: "Vercel AI Gateway",
  openrouter: "OpenRouter",
  typesafe: "TypeSafe API",
};

/** Where a key is created. */
export const PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  vercel: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys",
  openrouter: "https://openrouter.ai/settings/keys",
  typesafe: "https://typesafe.ai",
};

/** The model that sorts mail, per provider: each names Jev its own way. */
export const DEFAULT_SORT_MODELS: Record<AiProvider, string> = {
  vercel: "typesafe-ai/jev",
  openrouter: "typesafe/jev-1.13",
  typesafe: "jev-latest",
};

/** The chat model for the AI-enabled features, per provider. */
export const DEFAULT_CODE_MODELS: Record<ChatProvider, string> = {
  vercel: "reflection/beam",
  openrouter: "reflection/beam-1.0-501b-a23b",
};

/** Base URL of the System One endpoint for the providers that are called directly (not through the AI SDK). */
export const SYSTEM_ONE_URLS: Partial<Record<AiProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1/systemone",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};

/** Which providers have a key saved. */
export type ProviderKeys = Record<AiProvider, boolean>;

export function noKeys(): ProviderKeys {
  return { vercel: false, openrouter: false, typesafe: false };
}
