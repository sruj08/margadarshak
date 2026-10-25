import { expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";
import { answer, makePlan } from "./journey-helpers";
import { activeCase, apiCall, expectApi, useServerClock } from "./real-helpers";

/**
 * The demo story on the full stack (E2E_MODE=real): every journey step is an API-15 event the Go
 * journey machine accepts or rejects (no device clock tricks). The slot is booked during the
 * bridge for a date on or after the day-30 unlock (EC-07); the retest respects the pack's gap.
 */
test.beforeEach(async ({ context, baseURL, page }) => {
  await onboard(context, baseURL ?? "", "en");
  await useServerClock(page);
});

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

async function serverState(page: Page, caseId: string) {
  return (await apiCall(page, "GET", `/v1/cases/${caseId}`)).json.state as string;
}

async function bookFirstSlot(page: Page) {
  await page.locator(".fl-day").first().click();
  await page.locator(".fl-time label:not([aria-disabled='true'])").first().click();
  const res = await expectApi(page, "POST", /\/v1\/cases\/[^/]+\/events$/, () =>
    page.getByTestId("slot-confirm").click(),
  );
  expect(res.status, "slot_booked").toBe(201);
  await expect(page).toHaveURL(/\/dl\/test-day/);
}

test("Story on the Go API: plan -> DigiLocker -> pay -> LL -> slot -> retest -> DL holder", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const plan = await expectApi(page, "POST", "/v1/plans", () =>
    makePlan(page, {
      age: { dob: ["14", "03", "2007"] },
      vehicles: [/Bike with gears/],
      aadhaar: "Yes",
    }),
  );
  expect(plan.status, "API-01").toBe(201);
  await page.getByTestId("start-application").click();
  const created = await expectApi(page, "POST", "/v1/cases", () =>
    page.getByTestId("start-case").click(),
  );
  expect(created.status, "API-10").toBe(201);
  const caseId = created.json.case_id as string;
  await expect(page).toHaveURL(/\/apply\/q\/for_whom/);
  expect((await activeCase(page))?.local).toBe(false);

  await page.goto("/en/apply/digilocker");
  await page.getByRole("button", { name: "Continue with the demo account" }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  await page.getByTestId("digilocker-next").click();

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
  await page.getByTestId("fee-pay").click();
  await payUpi(page);
  await expect.poll(() => serverState(page, caseId)).toBe("LL_TEST");

  await page.goto("/en/test/ll/issued");
  await expect(page.getByTestId("ll-cert")).toBeVisible();
  await expect.poll(() => serverState(page, caseId)).toBe("BRIDGE");

  // During the bridge: pay the DL fee and book a slot dated on or after the unlock (EC-07).
  await page.goto("/en/dl/apply");
  await expect(page.getByText(/You can apply from/)).toBeVisible();
  await page.getByTestId("dl-continue").click();
  await payUpi(page);
  await bookFirstSlot(page);
  await expect.poll(() => serverState(page, caseId)).toBe("TEST_BOOKED");

  await page.getByTestId("result-fail").click();
  await page.getByRole("checkbox", { name: "Forgot to indicate" }).check();
  await page.getByTestId("result-record").click();
  await expect(page).toHaveURL(/\/dl\/retest/);
  await expect.poll(() => serverState(page, caseId)).toBe("TEST_FAILED");
  await page.getByTestId("retest-continue").click();
  await payUpi(page);
  await bookFirstSlot(page);

  await page.getByTestId("result-pass").click();
  await page.getByTestId("result-record").click();
  await expect(page).toHaveURL(/\/dl\/issued/);
  await page
    .getByRole("button", { name: "Approval SMS received" })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect(page.getByText("Your driving licence is approved")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => serverState(page, caseId)).toBe("DL_ISSUED");
  await page.getByTestId("card-received").click();
  await expect.poll(() => serverState(page, caseId)).toBe("DL_HOLDER");
});
