import { describe, expect, it } from "vitest";

import { accountDetail, accountLabel, coverCrop, MAX_ALIAS_LENGTH, MAX_AVATAR_BYTES, normalizeAlias } from "./accounts";
import { addAccountSchema, aliasSchema, avatarSchema } from "./schemas";

describe("normalizeAlias", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAlias("  Work   mail \n")).toBe("Work mail");
  });

  it("treats blank, missing and whitespace-only values as no alias", () => {
    expect(normalizeAlias("")).toBeUndefined();
    expect(normalizeAlias("   \t ")).toBeUndefined();
    expect(normalizeAlias(undefined)).toBeUndefined();
    expect(normalizeAlias(null)).toBeUndefined();
  });

  it("drops control and invisible formatting characters", () => {
    // Zero-width space and a right-to-left override cannot be used to disguise an alias.
    expect(normalizeAlias("Wo​rk‮")).toBe("Work");
    expect(normalizeAlias("\u0007")).toBeUndefined();
  });

  it("keeps accents, emoji and other scripts", () => {
    expect(normalizeAlias("Café ☕")).toBe("Café ☕");
    expect(normalizeAlias("大学")).toBe("大学");
  });
});

describe("accountLabel and accountDetail", () => {
  const email = "alex@example.com";

  it("shows the alias when there is one", () => {
    expect(accountLabel({ email, alias: "Work" })).toBe("Work");
    expect(accountDetail({ email, alias: "Work" })).toBe("Work · alex@example.com");
  });

  it("falls back to the address", () => {
    expect(accountLabel({ email })).toBe(email);
    expect(accountDetail({ email })).toBe(email);
    expect(accountLabel({ email, alias: "   " })).toBe(email);
  });
});

describe("alias validation", () => {
  it("accepts a blank alias (it clears) and one at the limit", () => {
    expect(aliasSchema.safeParse("").success).toBe(true);
    expect(aliasSchema.safeParse("x".repeat(MAX_ALIAS_LENGTH)).success).toBe(true);
  });

  it("rejects an alias that is too long once cleaned", () => {
    expect(aliasSchema.safeParse("x".repeat(MAX_ALIAS_LENGTH + 1)).success).toBe(false);
    expect(aliasSchema.safeParse("x".repeat(10_000)).success).toBe(false);
  });

  it("does not count the padding around an alias", () => {
    expect(aliasSchema.safeParse(`   ${"x".repeat(MAX_ALIAS_LENGTH)}   `).success).toBe(true);
  });

  it("is accepted on every add-account variant", () => {
    const withAlias = [
      { kind: "password", provider: "zoho", email: "a@b.co", password: "pw", alias: "Work" },
      { kind: "password", provider: "gmail", email: "a@b.co", password: "pw", alias: "Me" },
      { kind: "oauth", provider: "gmail", alias: "Me" },
      { kind: "oauth", provider: "outlook", outlookKind: "work-school", alias: "Uni" },
    ];
    for (const input of withAlias) expect(addAccountSchema.safeParse(input).success).toBe(true);
  });

  it("rejects an over-long alias when adding an account", () => {
    const input = { kind: "oauth", provider: "gmail", alias: "x".repeat(MAX_ALIAS_LENGTH + 1) };
    expect(addAccountSchema.safeParse(input).success).toBe(false);
  });
});

describe("coverCrop", () => {
  it("crops the center square of a wide, tall or square image", () => {
    expect(coverCrop(400, 200)).toEqual({ x: 100, y: 0, size: 200 });
    expect(coverCrop(200, 500)).toEqual({ x: 0, y: 150, size: 200 });
    expect(coverCrop(64, 64)).toEqual({ x: 0, y: 0, size: 64 });
  });
});

describe("avatarSchema", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("accepts PNG, JPEG and WebP data URLs, and null to remove", () => {
    expect(avatarSchema.safeParse(png).success).toBe(true);
    expect(avatarSchema.safeParse("data:image/jpeg;base64,/9j/4AAQ").success).toBe(true);
    expect(avatarSchema.safeParse("data:image/webp;base64,UklGRg==").success).toBe(true);
    expect(avatarSchema.safeParse(null).success).toBe(true);
  });

  it("rejects anything else: SVG, scripts, plain URLs, other types, oversize", () => {
    for (const bad of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://example.com/me.png",
      "javascript:alert(1)",
      "data:image/png;base64,",
      "data:image/png;utf8,<svg>",
      `data:image/png;base64,${"A".repeat(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 100)}`,
    ]) {
      expect(avatarSchema.safeParse(bad).success, bad.slice(0, 40)).toBe(false);
    }
  });
});
