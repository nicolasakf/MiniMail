import { describe, expect, it } from "vitest";

import { autoLoadsImages, trustKey } from "./trust";

describe("autoLoadsImages", () => {
  const trusted = new Set(["news@brand.com"]);

  it("loads for a trusted address whose message was verified, ignoring case", () => {
    expect(autoLoadsImages(trusted, { email: "News@Brand.com" }, true)).toBe(true);
  });

  it("does not load when the message could not be verified, however trusted the address", () => {
    expect(autoLoadsImages(trusted, { email: "news@brand.com" }, false)).toBe(false);
    expect(autoLoadsImages(trusted, { email: "news@brand.com" }, undefined)).toBe(false);
  });

  it("trusts one address, not the whole domain", () => {
    expect(autoLoadsImages(trusted, { email: "other@brand.com" }, true)).toBe(false);
  });

  it("normalizes keys", () => {
    expect(trustKey("  A@B.Com ")).toBe("a@b.com");
  });
});
