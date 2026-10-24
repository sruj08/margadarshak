import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { FOOTER_TEXT, onboard } from "./helpers";

/**
 * P2 · Nazar, the game host, the template debrief and the replay (MD-205, MD-222, MD-224, MD-225,
 * EC-18), on the mock build (no API URL: device sessions over the game-core fixture clips, a
 * labelled placeholder timeline, provisional scores). Clip time runs on Playwright's fake clock so
 * a 45-second clip takes a moment; the page clock drives both the media time and the event time,
 * exactly as in real play.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const mobileOnly = (t: TestInfo) => t.project.name !== "mobile-360";

declare global {
  interface Window {
    __mdGames?: Record<string, boolean>;
  }
}

async function axeSerious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations
    .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}

/** Plays every clip of the session to its end; returns once the results screen shows. */
async function playAllClips(page: Page, opts: { tapAtMs?: number; reveal: boolean }) {
  for (let i = 0; i < 12; i++) {
    const start = page.getByTestId("clip-start");
    const results = page.getByTestId("results-reveal");
    await expect(start.or(results)).toBeVisible({ timeout: 20_000 });
    if (await results.isVisible()) return;
    await start.click();
    await expect(page.getByTestId("tap-zone")).toBeVisible();
    if (opts.tapAtMs !== undefined) {
      await page.clock.runFor(opts.tapAtMs);
      await page.getByTestId("tap-zone").click();
    }
    await page.clock.runFor(60_000);
    if (opts.reveal) {
      await expect(page.getByTestId("clip-reveal")).toBeVisible();
      await page.getByTestId("reveal-next").click();
    }
  }
  await expect(page.getByTestId("results-reveal")).toBeVisible({ timeout: 20_000 });
}

// Long clip flows fire thousands of animation frames: a trace of them is huge and adds nothing.
test.use({ trace: "off" });

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test("the Nazar chunk is not requested until the game opens @smoke", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });
  await page.goto("/en/learn/practise/nazar");
  await expect(page.getByTestId("game-brief")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => window.__mdGames)).toBeUndefined();
  const onBrief = new Set(scripts);
  await page.getByTestId("brief-start").click();
  await expect(page).toHaveURL(/\/en\/learn\/practise\/nazar\/play\?mode=mock/);
  await expect(page.getByTestId("stage-start")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => window.__mdGames?.["nazar"])).toBe(true);
  const added = scripts.filter((s) => !onBrief.has(s));
  expect(added.length).toBeGreaterThan(0);
});

test("brief: modes, Kerala format from the rule pack, photosensitivity, SR link, footer", async ({
  page,
}) => {
  await page.goto("/en/learn/practise/nazar");
  await expect(page.getByTestId("nazar-format")).toContainText("10 clips, 10 marks each, pass 60");
  await expect(page.getByTestId("nazar-photo")).toBeVisible();
  await expect(page.getByText("not Kerala's test").first()).toBeVisible();
  await expect(page.getByTestId("brief-sr-link")).toHaveAttribute("href", /\/nazar\/sr$/);
  await expect(page.getByTestId("pack-empty")).toBeVisible();
  await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT.en);
});

test("a full practice clip, then the debrief and the replay (MD-222)", async ({ page }, info) => {
  test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
  test.setTimeout(120_000);
  await page.clock.install();
  await page.goto("/en/learn/practise/nazar/play?mode=practice");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("game-hud")).toBeVisible();
  // First clip: tap at 13 s (inside most fixture windows), then reveal; the others untouched.
  await page.getByTestId("clip-start").click();
  await expect(page.getByTestId("placeholder-clip")).toContainText("Placeholder clip");
  await page.clock.runFor(13_000);
  await page.getByTestId("tap-zone").click();
  await expect(page.locator(".mg-ring")).toHaveCount(1);
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("clip-reveal")).toBeVisible();
  await expect(page.getByTestId("window-band")).toBeVisible();
  await page.getByTestId("reveal-watch").click();
  await expect(page.getByTestId("replay-scrubber")).toBeVisible();
  await page.getByTestId("reveal-next").click();
  await playAllClips(page, { reveal: true });
  await expect(page.getByTestId("reveal-status")).toHaveText("Provisional: not checked yet");
  await page.getByTestId("reveal-debrief").click();
  await expect(page).toHaveURL(/\/learn\/practise\/sessions\/[0-9a-f-]+\/debrief/);
  await expect(page.getByTestId("debrief-card")).toBeVisible();
  await expect(page.getByTestId("debrief-notes-label")).toHaveText("Auto notes");
  await expect(page.getByTestId("debrief-footer")).toHaveText(
    "Practice and familiarisation, not certification",
  );
  await expect(page.getByTestId("debrief-provisional")).toBeVisible();
  await expect(page.getByTestId("debrief-drill")).toHaveAttribute("href", /\/learn\/practise\//);
  await expect(page.getByTestId("non-affiliation-footer")).toBeVisible();
  const watch = page.getByTestId("debrief-watch").first();
  if (await watch.isVisible()) {
    await watch.click();
    await expect(page.getByTestId("replay-moment")).toBeVisible();
    await expect(page.getByTestId("window-band")).toBeVisible();
    await expect(page.getByTestId("replay-try")).toHaveAttribute(
      "href",
      /mode=learn&drill=DR-NAZ-OCCL-/,
    );
  }
});

test("a Kerala-format mock: calibration, 10 clips, no feedback between clips, results", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
  test.setTimeout(180_000);
  await page.clock.install();
  await page.goto("/en/learn/practise/nazar/play?mode=mock");
  await page.getByTestId("stage-start").click({ timeout: 20_000 });
  await expect(page.getByTestId("calibration")).toBeVisible();
  await page.getByTestId("calib-go").click();
  await expect(page.getByTestId("clip-between")).toContainText("Clip 1 of 10");
  await playAllClips(page, { tapAtMs: 12_500, reveal: false });
  await expect(page.getByTestId("reveal-score")).toBeVisible();
  await expect(page.getByTestId("nazar-results")).toContainText("Hazard spotting · Kerala format");
  await expect(page.getByTestId("nazar-spotted")).toContainText(/You spotted \d+ of 12 hazards/);
  await expect(page.getByTestId("nazar-counts")).toHaveText(
    "Practice run: not counted for your Nazar Score.",
  );
  await expect(page.getByTestId("reveal-status")).toHaveText("Provisional: not checked yet");
});

test("screen-reader version: untimed frames, honest label, never a block (MD-225)", async ({
  page,
}) => {
  await page.goto("/en/learn/practise/nazar/sr");
  await expect(page.getByTestId("sr-label")).toContainText(
    "A different exercise from the timed clips",
  );
  for (let i = 0; i < 4; i++) {
    await page.getByTestId("sr-frame-1").check();
    await page.getByTestId("sr-check").click();
    await expect(page.getByTestId("sr-feedback")).not.toBeEmpty();
    await page.getByTestId("sr-next").click();
  }
  await expect(page.getByTestId("sr-done")).toBeVisible();
});

test("throttled network: no clip can start before every clip is fully buffered (EC-18)", async ({
  page,
}) => {
  let served = 0;
  await page.route("**/learn/practise/nazar/clip/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    served += 1;
    await route.continue();
  });
  await page.goto("/en/learn/practise/nazar/play?mode=practice");
  await expect(page.getByTestId("stage-loading")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByTestId("stage-start")).toHaveCount(0);
  await expect(page.getByTestId("clip-start")).toHaveCount(0);
  await expect(page.getByTestId("stage-start")).toBeVisible({ timeout: 30_000 });
  expect(served).toBe(3);
});

test.describe("axe @a11y", () => {
  test("brief and SR version have no serious violations @a11y", async ({ page }) => {
    await page.goto("/en/learn/practise/nazar");
    await expect(page.getByTestId("game-brief")).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
    await page.goto("/hi/learn/practise/nazar/sr");
    await expect(page.getByTestId("nazar-sr")).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
  });

  test("play shell, results and debrief have no serious violations @a11y", async ({
    page,
  }, info) => {
    test.skip(mobileOnly(info), "P2 game flows run on the 360 px profile");
    test.setTimeout(240_000);
    await page.clock.install();
    await page.goto("/en/learn/practise/nazar/play?mode=learn");
    await expect(page.getByTestId("stage-start")).toBeVisible({ timeout: 20_000 });
    expect(await axeSerious(page)).toEqual([]);
    await page.getByTestId("stage-start").click();
    await page.getByTestId("clip-start").click();
    await expect(page.getByTestId("tap-zone")).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
    // Learn mode: answer each freeze, then play on.
    for (let i = 0; i < 80; i++) {
      const results = page.getByTestId("results-reveal");
      if (await results.isVisible()) break;
      const panel = page.getByTestId("predict-panel");
      if (await panel.isVisible()) {
        await panel.locator("button").first().click();
        await page.getByTestId("predict-continue").click();
        continue;
      }
      if (await page.getByTestId("clip-reveal").isVisible()) {
        await page.getByTestId("reveal-next").click();
        continue;
      }
      if (await page.getByTestId("clip-start").isVisible()) {
        await page.getByTestId("clip-start").click();
        continue;
      }
      await page.clock.runFor(10_000);
    }
    await expect(page.getByTestId("results-reveal")).toBeVisible({ timeout: 20_000 });
    expect(await axeSerious(page)).toEqual([]);
    await page.getByTestId("reveal-debrief").click();
    await expect(page.getByTestId("debrief-card")).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
  });
});

test("share: a minor's profile without the parent's share_cards consent sees the gate", async ({
  page,
}) => {
  await page.goto("/en/learn/me/share?member=fam_DEMO01");
  await expect(page.getByTestId("parent-consent-gate")).toBeVisible();
  await page.goto("/en/learn/me/share");
  await expect(page.getByText("No counted mock yet.")).toBeVisible();
  await page.goto("/en/c/shc_DEMO01");
  await expect(page.getByTestId("share-sample")).toBeVisible();
  await expect(page.getByTestId("share-score")).toHaveText("64");
  await expect(page.getByTestId("non-affiliation-footer")).toBeVisible();
});
