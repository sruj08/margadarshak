import { describe, expect, it } from "vitest";
import { applyPrefs, DEFAULT_PREFS, parsePrefs } from "./prefs";

function fakeHtml() {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  return {
    attrs,
    classes,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      remove: (...cs: string[]) => {
        for (const c of cs) classes.delete(c);
      },
    },
  };
}

describe("display preferences (MD-023)", () => {
  it("falls back to light mode defaults on missing or broken storage", () => {
    expect(DEFAULT_PREFS.theme).toBe("light");
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ theme: "neon" }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ theme: "system" })).theme).toBe("system");
  });

  it("applies theme, contrast and reduced motion as the attributes tokens.css reads", () => {
    const html = fakeHtml();
    applyPrefs(html as unknown as HTMLElement, {
      theme: "dark",
      contrast: true,
      reducedMotion: true,
    });
    expect(html.attrs.get("data-theme")).toBe("dark");
    expect(html.attrs.get("data-contrast")).toBe("more");
    expect(html.attrs.get("data-motion")).toBe("reduced");
    expect(html.classes.has("dark")).toBe(true);
    expect(html.classes.has("light")).toBe(false);

    applyPrefs(html as unknown as HTMLElement, DEFAULT_PREFS);
    expect(html.attrs.get("data-theme")).toBe("light");
    expect(html.attrs.has("data-contrast")).toBe(false);
    expect(html.attrs.has("data-motion")).toBe(false);
    expect(html.classes.has("light")).toBe(true);
    expect(html.classes.has("dark")).toBe(false);

    applyPrefs(html as unknown as HTMLElement, { ...DEFAULT_PREFS, theme: "system" });
    expect(html.attrs.has("data-theme")).toBe(false);
    expect(html.classes.size).toBe(0);
  });
});
