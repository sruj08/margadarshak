import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";

/**
 * Light cards inside the dark game stage (the road sets light text for its children): answer
 * options and every other surface must keep readable text. axe colour-contrast on each play route,
 * with an answer selected, in en and hi.
 */
const ROUTES = [
  "/en/learn/practise/ll-sim/exam?mode=mock&state=JK",
  "/hi/learn/practise/ll-sim/exam?mode=mock&state=JK",
  "/en/learn/practise/ll-sim/exam?mode=practice&state=JK",
  "/en/learn/practise/stopping-distance/play",
  "/en/learn/practise/blind-spot/play",
  "/en/learn/practise/nazar/play",
];

for (const route of ROUTES) {
  test(`colour contrast on the stage: ${route} @a11y`, async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== "mobile-360", "stage routes run on the 360 px profile");
    await onboard(context, baseURL ?? "", route.startsWith("/hi") ? "hi" : "en");
    await page.goto(route);
    const start = page.getByTestId("stage-start");
    if (
      await start.waitFor({ timeout: 20_000 }).then(
        () => true,
        () => false,
      )
    )
      await start.click();
    if (route.includes("ll-sim")) {
      const opt = page.locator(".ml-opt").first();
      await opt.waitFor({ timeout: 20_000 });
      await opt.click();
      const { fg, bg } = await opt.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fg: s.color, bg: s.backgroundColor };
      });
      expect(fg, "option text must not match its card").not.toBe(bg);
    }
    await page.waitForTimeout(500);
    const r = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(
      r.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))),
      route,
    ).toEqual([]);
  });
}
