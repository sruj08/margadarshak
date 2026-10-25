import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";
import { answer, bookSlot, makePlan, mobileOnly } from "./journey-helpers";

/**
 * The demo story end to end on the device API at 360 px: plan -> DigiLocker autofill -> application
 * -> check answers -> simulated payment -> LL test (tutorial, face check, exam) -> LL issued ->
 * 30-day bridge (demo clock) -> DL application and fee -> slot -> test day -> fail -> retest ->
 * pass -> DL approved, in DigiLocker, card received.
 */
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** axe (serious and critical) plus no horizontal scroll at 360 px, on the current screen. */
async function a11y(page: Page, label: string) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  // Scoped to <main>: after client-side navigation through the application, empty portal nodes
  // (outside main, no content) build up at body level; direct loads are checked in journey-a11y.
  const results = await new AxeBuilder({ page }).include("main").withTags(TAGS).analyze();
  const v = results.violations
    .filter((x) => ["serious", "critical"].includes(x.impact ?? ""))
    .map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target.join(" ")) }));
  if (overflow > 0) v.push({ id: "horizontal-scroll-360", nodes: [String(overflow)] });
  expect(v, label).toEqual([]);
}

async function nextTask(page: Page) {
  await expect(page.locator("[data-screen='SCR-030']")).toBeVisible();
  await page.getByTestId("continue-task").click();
}

async function payUpi(page: Page) {
  await expect(page.getByTestId("pay-total")).toBeVisible();
  await page.getByTestId("pay-upi").click();
  await expect(page.getByTestId("pay-receipt")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("pay-next").click();
}

/** Answers every exam question wrongly (from the practice key) so the attempt cannot pass. */
async function failExam(page: Page, n: number) {
  const key = (await (await page.request.get("/en/learn/review/practice-key")).json()) as Record<
    string,
    { correct: string }
  >;
  await page.getByTestId("stage-start").click();
  for (let i = 1; i <= n; i++) {
    await expect(page.getByTestId("exam-counter")).toHaveText(`Question ${i} of ${n}`);
    const radios = page.getByTestId("ll-exam").getByRole("radio");
    const name = (await radios.first().getAttribute("name")) ?? "";
    const correct = key[name.slice(name.indexOf("-") + 1)]?.correct;
    const count = await radios.count();
    for (let j = 0; j < count; j++) {
      if ((await radios.nth(j).getAttribute("value")) !== correct) {
        await radios.nth(j).check();
        break;
      }
    }
    await page.getByTestId("exam-next").click();
  }
  await page.getByTestId("reveal-debrief").click();
}

test("LL test not passed: recorded, retake after the gap, LL retest fee, new attempt", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await page.getByTestId("start-application").click();
  await page.getByTestId("start-case").click();
  await expect(page).toHaveURL(/\/apply\/q\/for_whom/);
  await page.goto("/en/pay?for=ll");
  await payUpi(page);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByTestId("tutorial-done").click();
  await page.getByRole("button", { name: "Face check" }).click();
  await expect(page.getByText(/Face matched/)).toBeVisible();
  await page.getByTestId("ll-start").click();
  await failExam(page, 10);

  const panel = page.getByTestId("ll-real-test");
  await expect(panel).toContainText(/You can retake the test from/);
  await panel.getByTestId("ll-real-test-next").click();

  // Retake: the gap (PRM-LL-RETEST-GAP-DAYS, 1 day) first, then the LL retest fee.
  await expect(page.locator("[data-screen='SCR-LL-RETAKE']")).toBeVisible();
  await expect(page.getByTestId("ll-retest-pay")).toHaveCount(0);
  await page.getByRole("button", { name: /Skip 1 day/ }).click();
  await page.getByTestId("ll-retest-pay").click();
  await expect(page.getByTestId("pay-lines")).toContainText("50");
  await payUpi(page);
  await expect(page).toHaveURL(/\/test\/ll/);
  await page.getByRole("button", { name: "Face check" }).click();
  await page.getByTestId("ll-start").click();
  await expect(page.getByTestId("stage-start")).toBeVisible();
});

test("Driving schools: not compulsory; the accredited-centre route adds its certificate", async ({
  page,
}) => {
  await makePlan(page, { age: { band: "20 to 39" }, vehicles: [/^Car/], aadhaar: "Yes" });
  await page.getByTestId("start-application").click();
  await page.getByTestId("start-case").click();
  await page.goto("/en/dl/school");
  await expect(page.getByText(/Not compulsory for a private/)).toBeVisible();
  await a11y(page, "school");
  await page.getByTestId("school-adtc").click();
  await expect(page.getByText(/your DL checklist now includes/)).toBeVisible();
});

test("Kabir's whole road: first question to driving licence", async ({ page }) => {
  test.setTimeout(240_000);
  await makePlan(page, {
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await page.getByTestId("start-application").click();
  await page.getByTestId("start-case").click();
  await expect(page).toHaveURL(/\/apply\/q\/for_whom/);

  // DigiLocker autofill (simulated, synthetic account, no Aadhaar/OTP inputs).
  await page.goto("/en/apply/digilocker");
  await expect(page.locator("main input, main textarea")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with the demo account" }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("Your details are filled in")).toBeVisible({ timeout: 10_000 });
  await a11y(page, "digilocker");
  await page.getByTestId("digilocker-next").click();
  await expect(page.getByTestId("digilocker-card")).toContainText("Filled from DigiLocker");

  await nextTask(page);
  await answer(page, "Me");
  await answer(page, "General");
  await nextTask(page);
  await answer(page, "No licence yet");
  await nextTask(page);
  await answer(page, "Yes");
  await answer(page, "Yes");
  await nextTask(page);
  await page.getByRole("checkbox", { name: "I've read what Form 1 covers" }).check({ force: true });
  await page.getByTestId("q-continue").click();
  await nextTask(page);
  await page.getByTestId("fix-signature").click();
  await page.getByTestId("sign-later").click();
  await page.getByRole("link", { name: "Back to the task list" }).last().click();
  await nextTask(page);
  await page.getByRole("checkbox", { name: /checked these answers/ }).check({ force: true });
  await page.getByTestId("check-continue").click();

  // Fee -> simulated gateway -> receipt -> LL test.
  await expect(page.locator("[data-screen='SCR-039']")).toBeVisible();
  await page.getByTestId("fee-pay").click();
  await expect(page.getByTestId("pay-total")).toBeVisible();
  await a11y(page, "gateway");
  await payUpi(page);
  await a11y(page, "ll test gate");
  await expect(page).toHaveURL(/\/test\/ll/);

  // Tutorial, face check, exam in J&K's format.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByTestId("tutorial-done").click();
  await page.getByRole("button", { name: "Face check" }).click();
  await expect(page.getByText(/Face matched/)).toBeVisible();
  await page.getByTestId("ll-start").click();
  await page.getByTestId("stage-start").click();
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByTestId("exam-counter")).toHaveText(`Question ${i} of 10`);
    await page.getByTestId("ll-exam").getByRole("radio").first().check();
    await page.getByTestId("exam-next").click();
  }
  await page.getByTestId("reveal-debrief").click();
  await expect(page.getByTestId("ll-real-test")).toBeVisible();

  // LL issued (as on a pass) -> the bridge.
  await page.goto("/en/test/ll/issued");
  await expect(page.getByTestId("ll-cert")).toContainText("JK01");
  await expect(page.getByText(/Your driving test unlocks on/)).toBeVisible();
  await a11y(page, "ll issued");
  await page.getByRole("button", { name: /Skip 30 days/ }).click();
  await expect(page.getByTestId("stage-h1")).toBeVisible();

  // DL application, fee, slot.
  await page.goto("/en/dl/apply");
  await expect(page.getByTestId("dl-fee")).toBeVisible();
  await a11y(page, "dl apply");
  await page.getByTestId("dl-continue").click();
  await payUpi(page);
  await expect(page).toHaveURL(/\/dl\/slot/);
  await bookSlot(page, async () => {
    await a11y(page, "slot");
  });
  await expect(page).toHaveURL(/\/dl\/test-day/);
  await expect(page.getByTestId("slot-slip")).toBeVisible();
  await a11y(page, "test day");

  // Test day: first try not passed -> retest plan -> retest fee -> new slot.
  const skip = page.getByRole("button", { name: "Skip to test day" });
  if (await skip.isVisible()) await skip.click();
  await page.getByTestId("result-fail").click();
  await page.getByRole("checkbox", { name: "Forgot to indicate" }).check();
  await page.getByTestId("result-record").click();
  await expect(page).toHaveURL(/\/dl\/retest/);
  await expect(page.getByText("Forgot to indicate")).toBeVisible();
  await a11y(page, "retest");
  await page.getByTestId("retest-continue").click();
  await payUpi(page);
  await expect(page).toHaveURL(/\/dl\/slot\?retest=1/);
  await bookSlot(page);
  await expect(page).toHaveURL(/\/dl\/test-day/);
  const skip2 = page.getByRole("button", { name: "Skip to test day" });
  if (await skip2.isVisible()) await skip2.click();
  await page.getByTestId("result-pass").click();
  await page.getByTestId("result-record").click();

  // Approval -> DL in DigiLocker -> card by post -> home shows the holder.
  await expect(page).toHaveURL(/\/dl\/issued/);
  await expect(page.getByText("Your driving licence is approved")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/In your DigiLocker/)).toBeVisible();
  await a11y(page, "dl issued");
  await page.getByTestId("card-received").click();
  await expect(page.getByTestId("card-received")).toHaveCount(0);
  await page.goto("/en");
  await expect(page.getByTestId("stage-home")).toBeVisible();
  for (const route of ["/en/dl/track", "/en/demo", "/en/compare", "/hi/dl/track", "/hi/compare"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await a11y(page, route);
  }
});
