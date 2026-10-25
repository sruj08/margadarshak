import { expect, type Page, type TestInfo } from "@playwright/test";

/** P1 journey specs run at 360 px (the design baseline); the desktop project skips them. */
export function mobileOnly(testInfo: TestInfo) {
  return testInfo.project.name !== "mobile-360";
}

export type Age = { band: string } | { dob: [string, string, string] } | { year: string };

export type AadhaarChoice = "Yes" | "No, it's elsewhere" | "I don't have Aadhaar";

/** Taps a radio or checkbox card the way a person does (its label), then checks it took. */
export async function tapChoice(page: Page, role: "radio" | "checkbox", name: RegExp | string) {
  const el = page.getByRole(role, typeof name === "string" ? { name, exact: true } : { name });
  await el.locator("xpath=ancestor::label[1]").click();
  await expect(el).toBeChecked();
}

/**
 * Opens the wizard and answers the first screens (what you need → state → Aadhaar). "Yes" means
 * "my Aadhaar address is in this state; I'll type my age", so the age screen comes next.
 */
export async function openPlanToAge(
  page: Page,
  aadhaar: AadhaarChoice,
  opts: { locale?: string; navigate?: boolean } = {},
) {
  if (opts.navigate !== false) await page.goto(`/${opts.locale ?? "en"}/plan`);
  await expect(page.locator("[data-screen='SCR-009']")).toBeVisible();
  await tapChoice(page, "radio", /^My first licence/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-012']")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-012A']")).toBeVisible();
  const label = aadhaar === "Yes" ? /^Type my age instead/ : new RegExp(`^${aadhaar}`);
  await tapChoice(page, "radio", label);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-010']")).toBeVisible();
}

/** Re-walks a restored wizard with every answer kept, to the plan card. */
export async function replayPlan(page: Page) {
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId("plan-card").isVisible()) return;
    const btn = page.getByRole("button", { name: /^(Next|Show my plan)/ });
    if (!(await btn.isVisible())) {
      await page.waitForTimeout(250);
      continue;
    }
    await btn.click();
  }
  await expect(page.getByTestId("plan-card")).toBeVisible();
}

/**
 * Walks the plan wizard: what you need → state → Aadhaar → age (when not connected) → vehicles.
 * Returns the screens seen.
 */
export async function makePlan(
  page: Page,
  opts: {
    age: Age;
    vehicles: RegExp[];
    aadhaar: AadhaarChoice;
    locale?: string;
  },
) {
  const locale = opts.locale ?? "en";
  await openPlanToAge(page, opts.aadhaar, { locale });
  const screens: string[] = ["SCR-009", "SCR-012", "SCR-012A", "SCR-010"];
  if ("band" in opts.age) {
    await tapChoice(page, "radio", opts.age.band);
  } else if ("dob" in opts.age) {
    await page.getByLabel("Day", { exact: true }).fill(opts.age.dob[0]);
    await page.getByLabel("Month", { exact: true }).fill(opts.age.dob[1]);
    await page.getByLabel("Year", { exact: true }).fill(opts.age.dob[2]);
  } else {
    const yearOnly = page.getByRole("checkbox", { name: /shows only the year/ });
    await yearOnly.locator("xpath=ancestor::label[1]").click();
    await expect(yearOnly).toBeChecked();
    await page.getByLabel("Year", { exact: true }).fill(opts.age.year);
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-011']")).toBeVisible();
  screens.push("SCR-011");
  for (const v of opts.vehicles) {
    const box = page.getByRole("checkbox", { name: v });
    if (!(await box.isVisible()))
      await page.getByRole("button", { name: /More vehicle types/ }).click();
    // The input is a 13 px target under the card; near the tab bar a forced click can land on the
    // bar, so tap the card the way a person does.
    if (!(await box.isChecked())) await box.locator("xpath=ancestor::label[1]").click();
    await expect(box).toBeChecked();
  }
  await page.getByRole("button", { name: "Show my plan" }).click();
  await expect(page.getByTestId("plan-card")).toBeVisible();
  return screens;
}

/** Facts on the plan card that must be identical online and offline (MD-108). */
export async function cardFacts(page: Page) {
  const card = page.getByTestId("plan-card");
  await expect(card.getByTestId("plan-class").first()).toBeVisible();
  // The step count animates up (CountUp); read it once it has settled.
  const steps = card.getByTestId("fact-steps");
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await steps.innerText();
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [250, 250, 250, 250] },
    )
    .toBe(true);
  return {
    classes: await card
      .getByTestId("plan-class")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-class"))),
    fee: await card.getByTestId("fact-fee").innerText(),
    visits: await card.getByTestId("fact-visits").innerText(),
    steps: await card.getByTestId("fact-steps").innerText(),
    earliest: await card.getByTestId("fact-earliest").innerText(),
    issues: await card
      .locator("[data-rule]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")).sort()),
    docs: await card
      .getByTestId("plan-doc")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-doc"))),
  };
}

/** Answers the current question page by option label and continues. */
export async function answer(page: Page, option: string) {
  const esc = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("radio", { name: new RegExp(`^${esc}(?:$|\\s)`) }).check({ force: true });
  const before = page.url();
  await page.getByTestId("q-continue").click();
  await page.waitForURL((u) => u.href !== before);
}

/**
 * Walks the simulated Sarathi slot booking to the confirm step: application, first bookable day,
 * first time with seats. `onCalendar` runs while the calendar is open (for a11y checks).
 */
export async function pickSlot(page: Page, onCalendar?: () => Promise<void>) {
  await page.getByTestId("slot-app-next").click();
  const day = page.locator(".sb-cal__day:is([data-kind='open'], [data-kind='few'])").first();
  await day.locator("input").check({ force: true });
  if (onCalendar) await onCalendar();
  await page.getByTestId("slot-date-next").click();
  await page.locator(".sb-time:not([data-full]) input").first().check({ force: true });
  await page.getByTestId("slot-time-next").click();
}

/** Books a slot end to end and opens the appointment slip. */
export async function bookSlot(page: Page, onCalendar?: () => Promise<void>) {
  await pickSlot(page, onCalendar);
  await page.getByTestId("slot-confirm").click();
  await expect(page.getByTestId("slot-ack")).toBeVisible();
  await page.getByTestId("slot-to-slip").click();
}

export async function loadPersona(page: Page, name: string, locale = "en") {
  await page.goto(`/${locale}`);
  await page.getByTestId("persona-open").click();
  await page.getByRole("radio", { name: new RegExp(name) }).check({ force: true });
  await page.getByTestId("persona-load").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByTestId("stage-home").or(page.locator("[data-screen='SCR-003']")).first(),
  ).toBeVisible();
}
