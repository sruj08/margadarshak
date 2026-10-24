import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { FOOTER_TEXT, onboard } from "./helpers";

/**
 * P2 · the Nazar field-study flow at /nazar (MD-237, FIELD_STUDY §4.3, §6.1), on the mock build:
 * consent → bands → anonymous ID and form → 15 LL questions → 10 test clips → replay of 2 clips →
 * fresh clips → score card → near-miss line → thanks. Clip time runs on Playwright's fake clock (as
 * in p2-nazar.spec.ts). Declining consent must make zero writes.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const mobileOnly = (t: TestInfo) => t.project.name !== "mobile-360";
const SIX_MINUTES = 6 * 60_000;

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

const flowStep = (page: Page) => page.getByTestId("study-flow");

/** Plays every clip of a Nazar phase until the flow moves on to `next`. */
async function playNazarPhase(page: Page, next: string) {
  await page.getByTestId("stage-start").click({ timeout: 30_000 });
  const calib = page.getByTestId("calib-go");
  if (await calib.isVisible({ timeout: 5_000 }).catch(() => false)) await calib.click();
  for (let i = 0; i < 14; i++) {
    const start = page.getByTestId("clip-start");
    const moved = page.locator(`[data-testid="study-flow"][data-step="${next}"]`);
    await expect(start.or(moved)).toBeVisible({ timeout: 30_000 });
    if (await moved.isVisible()) return;
    await start.click();
    await expect(page.getByTestId("tap-zone")).toBeVisible();
    await page.clock.runFor(12_500);
    await page.getByTestId("tap-zone").click();
    await page.clock.runFor(60_000);
  }
  await expect(flowStep(page)).toHaveAttribute("data-step", next, { timeout: 30_000 });
}

// Long clip flows fire thousands of animation frames: a trace of them is huge and adds nothing.
test.use({ trace: "off" });

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test("landing: honest copy, 18+, live counters labelled, footer, no game code loaded", async ({
  page,
}) => {
  await page.goto("/en/nazar");
  const landing = page.getByTestId("study-landing");
  await expect(landing).toContainText("not Kerala's test");
  await expect(landing).toContainText("18 or older");
  await expect(landing).toContainText("AI-generated practice scenes");
  await expect(landing).not.toContainText(/real roads?/i);
  await expect(page.getByTestId("live-counters")).toContainText("Convenience sample");
  await expect(page.getByTestId("counters-none")).toBeVisible();
  await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT.en);
  expect(await page.evaluate(() => window.__mdGames)).toBeUndefined();
});

test("declining consent makes zero writes (no request, nothing stored)", async ({ page }) => {
  const writes: string[] = [];
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(`${r.method()} ${r.url()}`);
    if (/\/v1\//.test(r.url())) apiCalls.push(r.url());
  });
  await page.goto("/en/nazar");
  await page.getByTestId("study-start").click();
  await expect(page.getByTestId("study-consent")).toBeVisible();
  await page.getByTestId("consent-decline").click();
  await expect(page.getByTestId("study-declined")).toContainText("Nothing was stored");
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
  expect(apiCalls).toEqual([]);
  const stored = await page.evaluate(() =>
    [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) =>
      k.startsWith("md.study"),
    ),
  );
  expect(stored).toEqual([]);
});

test("the scripted flow completes in at most 6 minutes on a 360 px phone", async ({
  page,
}, info) => {
  test.skip(mobileOnly(info), "the study is taken on a phone");
  test.setTimeout(SIX_MINUTES + 60_000);
  const t0 = Date.now();
  await page.clock.install();
  await page.goto("/en/nazar");
  await page.getByTestId("study-start").click();

  // 1. Consent (nothing pre-ticked), 2. bands.
  await page.getByTestId("consent-agree").click();
  await expect(page.getByTestId("study-bands")).toBeVisible();
  await page.getByTestId("band-age-21_24").check();
  await page.getByTestId("band-licence-2w").check();
  await page.getByTestId("band-years-1_3").check();
  await page.getByTestId("bands-continue").click();

  // Enrolment: P-NNN and a form from the deterministic local rotation.
  await expect(page.getByTestId("participant-code")).toHaveText(/^P-\d{3,4}$/);
  await expect(page.getByTestId("study-enrolled")).toHaveAttribute("data-form", /^[ABC]$/);
  await page.getByTestId("enrolled-start").click();

  // 3. The LL module (D's simulator through the host, phase ll_mock): 15 questions.
  await page.getByTestId("stage-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("exam-counter")).toHaveText("Question 1 of 15");
  for (let i = 0; i < 15; i++) {
    await page.getByTestId("ll-exam").getByRole("radio").first().check();
    await page.getByTestId("exam-next").click();
  }

  // 4. Test clips (C's Nazar module, phase test).
  await expect(flowStep(page)).toHaveAttribute("data-step", "test", { timeout: 30_000 });
  await playNazarPhase(page, "feedback");

  // 5. Replay feedback on 2 clips (C's replay scrubber, windows shown only now).
  const fb = page.getByTestId("feedback").or(page.getByTestId("feedback-none"));
  await expect(fb).toBeVisible({ timeout: 20_000 });
  if (await page.getByTestId("feedback").isVisible()) {
    await expect(page.getByTestId("replay-scrubber")).toBeVisible();
    await expect(page.getByTestId("feedback-fact")).not.toBeEmpty();
    await page.getByTestId("feedback-next").click();
    await expect(page.getByTestId("feedback")).toBeVisible();
  }
  await page.getByTestId("feedback-continue").click();

  // 6. Fresh clips (phase fresh).
  await expect(flowStep(page)).toHaveAttribute("data-step", "fresh");
  await playNazarPhase(page, "score");

  // 7. Score card (C's share-card face), honest labels.
  await expect(page.getByTestId("study-score")).toBeVisible();
  await expect(page.getByTestId("share-score")).toHaveText(/^\d{1,3}$/);
  await expect(page.getByTestId("score-pass-line")).toContainText(
    "Kerala's announced 60/100 pass mark",
  );
  await expect(page.getByTestId("score-provisional")).toBeVisible();
  expect(await axeSerious(page)).toEqual([]);
  await page.getByTestId("score-next").click();

  // 8. Near-miss line: redacted on the phone before it is sent.
  await page.getByTestId("near-miss-text").fill("A bus JK02AB1234 pulled out, call me 9876543210");
  await page.getByTestId("near-miss-send").click();
  await expect(page.getByTestId("near-miss-removed")).toContainText("a vehicle number");
  await page.getByTestId("near-miss-done").click();
  await expect(page.getByTestId("study-done")).toContainText(/P-\d{3,4}/);
  await expect(page.getByTestId("non-affiliation-footer")).toBeVisible();

  const wall = Date.now() - t0;
  info.annotations.push({ type: "study-wall-ms", description: String(wall) });
  expect(wall).toBeLessThanOrEqual(SIX_MINUTES);
});

test.describe("axe @a11y", () => {
  test("landing, consent and score card (en + hi) have no serious violations @a11y", async ({
    page,
  }) => {
    for (const locale of ["en", "hi"] as const) {
      await page.goto(`/${locale}/nazar`);
      await expect(page.getByTestId("study-landing")).toBeVisible();
      expect(await axeSerious(page)).toEqual([]);
      await page.getByTestId("study-start").click();
      await expect(page.getByTestId("study-consent")).toBeVisible();
      expect(await axeSerious(page)).toEqual([]);
    }
    // The score card step (resumed after consent; no scored run on this phone yet).
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "md.study.flow.v1",
        JSON.stringify({
          v: 1,
          step: "score",
          sids: {},
          ll: { raw: 11, max: 15 },
          participant: {
            participant_code: "P-007",
            form: "A",
            cohort: "field_test",
            phases: [],
            ai_debrief: false,
            created_at: "2026-10-24T10:00:00Z",
          },
        }),
      );
    });
    await page.goto("/en/nazar/flow");
    await expect(page.getByTestId("study-score")).toBeVisible();
    await expect(page.getByTestId("score-ll")).toHaveText("Question score: 11 of 15.");
    expect(await axeSerious(page)).toEqual([]);
  });
});
