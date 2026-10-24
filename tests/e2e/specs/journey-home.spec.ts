import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";
import { loadPersona, mobileOnly } from "./journey-helpers";

/**
 * P1 · Home (MD-119/120), stage-aware home with the demo persona switcher (MD-122), tracker
 * (MD-123), My Licence (MD-124), case clock (MD-132), "tell us" box with redaction (MD-138, EC-20).
 */
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

test("Home: four verbs, mic opens an honest 'coming' sheet, trust line, all services", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(page.getByTestId("verb-tiles").getByRole("link")).toHaveCount(4);
  await expect(page.getByTestId("trust-line")).toBeVisible();
  await page.getByTestId("voice-open").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Coming in the next build");
  await expect(sheet).toContainText("It can't book, pay or submit on Sarathi.");
  // EC-20: an Aadhaar-like number (Verhoeff-valid) and an OTP are removed before anything is used.
  await sheet
    .getByTestId("tell-us")
    .fill("papa ke liye licence, aadhaar 2234 5678 9127 otp 482913");
  await sheet.getByRole("button", { name: "Find it" }).click();
  await expect(sheet.getByText("We removed a number")).toBeVisible();
  await expect(sheet.getByTestId("tell-us")).not.toHaveValue(/482913/);
  await expect(sheet.getByTestId("intent-result")).toContainText("family member");
});

test("All services: every item opens a live route (MD-120 link check)", async ({
  page,
  request,
}) => {
  await page.goto("/en/services");
  const hrefs = await page
    .locator("[data-testid^='service-']")
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThanOrEqual(15);
  for (const href of hrefs) {
    const res = await request.get(href.split("#")[0] as string);
    expect(res.status(), href).toBe(200);
  }
  await page.getByRole("searchbox").fill("डुप्लीकेट");
  await expect(page.getByTestId("service-duplicate")).toBeVisible();
  await expect(page.getByTestId("service-plan")).toHaveCount(0);
});

test("Personas drive the stage-aware home from the journey state (MD-122)", async ({ page }) => {
  await loadPersona(page, "Kabir, LL day 12");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "BRIDGE");
  await expect(page.getByTestId("stage-h1")).toHaveText("Driving test unlocks in 18 days.");
  await expect(page.getByTestId("case-clock")).toHaveAttribute(
    "data-source-rule",
    "PRM-MIN-WAIT-DAYS",
  );
  await expect(page.getByTestId("stage-primary")).toHaveText("Today's 5-minute practice");
  await expect(page.getByText("Demo persona: Kabir, LL day 12")).toBeVisible();

  await loadPersona(page, "Kabir, LL day 31");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "DL_BOOKABLE");
  await expect(page.getByTestId("stage-h1")).toHaveText("You can book your driving test now.");
  await page.getByTestId("stage-primary").click();
  await expect(page).toHaveURL(/\/services\/book-test/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book your driving test");

  await loadPersona(page, "Mohan-ji, 52");
  await expect(page.getByTestId("stage-home")).toHaveAttribute("data-stage", "RENEWAL_DUE");
  await expect(page.getByTestId("stage-primary")).toHaveText("Plan my renewal");

  await loadPersona(page, "Rahul, 17");
  await expect(page.getByText("Family mode · Rahul")).toBeVisible();
  await expect(page.getByTestId("stage-primary")).toHaveText("Start my application");

  await loadPersona(page, "Tanvi, with blockers");
  await page.goto("/en/apply");
  await expect(page.getByTestId("case-issues").locator("[data-rule='JK-B02']")).toBeVisible();
  await expect(page.getByTestId("case-issues").locator("[data-rule='JK-B03']")).toBeVisible();

  await loadPersona(page, "Kabir, new");
  await expect(page.locator("[data-screen='SCR-003']")).toBeVisible();
  await expect(page.getByTestId("verb-tiles")).toBeVisible();
});

test("My Licence: parcel tracker, case clock with ICS, DL mirror only for DL holders (MD-123/124/132)", async ({
  page,
}) => {
  await loadPersona(page, "Kabir, LL day 12");
  await page.goto("/en/licence");
  await expect(page.getByTestId("clock-days")).toHaveText("18");
  const tracker = page.getByTestId("parcel-tracker");
  await expect(tracker.locator("li[aria-current='step']")).toHaveAttribute(
    "aria-label",
    /Step 4 of 9: 30-day practice, Current/,
  );
  await expect(page.getByTestId("ll-mirror")).toBeVisible();
  await expect(page.getByTestId("dl-mirror")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to calendar" }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ics$/);

  // Recording a step moves the road on (API-15 on the mock).
  await page.getByTestId("update-step").click();
  await page.getByRole("radio", { name: "I booked a driving-test slot" }).check({ force: true });
  await page.getByTestId("record-event").click();
  await expect(page.getByText("Saved. Your road is updated.")).toBeVisible();

  await loadPersona(page, "DL holder");
  await page.goto("/en/licence");
  await expect(page.getByTestId("dl-mirror")).toBeVisible();
  await expect(page.getByTestId("dl-mirror")).toContainText("•••• 5521");
});
