import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";
import { loadPersona, makePlan, mobileOnly } from "./journey-helpers";

/**
 * axe on every new P1 route, en and hi, light and dark, at 360 px (WCAG 2.0/2.1/2.2 A + AA).
 * Routes that need a plan or a case get one first (mock API).
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEMES = ["light", "dark"] as const;
const LOCALES = ["en", "hi"] as const;
const TOKEN = process.env["LAB_TOKEN"] ?? "";

async function axe(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const v = results.violations
    .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
  if (overflow > 0 && !page.url().includes("/lab/"))
    v.push({ id: "horizontal-scroll-360", nodes: [String(overflow)] });
  return v;
}

const STATIC = [
  "/plan",
  "/services",
  "/services/renew",
  "/services/minor-riding",
  "/privacy",
  "/privacy/notice",
  "/apply/handoff/ekyc",
  "/signin",
];
const WITH_CASE = [
  "",
  "/licence",
  "/apply",
  "/apply/start",
  "/apply/q/for_whom",
  "/apply/q/category",
  "/apply/q/aadhaar_relation_line",
  "/apply/documents",
  "/apply/signature",
  "/apply/photo",
  "/apply/check",
  "/apply/fee",
  "/apply/handoff",
  "/apply/handoff/pack",
  "/apply/handoff/return",
  "/apply/payment-pending",
  "/apply/application-number",
];

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test(`axe P1 journey routes ${locale} [${theme}] @a11y`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
      test.setTimeout(180_000);
      await onboard(context, baseURL ?? "", locale);
      await page.addInitScript(
        (t) => localStorage.setItem("md.prefs", JSON.stringify({ theme: t })),
        theme,
      );
      const failures: Record<string, unknown> = {};
      for (const r of STATIC) {
        await page.goto(`/${locale}${r}`);
        const v = await axe(page);
        if (v.length) failures[r] = v;
      }
      // A plan card, its blockers and class planner (Tanvi has blockers to render).
      await page.goto("/en/plan");
      await makePlan(page, {
        age: { dob: ["07", "07", "2007"] },
        vehicles: [/Scooter, no gears/],
        aadhaar: "No, it's elsewhere",
      });
      const planUrl = new URL(page.url());
      for (const r of ["/plan/card", "/plan/blockers", "/plan/classes"]) {
        await page.goto(`/${locale}${r}${planUrl.search}`);
        const v = await axe(page);
        if (v.length) failures[r] = v;
      }
      await loadPersona(page, "Tanvi, with blockers", "en");
      for (const r of WITH_CASE) {
        await page.goto(`/${locale}${r}`);
        const v = await axe(page);
        if (v.length) failures[r || "/ (stage home)"] = v;
      }
      await loadPersona(page, "DL holder", "en");
      await page.goto(`/${locale}/licence`);
      const lic = await axe(page);
      if (lic.length) failures["/licence (DL holder)"] = lic;
      if (TOKEN) {
        await page.goto(`/${locale}/lab/sarathi-sequence?token=${TOKEN}`);
        const v = await axe(page);
        if (v.length) failures["/lab/sarathi-sequence"] = v;
      }
      expect(failures).toEqual({});
    });
  }
}
