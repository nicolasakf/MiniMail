import { describe, expect, it } from "vitest";

import { chooseEmailRender, hasDarkModeRules, pinLightColorScheme, preFlipRgb } from "./email-html";

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
  it("keeps white in a light theme unless the setting is Theme", () => {
    expect(chooseEmailRender({ dark: false, darkAware: true, background: "white" })).toBe("white");
    expect(chooseEmailRender({ dark: false, darkAware: false, background: "white" })).toBe("white");
  });
  it("paints the theme's color in a light theme when the setting is Theme", () => {
    expect(chooseEmailRender({ dark: false, darkAware: true, background: "theme" })).toBe("tinted");
    expect(chooseEmailRender({ dark: false, darkAware: false, background: "theme" })).toBe("tinted");
  });
  it("honors a sender's dark design in a dark theme", () => {
    expect(chooseEmailRender({ dark: true, darkAware: true, background: "white" })).toBe("native");
  });
  it("follows the setting for messages without dark design", () => {
    expect(chooseEmailRender({ dark: true, darkAware: false, background: "white" })).toBe("white");
    expect(chooseEmailRender({ dark: true, darkAware: false, background: "theme" })).toBe("inverted");
  });
});

describe("preFlipRgb", () => {
  it("keeps the dark card grey once the filter has run", () => {
    // The dark card is a bluish grey; a plain inversion came out brownish.
    const [red, green, blue] = (preFlipRgb("rgb(37, 38, 42)") ?? "").match(/\d+/g)!.map(Number);
    expect([red, green, blue]).toEqual([216, 217, 221]);
  });

  it("leaves pure greys as plain inversions", () => {
    expect(preFlipRgb("rgb(40, 40, 40)")).toBe("rgb(215, 215, 215)");
  });

  it("returns null for colors it cannot parse", () => {
    expect(preFlipRgb("hotpink")).toBeNull();
  });
});
