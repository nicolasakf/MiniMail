import type { Account } from "./types";

/** Longest alias the UI accepts; it has to fit in the account switcher and the From picker. */
export const MAX_ALIAS_LENGTH = 40;

/**
 * Cleans a user-typed alias: collapses whitespace, drops control and invisible formatting
 * characters (so an alias cannot hide text or flip its direction), and trims. Blank means
 * "no alias", returned as undefined.
 */
export function normalizeAlias(value: string | null | undefined): string | undefined {
  const cleaned = (value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

/** Pictures are stored inside the accounts file, so they are kept small (the page shrinks them first). */
export const MAX_AVATAR_BYTES = 60 * 1024;

/** The source rectangle for a centered square crop of a width x height image. */
export function coverCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/** What the UI calls an account: the alias the user chose, or the address when there is none. */
export function accountLabel(account: Pick<Account, "alias" | "email">): string {
  return normalizeAlias(account.alias) ?? account.email;
}

/** Label plus address, for tooltips and pickers where the address still has to be findable. */
export function accountDetail(account: Pick<Account, "alias" | "email">): string {
  const alias = normalizeAlias(account.alias);
  return alias ? `${alias} · ${account.email}` : account.email;
}
