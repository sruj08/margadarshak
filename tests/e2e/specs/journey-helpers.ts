import { expect, type Page, type TestInfo } from "@playwright/test";

/** P1 journey specs run at 360 px (the design baseline); the desktop project skips them. */
export function mobileOnly(testInfo: TestInfo) {
  return testInfo.project.name !== "mobile-360";
}

export type Age = { band: string } | { dob: [string, string, string] } | { year: string };

/** Walks the 3-screen plan wizard (SCR-010..012). Returns the number of question screens seen. */
export async function makePlan(
  page: Page,
  opts: {
    age: Age;
    vehicles: RegExp[];
    aadhaar: "Yes" | "No, it's elsewhere" | "I don't have Aadhaar";
    locale?: string;
  },
) {
  const locale = opts.locale ?? "en";
  await page.goto(`/${locale}/plan`);
  const screens: string[] = [];
  await expect(page.locator("[data-screen='SCR-010']")).toBeVisible();
  screens.push("SCR-010");
  if ("band" in opts.age) {
    await page.getByRole("radio", { name: opts.age.band, exact: true }).check({ force: true });
  } else if ("dob" in opts.age) {
    await page.getByLabel("Day", { exact: true }).fill(opts.age.dob[0]);
    await page.getByLabel("Month", { exact: true }).fill(opts.age.dob[1]);
    await page.getByLabel("Year", { exact: true }).fill(opts.age.dob[2]);
  } else {
    await page.getByRole("checkbox", { name: /shows only the year/ }).check();
    await page.getByLabel("Year", { exact: true }).fill(opts.age.year);
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-011']")).toBeVisible();
  screens.push("SCR-011");
  for (const v of opts.vehicles) {
    const box = page.getByRole("checkbox", { name: v });
    if (!(await box.isVisible()))
      await page.getByRole("button", { name: /More vehicle types/ }).click();
    await box.check({ force: true });
  }
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.locator("[data-screen='SCR-012']")).toBeVisible();
  screens.push("SCR-012");
  await page.getByRole("radio", { name: new RegExp(`^${opts.aadhaar}`) }).check({ force: true });
  await page.getByRole("button", { name: "Show my plan" }).click();
  await expect(page.getByTestId("plan-card")).toBeVisible();
  return screens;
}

/** Facts on the plan card that must be identical online and offline (MD-108). */
export async function cardFacts(page: Page) {
  const card = page.getByTestId("plan-card");
  await expect(card.getByTestId("plan-class").first()).toBeVisible();
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
