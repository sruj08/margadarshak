import { expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";
import { answer, makePlan, mobileOnly } from "./journey-helpers";

/**
 * P1 · S2 Guided LL application (MD-110..115, EC-09, EC-11) on the mock API at 360 px.
 * P1 DoD: Kabir plan -> application in <= 6 decision screens -> check answers -> fee -> hand-off.
 */
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

async function startFromPlan(page: Page) {
  await page.getByTestId("start-application").click();
  await expect(page.locator("[data-screen='SCR-018']")).toBeVisible();
  await page.getByTestId("start-case").click();
  await expect(page).toHaveURL(/\/apply\/q\/for_whom/);
}

/** Follows "Continue: <task>" on the task list. */
async function nextTask(page: Page) {
  await expect(page.locator("[data-screen='SCR-030']")).toBeVisible();
  await page.getByTestId("continue-task").click();
}

async function signLater(page: Page) {
  await expect(page.locator("[data-screen='SCR-034']")).toBeVisible();
  await page.getByTestId("fix-signature").click();
  await page.getByTestId("sign-later").click();
  await expect(page.locator("[data-screen='SCR-034']")).toBeVisible();
  await page.getByRole("link", { name: "Back to the task list" }).last().click();
}

test("Kabir: plan -> <= 6 decision screens -> check answers -> fee -> hand-off (P1 DoD)", async ({
  page,
}) => {
  await makePlan(page, {
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/, /^Car/],
    aadhaar: "Yes",
  });
  await startFromPlan(page);
  const questions = new Set<string>();
  page.on("framenavigated", (f) => {
    const m = /\/apply\/q\/([a-z_0-9]+)/.exec(f.url());
    if (m?.[1]) questions.add(m[1]);
  });
  questions.add("for_whom");
  await answer(page, "Me");
  await answer(page, "General");
  await nextTask(page);
  await answer(page, "No licence yet");
  await nextTask(page);
  await answer(page, "Yes"); // mobile linked
  await answer(page, "Yes"); // relation line on Aadhaar
  await nextTask(page);
  await page.getByRole("checkbox", { name: "I've read what Form 1 covers" }).check({ force: true });
  await page.getByTestId("q-continue").click();
  await nextTask(page);
  await signLater(page);
  expect(
    [...questions].length,
    `decision screens: ${[...questions].join(", ")}`,
  ).toBeLessThanOrEqual(6);

  await nextTask(page);
  await expect(page.locator("[data-screen='SCR-038']")).toBeVisible();
  await expect(page.getByTestId("answer-category")).toContainText("General");
  // Continuing without confirming shows the error summary; confirm then continue.
  await page.getByTestId("check-continue").click();
  await expect(page.locator(".mj-error-summary")).toContainText("Tick the box");
  await page.getByRole("checkbox", { name: /checked these answers/ }).check({ force: true });
  await page.getByTestId("check-continue").click();

  await expect(page.locator("[data-screen='SCR-039']")).toBeVisible();
  // LL-stage total for 2 classes = 95000 paise (fees.json), formatted by Intl.
  await expect(page.getByTestId("fee-now")).toHaveText(/950/);
  await page.getByTestId("fee-continue").click();

  await expect(page.locator("[data-screen='SCR-040']")).toBeVisible();
  await expect(page.getByTestId("simulated-chip")).toBeVisible();
  await expect(page.getByText(/Aadhaar, OTP and payment happen only there/)).toBeVisible();
  await expect(page.getByTestId("open-sarathi")).toHaveAttribute(
    "href",
    /sarathi\.parivahan\.gov\.in/,
  );

  // Copy-pack values match the case (MD-114).
  await page.getByTestId("open-pack").click();
  await expect(page.locator("[data-screen='SCR-041']")).toBeVisible();
  await expect(page.getByTestId("pack-value-classes")).toHaveText("MCWG, LMV");
  await expect(page.getByTestId("pack-value-category")).toHaveText("General");
  await expect(page.getByTestId("pack-value-licence_held")).toContainText("does not hold any");
  await expect(page.getByTestId("pack-value-dob")).toHaveText("14-03-2007");
  await expect(page.getByTestId("pack-value-state")).toHaveText("Jammu and Kashmir");

  // Back from Sarathi: paid -> application number on the phone -> home shows the LL test step.
  await page.goto("/en/apply/handoff/return");
  await page
    .getByRole("radio", { name: "Paid and got an application number" })
    .check({ force: true });
  await page.getByTestId("return-continue").click();
  await expect(page).toHaveURL(/application-number/);
  await page.getByLabel("Application number").fill("2026001234");
  await page.getByTestId("app-number-save").click();
  await expect(page.getByTestId("stage-h1")).toHaveText("Your LL test is next.");
});

test("Tanvi: both blockers caught before the hand-off (EC-02, EC-03, P1 DoD)", async ({ page }) => {
  await makePlan(page, {
    age: { dob: ["07", "07", "2007"] },
    vehicles: [/Scooter, no gears/],
    aadhaar: "No, it's elsewhere",
  });
  await expect(page.locator("[data-rule='JK-B02']")).toBeVisible();
  await startFromPlan(page);
  await answer(page, "Me");
  await answer(page, "General");
  await nextTask(page);
  await answer(page, "No licence yet");
  await page.getByRole("radio").first().check({ force: true }); // office (non-Aadhaar path)
  await page.getByTestId("q-continue").click();
  await nextTask(page);
  await page.goto("/en/apply/q/aadhaar_relation_line");
  await page.getByRole("radio", { name: "No, it's blank or shows C/o" }).check({ force: true });
  await expect(page.getByText("Sort this out before Sarathi")).toBeVisible();
  await page.getByTestId("q-continue").click();
  await page.goto("/en/apply");
  const issues = page.getByTestId("case-issues");
  await expect(issues.locator("[data-rule='JK-B02']")).toBeVisible();
  await expect(issues.locator("[data-rule='JK-B03']")).toBeVisible();
  await page.goto("/en/apply/check");
  const before = page.getByTestId("check-issues");
  await expect(before.locator("[data-rule='JK-B02']")).toBeVisible();
  await expect(before.locator("[data-rule='JK-B03']")).toBeVisible();
});

test("Rahul (17) in a parent's account: family mode with parental consent (D-13 revised, P1 DoD)", async ({
  page,
}) => {
  await page.goto("/en/plan");
  await page.getByRole("radio", { name: "16 or 17", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: /Up to 50 cc/ }).check({ force: true });
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("radio", { name: "Yes", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Show my plan" }).click();
  await startFromPlan(page);
  await answer(page, "Someone in my family");
  await answer(page, "My child");
  // Adding a family member needs a signed-in adult account (API-07/08). The mock build has no
  // e-mail server, so the sign-in link is shown on screen, labelled simulated.
  await expect(page.getByTestId("family-signin-gate")).toBeVisible();
  await page.getByTestId("family-signin").click();
  await expect(page.locator("[data-screen='SCR-155']")).toBeVisible();
  await page.getByTestId("signin-send").click();
  await expect(page.getByText("Enter an e-mail address like name@example.com")).toBeVisible();
  await page.getByTestId("signin-email").fill("parent@example.com");
  await page.getByTestId("signin-send").click();
  await expect(page.getByTestId("signin-sent")).toBeVisible();
  await page.getByTestId("signin-simulated-link").click();
  await expect(page).toHaveURL(/\/apply\/q\/parental_consent/);
  await expect(page.locator("[data-screen='SCR-031']")).toContainText(
    "Your consent as their parent or guardian",
  );
  await page.getByTestId("q-continue").click();
  await expect(page.getByTestId("error-summary")).toContainText("Tick the box");
  await page.getByRole("checkbox", { name: /I'm 18 or over, and I agree/ }).check({ force: true });
  await page.getByTestId("q-continue").click();
  await expect(page).toHaveURL(/\/apply\/q\/category/);
  await page.goto("/en/apply");
  await expect(page.getByText(/Family mode/).first()).toBeVisible();
  // Every feature is reachable in family mode, including the AI voice entry.
  await page.goto("/en");
  await expect(page.getByTestId("stage-home")).toBeVisible();
  await page.goto("/en/privacy");
  await expect(page.getByTestId("consent-ai_coach").getByRole("switch")).toBeEnabled();
});

test("MD-110 autosave: an answer survives a reload (draft in IndexedDB)", async ({ page }) => {
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await startFromPlan(page);
  await answer(page, "Me");
  await page.getByRole("radio", { name: "Ex-servicemen", exact: true }).check({ force: true });
  await page.getByTestId("q-continue").click();
  await page.reload();
  await page.goto("/en/apply/q/category");
  await expect(page.getByRole("radio", { name: "Ex-servicemen", exact: true })).toBeChecked();
});

test("EC-09 payment debited but pending: guidance screen, don't pay again", async ({ page }) => {
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await startFromPlan(page);
  await page.goto("/en/apply/handoff/return");
  await page
    .getByRole("radio", { name: "Money debited, status not updated" })
    .check({ force: true });
  await page.getByTestId("return-continue").click();
  await expect(page.locator("[data-screen='SCR-043']")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Don't pay again. Don't cancel.",
  );
  await expect(page.getByTestId("pending-day")).toContainText("day 1 of 3");
  await expect(page.getByRole("checkbox", { name: /Remind me/ })).not.toBeChecked();
  await page.goto("/en");
  await expect(page.getByTestId("stage-h1")).toContainText("Don't pay again");
});

test("EC-11 Sarathi outage: banner, answers kept, no way to open Sarathi", async ({ page }) => {
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await startFromPlan(page);
  await answer(page, "Me");
  await page.goto("/en/apply/handoff?sarathi=down");
  await expect(page.getByText("Sarathi isn't responding right now")).toBeVisible();
  await expect(page.getByTestId("open-sarathi")).toHaveCount(0);
  await expect(page.getByText("Your answers are saved here").first()).toBeVisible();
  await page.goto("/en/apply/q/for_whom");
  await expect(page.getByRole("radio", { name: "Me", exact: true })).toBeChecked();
});

test("MD-115 simulated eKYC screen has no input that could take an Aadhaar number or OTP", async ({
  page,
}) => {
  await page.goto("/en/apply/handoff/ekyc");
  await expect(
    page.getByText("Simulated: in production this step runs on Sarathi.").first(),
  ).toBeVisible();
  await expect(
    page.locator("main input, main textarea, main [contenteditable='true']"),
  ).toHaveCount(0);
});

test("MD-113 photo fixer: upload is processed on the phone and nothing is uploaded", async ({
  page,
}) => {
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "I don't have Aadhaar",
  });
  await startFromPlan(page);
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && (r.postDataBuffer()?.length ?? 0) > 5000) uploads.push(r.url());
  });
  await page.goto("/en/apply/photo");
  // A synthetic 600x800 grey-background image (no face, no person).
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 800;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#b9b9b9";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#7a4a2a";
    ctx.beginPath();
    ctx.ellipse(300, 330, 120, 160, 0, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL("image/png").split(",")[1] as string;
  });
  await page
    .getByTestId("image-upload")
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator("[data-screen='SCR-036']")).toBeVisible();
  await expect(page.getByTestId("fix-checks")).toContainText("Cropped to 420 × 525 px");
  await expect(page.getByTestId("fix-checks")).toContainText("photo.jpg");
  await expect(page.getByTestId("save-image")).toHaveAttribute("download", "photo.jpg");
  expect(uploads).toEqual([]);
});
