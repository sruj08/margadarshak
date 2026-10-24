import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { LOCALES, onboard, ROUTES } from "./helpers";

/**
 * axe on every P0 route in en and hi, light and dark (MD-014, MD-026). Any serious or critical
 * violation fails. WCAG 2.0/2.1/2.2 A + AA tags.
 */
const THEMES = ["light", "dark"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const locale of LOCALES) {
  for (const route of ROUTES) {
    for (const theme of THEMES) {
      test(`axe ${locale}${route || "/"} [${theme}] @a11y`, async ({ page, context, baseURL }) => {
        await onboard(context, baseURL ?? "", locale);
        await page.addInitScript((t) => {
          localStorage.setItem("md.prefs", JSON.stringify({ theme: t }));
        }, theme);
        await page.goto(`/${locale}${route}`);
        await page.waitForLoadState("load");
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const serious = results.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        );
        expect(
          serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })),
        ).toEqual([]);
      });
    }
  }
}

test("interactive targets on home are at least 48 x 48 px @a11y", async ({
  page,
  context,
  baseURL,
}) => {
  await onboard(context, baseURL ?? "", "hi");
  await page.goto("/hi");
  const small = await page.$$eval(
    "main button, main a[href], header button, header a[href], nav a[href], footer a[href]",
    (els) =>
      els
        .map((e) => ({ text: e.textContent?.trim(), r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.width < 47.5 || x.r.height < 47.5))
        .map((x) => `${x.text} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
  );
  expect(small).toEqual([]);
});

test("skip link moves focus to the main content @a11y", async ({ page, context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
  await page.goto("/en");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});
