import { describe, expect, it } from "vitest";

import { chooseEmailRender, hasDarkModeRules, invertRgb, pinLightColorScheme } from "./email-html";

describe("pinLightColorScheme", () => {
  it("disables dark-mode rules and keeps light ones", () => {
    const css = "@media (prefers-color-scheme: dark){p{color:#ccc}}@media screen and ( prefers-color-scheme:LIGHT ){p{color:#000}}";
    const out = pinLightColorScheme(css);
    expect(out).not.toMatch(/prefers-color-scheme/);
    expect(out).toContain("(min-width: 99999px){p{color:#ccc}}");
    expect(out).toContain("screen and (min-width: 0px){p{color:#000}}");
  });
});

describe("hasDarkModeRules", () => {
  it("finds dark media queries only", () => {
    expect(hasDarkModeRules("@media (prefers-color-scheme: dark){a{color:red}}")).toBe(true);
    expect(hasDarkModeRules("@media screen and ( prefers-color-scheme:DARK ){a{}}")).toBe(true);
    expect(hasDarkModeRules("@media (prefers-color-scheme: light){a{}}")).toBe(false);
    expect(hasDarkModeRules("<p>prefers-color-scheme</p>")).toBe(false);
  });
});

describe("chooseEmailRender", () => {
  it("keeps white in a light theme", () => {
    expect(chooseEmailRender({ dark: false, darkAware: true, background: "theme" })).toBe("white");
  });
  it("honors a sender's dark design in a dark theme", () => {
    expect(chooseEmailRender({ dark: true, darkAware: true, background: "white" })).toBe("native");
  });
  it("follows the setting for messages without dark design", () => {
    expect(chooseEmailRender({ dark: true, darkAware: false, background: "white" })).toBe("white");
    expect(chooseEmailRender({ dark: true, darkAware: false, background: "theme" })).toBe("inverted");
  });
});

describe("invertRgb", () => {
  it("flips each channel", () => {
    expect(invertRgb("rgb(10, 20, 30)")).toBe("rgb(245, 235, 225)");
    expect(invertRgb("rgb(10 20 30 / 50%)")).toBe("rgb(245, 235, 225)");
    expect(invertRgb("hotpink")).toBeNull();
  });
});
