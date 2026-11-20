/**
 * The model that sorts mail into categories. It answers a typed Choice question with a
 * probability for each option (TypeSafe AI's Jev, reached through the Vercel AI Gateway by default).
 * Any decision model id of the chosen provider works; the user can change it under Advanced in the settings.
 */
export const DEFAULT_SORT_MODEL = "typesafe-ai/jev";

/**
 * What a sorting model id looks like: "provider/model" for the Vercel AI Gateway and OpenRouter, and a
 * bare name such as "jev-latest" for TypeSafe's own API. The sorting model cannot be empty.
 */
export const SORT_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._:-]*)?$/i;

/** The two things a model is used for, each with its own model and its own connection test. */
export const MODEL_PURPOSES = ["sorting", "features"] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];
