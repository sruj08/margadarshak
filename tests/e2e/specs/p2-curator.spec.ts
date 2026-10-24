import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { FOOTER_TEXT, onboard } from "./helpers";

/**
 * P2 · clip admin: curator, raters and the blur audit (MD-219, NAZAR §5–§6, UI_SPEC_LEARN_GAMES
 * §12), on the mock build: synthetic seed clips with placeholder media in this browser's storage,
 * and demo pseudonyms (curator-01, rater-01, rater-02) chosen on the labelled mock picker.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const mobileOnly = (t: TestInfo) => t.project.name !== "mobile-360";

async function actAs(page: Page, pseudonym: string) {
  await page.goto("/en/admin/clips");
  const bar = page.getByTestId("admin-mock-bar");
  await expect(page.getByTestId("admin-mock-picker").or(bar)).toBeVisible({ timeout: 20_000 });
  if (await bar.isVisible()) await page.getByTestId("persona-switch").click();
  await page.getByTestId(`persona-${pseudonym}`).click();
  await expect(page.getByTestId("admin-persona")).toHaveText(`Acting as ${pseudonym}`);
}

async function rate(page: Page, clipId: string, a: string, b: string, cue: string) {
  await page.goto(`/en/admin/clips/${clipId}/rate`);
  await expect(page.getByTestId("rater-form")).toBeVisible();
  await expect(page.getByTestId("placeholder-media")).toContainText("Placeholder clip (mock mode)");
  await page.getByTestId("mark-0-type").selectOption("auto_cut_in");
  await page.getByTestId("mark-0-a").fill(a);
  await page.getByTestId("mark-0-b").fill(b);
  if (cue) await page.getByTestId("mark-0-cue").fill(cue);
  await page.getByTestId("rate-save").click();
  await expect(page.getByTestId("ratings-view")).toBeVisible();
}

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test("admin screens need an admin session: the mock build shows a labelled pseudonym picker", async ({
  page,
}) => {
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId("admin-mock-picker")).toContainText("Mock mode");
  await expect(page.getByTestId("curator-board")).toHaveCount(0);
  await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT.en);
});

test("two blind raters rate the same clip, they agree, then cue texts and publish", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "admin flows run on the 360 px profile");
  test.setTimeout(120_000);

  await actAs(page, "rater-01");
  await expect(page.getByTestId("clip-card-KL-0011")).toHaveAttribute("data-status", "proposed");
  await rate(page, "KL-0011", "9.00", "13.00", "auto drifts into the lane");
  await expect(page.getByTestId("rate-blind-note")).toContainText("once both of you have saved");
  await expect(page.getByTestId("rating-rater-01")).toBeVisible();
  await expect(page.getByTestId("agreement")).toHaveCount(0);

  await actAs(page, "rater-02");
  await page.goto("/en/admin/clips/KL-0011/rate");
  await expect(page.getByTestId("rater-form")).toBeVisible();
  // Blind: nothing of rater-01 is on the page before rater-02 saves.
  await expect(page.getByTestId("rating-rater-01")).toHaveCount(0);
  await expect(page.getByText("auto drifts into the lane")).toHaveCount(0);
  await expect(page.getByTestId("rate-blind-note")).toContainText(
    "You can't see the other rater's window until you save",
  );
  await rate(page, "KL-0011", "9.20", "13.30", "");
  await expect(page.getByTestId("rating-rater-01")).toContainText("auto drifts into the lane");
  await expect(page.getByTestId("rating-rater-02")).toBeVisible();
  await expect(page.getByTestId("agreement-result")).toHaveAttribute("data-accepted", "true");

  await actAs(page, "curator-01");
  await page.goto("/en/admin/clips/KL-0011/publish");
  await expect(page.getByTestId("check-cue_texts")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("publish-go")).toBeDisabled();

  await page.goto("/en/admin/clips/KL-0011/cues");
  await page.getByTestId("cue-h1-en").fill("The auto drifts left without a signal");
  await page.getByTestId("cue-h1-hi").fill("ऑटो बिना इशारे के बाईं ओर आता है");
  await page.getByTestId("cue-difficulty").selectOption("2");
  await page.getByTestId("cues-save").click();
  await expect(page.getByTestId("cues-saved")).toBeVisible();

  await page.goto("/en/admin/clips/KL-0011/publish");
  for (const id of ["two_ratings", "agreement", "blur_audit", "cue_texts", "difficulty"]) {
    await expect(page.getByTestId(`check-${id}`)).toHaveAttribute("data-ok", "true");
  }
  await page.getByTestId("publish-go").click();
  await expect(page.getByTestId("publish-done")).toContainText("Published");
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId("clip-card-KL-0011")).toHaveAttribute("data-status", "published");
});

test("raters who disagree: the clip goes to adjudication; a rater may not adjudicate", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "admin flows run on the 360 px profile");
  test.setTimeout(90_000);
  await actAs(page, "rater-01");
  await page.goto("/en/admin/clips/KL-0008/adjudicate");
  await expect(page.getByTestId("adjudicate-is-rater")).toBeVisible();
  await expect(page.getByTestId("adjudicate-save")).toBeDisabled();

  await actAs(page, "curator-01");
  await page.goto("/en/admin/clips/KL-0008/adjudicate");
  // Both raters are visible only now (status adjudication, both ratings saved).
  await expect(page.getByTestId("rating-rater-01")).toBeVisible();
  await expect(page.getByTestId("rating-rater-02")).toBeVisible();
  await page.getByTestId("adjudicate-save").click();
  await expect(page.getByText("Rule on every cluster.", { exact: true })).toBeVisible();
  const clusters = page.locator('[data-testid^="cluster-c"][data-testid$="-hazard"]');
  const n = await clusters.count();
  for (let i = 0; i < n; i++) await clusters.nth(i).check();
  await page.getByTestId("adjudicate-save").click();
  await expect(page.getByTestId("adjudicate-done")).toBeVisible();
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId("clip-card-KL-0008")).toHaveAttribute("data-status", "rated");
});

test("blur audit on the placeholder clip: 4× playback checks every frame, a miss fails it", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "admin flows run on the 360 px profile");
  test.setTimeout(90_000);
  await page.clock.install();
  await actAs(page, "curator-01");
  await page.goto("/en/admin/clips/KL-0004/blur");
  await expect(page.getByTestId("blur-audit")).toBeVisible();
  await expect(page.getByTestId("placeholder-media")).toContainText("Placeholder clip (mock mode)");
  await expect(page.getByTestId("audit-progress")).toContainText("of 1650");
  await page.getByTestId("scrub-play").click();
  await page.clock.runFor(16_000);
  await expect(page.getByTestId("audit-progress")).toContainText("1650 of 1650 (100%)");
  await page.getByTestId("miss-plate").click();
  await page.getByTestId("audit-save").click();
  await expect(page.getByTestId("audit-result")).toContainText("not passed");
  // The re-blurred rendition needs a fresh 100% audit with no misses.
  await page.reload();
  await page.getByTestId("scrub-play").click();
  await page.clock.runFor(16_000);
  await page.getByTestId("audit-save").click();
  await expect(page.getByTestId("audit-result")).toContainText("Audit passed");
});

test("AI-generated clip: generate from a scene, synthetic review instead of the blur audit, raters still required", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "admin flows run on the 360 px profile");
  test.setTimeout(90_000);
  await actAs(page, "curator-01");
  await page.goto("/en/admin/clips/generate");
  await expect(page.getByTestId("generate-clip")).toContainText("Sample scenes (mock)");
  await page.getByTestId("generate-start").click();
  await expect(page.getByText("Choose a scene.")).toBeVisible();
  await page.getByTestId("scene-SC-SCHOOL-01").check();
  await page.getByTestId("generate-start").click();
  await expect(page.getByTestId("generate-done")).toContainText(/Generation started as AI-\d{4}/);
  await page.getByTestId("generate-done").getByRole("link").click();
  await expect(page.getByTestId("clip-overview")).toBeVisible();
  await expect(page.getByTestId("origin-ai")).toHaveText("AI-generated");
  await page.getByTestId("mock-ingest").click();
  await expect(page.getByTestId("clip-overview")).toBeVisible();
  const clipId =
    (await page.getByTestId("clip-overview").locator("h1").textContent())?.trim() ?? "";

  // The blur audit is skipped for AI clips.
  await page.goto(`/en/admin/clips/${clipId}/blur`);
  await expect(page.getByTestId("audit-ai-skip")).toBeVisible();

  // Synthetic review: nothing pre-ticked; all five checks needed.
  await page.goto(`/en/admin/clips/${clipId}/review`);
  await expect(page.getByTestId("synthetic-review")).toBeVisible();
  for (const id of [
    "no_real_likeness",
    "no_readable_plates",
    "no_real_brands",
    "no_collision_or_injury",
    "hazard_visible",
  ]) {
    await expect(page.getByTestId(`review-${id}`)).not.toBeChecked();
    await page.getByTestId(`review-${id}`).check();
  }
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-current")).toHaveAttribute("data-passed", "true");
  await expect(page.getByTestId("review-current")).toContainText("curator-01");

  await page.goto(`/en/admin/clips/${clipId}/publish`);
  await expect(page.getByTestId("check-synthetic_review")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("check-blur_audit")).toHaveCount(0);
  await expect(page.getByTestId("check-two_ratings")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("publish-go")).toBeDisabled();
  await page.goto("/en/admin/clips");
  await expect(page.getByTestId(`clip-card-${clipId}`).getByTestId("origin-ai")).toBeVisible();
});

test("board and rater form have no serious axe violations @a11y", async ({ page }) => {
  await actAs(page, "rater-02");
  await expect(page.getByTestId("curator-board")).toBeVisible();
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((x) => x.target.join(" ")) }));
  expect(await scan()).toEqual([]);
  await page.goto("/en/admin/clips/KL-0012/rate");
  await expect(page.getByTestId("rater-form")).toBeVisible();
  expect(await scan()).toEqual([]);
});
