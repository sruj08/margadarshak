import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { FOOTER_TEXT, onboard } from "./helpers";

/**
 * P2 · Stopping Distance (G2, SVG) and Blind Spot (G3, Phaser 4 + the DOM decision version) on the
 * mock build: device sessions over the game-core fixture items, provisional scores (MD-216, MD-217,
 * MD-229). The DOM loops run on Playwright's fake clock where a ride or a step-out wait would
 * otherwise take real seconds.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const mobileOnly = (t: TestInfo) => t.project.name !== "mobile-360";

declare global {
  interface Window {
    __mdGames?: Record<string, boolean>;
    __mdPhaser?: { requestedAt: number; loadedAt?: number };
  }
}

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations
    .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.use({ trace: "off" });

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test("Phaser is not requested until the Blind Spot game opens @smoke", async ({ page }) => {
  await page.goto("/en/learn/practise/blind-spot");
  await expect(page.getByTestId("game-brief")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => window.__mdPhaser)).toBeUndefined();
  expect(await page.evaluate(() => window.__mdGames)).toBeUndefined();

  // Stopping Distance never asks for Phaser, even in play.
  await page.goto("/en/learn/practise/stopping-distance/play?mode=practice");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("sd-predict")).toBeVisible();
  expect(await page.evaluate(() => window.__mdGames?.["stopping_distance"])).toBe(true);
  expect(await page.evaluate(() => window.__mdPhaser)).toBeUndefined();

  // Blind Spot: the engine is requested only once the canvas game is on screen.
  await page.goto("/en/learn/practise/blind-spot");
  await page.getByTestId("brief-start").click();
  await expect(page).toHaveURL(/\/en\/learn\/practise\/blind-spot\/play\?mode=practice/);
  await expect(page.getByTestId("stage-start")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => window.__mdGames?.["blind_spot"])).toBe(true);
  expect(await page.evaluate(() => window.__mdPhaser)).toBeUndefined();
  await page.getByTestId("stage-start").click();
  const variant = await page.getByTestId("bs-game").getAttribute("data-variant");
  if (variant === "canvas") {
    await expect(page.getByTestId("bs-canvas-a").locator("canvas")).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.evaluate(() => typeof window.__mdPhaser?.requestedAt)).toBe("number");
  } else {
    // No WebGL in this browser: the decision version, and still no engine.
    expect(await page.evaluate(() => window.__mdPhaser)).toBeUndefined();
  }
});

test("the decision version never loads Phaser", async ({ page }) => {
  await page.goto("/en/learn/practise/blind-spot/play?mode=practice&variant=decision");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("bs-game")).toHaveAttribute("data-variant", "decision");
  await expect(page.getByTestId("bs-format-note")).toContainText("A different format");
  expect(await page.evaluate(() => window.__mdPhaser)).toBeUndefined();
});

test("a Stopping Distance run reaches results", async ({ page }, info) => {
  test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
  test.setTimeout(120_000);
  await page.clock.install();
  await page.goto("/en/learn/practise/stopping-distance/play?mode=practice");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("game-hud")).toBeVisible();
  for (let i = 0; i < 12; i++) {
    // Wait for the next actionable control (a round is "open" only before its answer).
    const results = page.getByTestId("results-reveal");
    const guess = page.getByTestId("sd-lock");
    const speeds = page.getByTestId("sd-speeds");
    const sight = page.getByTestId("sd-sight-speed");
    await expect(guess.or(speeds).or(sight).or(results)).toBeVisible({ timeout: 20_000 });
    if (await results.isVisible()) break;
    if (await guess.isVisible()) {
      for (let k = 0; k < 4; k++) await page.getByTestId("sd-guess-plus-10").click();
      await guess.click();
      await expect(page.getByTestId("sd-total")).toContainText("Real: about");
    } else if (await speeds.isVisible()) {
      await page.getByTestId("sd-speed-20").click();
      await page.getByTestId("sd-ride").click();
      // The seeded step-out wait is 1.5 to 4 s: advance until the child steps out.
      for (let ms = 0; ms < 4_200; ms += 100) {
        if ((await page.getByTestId("sd-status").textContent()) === "A child steps out!") break;
        await page.clock.runFor(100);
      }
      await expect(page.getByTestId("sd-status")).toHaveText("A child steps out!");
      await page.clock.runFor(800);
      await page.getByTestId("sd-brake").click();
      await expect(page.getByTestId("sd-outcome")).toBeVisible();
      await expect(page.getByTestId("sd-rt")).toContainText("(not scored)");
    } else {
      await page.getByTestId("sd-ride").click();
      await expect(page.getByTestId("sd-max-safe")).toContainText(
        "was the most you could stop from",
      );
    }
    await page.getByTestId("sd-next").click();
  }
  await expect(page.getByTestId("results-reveal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("reveal-status")).toHaveText("Provisional: not checked yet");
  await expect(page.getByTestId("sd-results")).toContainText("Stopping in the street");
  await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT.en);
});

test("the Blind Spot decision version (tap-only) reaches results", async ({ page }, info) => {
  test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
  test.setTimeout(120_000);
  await page.clock.install();
  await page.goto("/en/learn/practise/blind-spot/play?mode=practice&variant=decision");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  for (let i = 0; i < 20; i++) {
    const results = page.getByTestId("results-reveal");
    const partA = page.getByTestId("bs-part-a");
    const plan = page.getByTestId("bs-plan-start");
    await expect(partA.or(plan).or(results)).toBeVisible({ timeout: 20_000 });
    if (await results.isVisible()) break;
    if (await partA.isVisible()) {
      // Spot 8 is well behind the vehicle: outside every no-zone.
      await page.locator("label", { has: page.getByTestId("bs-spot-8") }).click();
      await page.getByTestId("bs-place").click();
      await expect(page.getByTestId("bs-feedback")).toHaveAttribute("data-correct", "true");
      await page.getByTestId("bs-next").click();
    } else {
      await page.locator("label", { has: page.getByTestId("bs-plan-follow-back") }).click();
      await page.locator("label", { has: page.getByTestId("bs-plan-lane-mirror") }).click();
      await page.locator("label", { has: page.getByTestId("bs-plan-turn-hold") }).click();
      await plan.click();
      await expect(page.getByTestId("bs-ride-diagram")).toBeVisible();
      await page.clock.runFor(21_000);
      await expect(page.getByTestId("bs-ride-over")).toHaveAttribute("data-critical", "false");
      await page.getByTestId("bs-next").click();
    }
  }
  await expect(page.getByTestId("results-reveal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("bs-results")).toContainText("Placement: 30 of 30");
  await expect(page.getByTestId("reveal-status")).toHaveText("Provisional: not checked yet");
});

test("the Blind Spot canvas game with tap-only controls reaches results", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
  test.setTimeout(120_000);
  await page.clock.install();
  await page.goto("/en/learn/practise/blind-spot/play?mode=practice");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  const variant = await page.getByTestId("bs-game").getAttribute("data-variant");
  test.skip(
    variant !== "canvas",
    "no WebGL in this browser: the decision version is covered above",
  );
  for (let i = 0; i < 20; i++) {
    const results = page.getByTestId("results-reveal");
    const place = page.getByTestId("bs-place");
    const go = page.getByTestId("bs-ride-go");
    await expect(place.or(go).or(results)).toBeVisible({ timeout: 20_000 });
    if (await results.isVisible()) break;
    if (await place.isVisible()) {
      await expect(page.getByTestId("bs-canvas-a").locator("canvas")).toBeVisible();
      await page.locator("label", { has: page.getByTestId("bs-spot-1") }).click();
      await place.click();
      await expect(page.getByTestId("bs-feedback")).toHaveAttribute("data-correct", "true");
      await page.getByTestId("bs-next").click();
    } else {
      await go.click();
      await expect(page.getByTestId("bs-canvas-b").locator("canvas")).toBeVisible();
      await page.getByTestId("bs-hold").click();
      await page.getByTestId("bs-mirror").click();
      await expect(page.getByTestId("bs-mirror-view")).toBeVisible();
      for (let s = 0; s < 30 && !(await page.getByTestId("bs-next").isVisible()); s++) {
        await page.clock.runFor(1_000);
      }
      await page.getByTestId("bs-next").click();
    }
  }
  await expect(page.getByTestId("results-reveal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("bs-results")).toContainText("Holding back at the turn");
  expect(await page.evaluate(() => typeof window.__mdPhaser?.loadedAt)).toBe("number");
});

for (const locale of ["en", "hi"] as const) {
  test(`briefs in ${locale} at 360 px: loading, empty, offline, success states and the footer`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(mobileOnly(info), "brief states are checked on the 360 px profile");
    await onboard(context, baseURL ?? "", locale);
    for (const game of ["stopping-distance", "blind-spot"]) {
      // Loading: the server HTML carries a skeleton (the brief and its runs render on the device).
      const html = await (await page.request.get(`/${locale}/learn/practise/${game}`)).text();
      expect(html).toMatch(/data-testid="(state-loading|runs-loading)"/);
      await page.goto(`/${locale}/learn/practise/${game}`);
      await expect(page.getByTestId("game-brief")).toBeVisible();
      await expect(page.getByTestId("last-runs")).toHaveAttribute("data-state", "empty");
      await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT[locale]);
      await noSideScroll(page);
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByTestId("state-offline")).toBeVisible();
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    }
    // Success: a run saved on this phone (the host's results store) is listed under the brief.
    await page.evaluate(() => {
      const rec = {
        v: 1,
        sid: "00000000-0000-4000-8000-000000000229",
        gameId: "stopping_distance",
        mode: "practice",
        status: "provisional",
        savedAt: Date.now(),
        checked: { server_checked: false, server_score_pct: null, score: { pct: 81.5 } },
      };
      localStorage.setItem("md.games.sessions.v1", JSON.stringify([rec]));
    });
    await page.goto(`/${locale}/learn/practise/stopping-distance`);
    await expect(page.getByTestId("last-runs")).toHaveAttribute("data-state", "ok");
    await expect(page.getByTestId("runs-list")).toContainText("81.5");
    await noSideScroll(page);
  });
}

test("axe: both briefs and the Stopping Distance play screen @a11y", async ({ page }) => {
  for (const path of ["/en/learn/practise/stopping-distance", "/en/learn/practise/blind-spot"]) {
    await page.goto(path);
    await expect(page.getByTestId("game-brief")).toBeVisible();
    expect(await axeSerious(page), path).toEqual([]);
  }
  await page.goto("/en/learn/practise/stopping-distance/play?mode=practice");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("sd-predict")).toBeVisible();
  expect(await axeSerious(page), "SD play").toEqual([]);
});
