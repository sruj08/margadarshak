import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";
import {
  type Age,
  cardFacts,
  makePlan,
  mobileOnly,
  openPlanToAge,
  replayPlan,
  tapChoice,
} from "./journey-helpers";

/**
 * P1 · S1 Licence plan (MD-101, MD-103, MD-105, MD-107, MD-108), at 360 px on the mock API.
 * Personas follow tests/golden/personas.json.
 */
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

test("Kabir: plan in 3 taps from the home tile (MD-101, P1 DoD)", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByTestId("verb-tiles").getByRole("link")).toHaveCount(4);
  await page.getByRole("link", { name: /Get my first licence/ }).click();
  await expect(page).toHaveURL(/\/en\/plan/);
  const screens = await makePlan(page, {
    age: { band: "18 or 19" },
    vehicles: [/Bike with gears/, /^Car/],
    aadhaar: "Yes",
  });
  // need → state → Aadhaar → age (typed, not connected) → vehicles.
  expect(screens).toHaveLength(5);
  const facts = await cardFacts(page);
  expect(facts.classes).toEqual(["MCWG", "LMV-NT"]);
  // fees.json: 2 classes = 115000 + 20000 card, formatted by Intl (no literal in copy).
  expect(facts.fee).toMatch(/1,350/);
  expect(facts.visits).toContain("1");
  await expect(page.getByText("One application, 2 vehicles")).toBeVisible();
  await expect(page.getByTestId("start-application")).toBeVisible();
});

test("Sarathi order: need → state → connect Aadhaar (no age typed) → vehicle → plan", async ({
  page,
}) => {
  await page.goto("/en/plan");
  await tapChoice(page, "radio", /^My first licence/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("[data-screen='SCR-012']")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await tapChoice(page, "radio", /^Connect Aadhaar through DigiLocker/);
  await page.getByRole("button", { name: "Connect Aadhaar", exact: true }).click();
  await expect(page.locator("main input, main textarea")).toHaveCount(0);
  await page.getByTestId("plan-allow").click();
  await expect(page.getByTestId("id-card")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("plan-connected-next").click();
  await expect(page.locator("[data-screen='SCR-011']")).toBeVisible();
  await expect(page.locator("[data-screen='SCR-010']")).toHaveCount(0);
  await tapChoice(page, "checkbox", /Bike with gears/);
  await page.getByRole("button", { name: "Show my plan" }).click();
  expect((await cardFacts(page)).classes).toEqual(["MCWG"]);
});

test("EC-22 I already have an LL: its date gives a driving-licence plan", async ({ page }) => {
  await openPlanToAge(page, "Yes");
  // Back to the first screen to choose the LL path, then forward with the answers kept.
  await page.goto("/en/plan?step=need");
  await tapChoice(page, "radio", /^I already have a learner's licence/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await tapChoice(page, "radio", "20 to 39");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await tapChoice(page, "checkbox", /Bike with gears/);
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.locator("[data-screen='SCR-011B']")).toBeVisible();
  const d = new Date(Date.now() - 40 * 86_400_000);
  await page.getByLabel("Day", { exact: true }).fill(String(d.getDate()).padStart(2, "0"));
  await page.getByLabel("Month", { exact: true }).fill(String(d.getMonth() + 1).padStart(2, "0"));
  await page.getByLabel("Year", { exact: true }).fill(String(d.getFullYear()));
  await page.getByRole("button", { name: "Show my plan" }).click();
  await expect(page.getByTestId("start-application")).toHaveText("Apply for my driving licence");
  await page.getByTestId("start-application").click();
  await page.getByTestId("start-case").click();
  await expect(page).toHaveURL(/\/dl\/apply/);
  await expect(page.getByTestId("dl-continue")).toBeVisible();
});

test("Fee breakdown sheet lists every line with a source (MD-103, D-06)", async ({ page }) => {
  await makePlan(page, {
    age: { band: "20 to 39" },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await page.getByTestId("fact-fee").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("fee-total")).toHaveText(/900/);
  await expect(dialog).toContainText("If anyone asks for more, it isn't a government fee.");
  await expect(dialog.getByRole("button", { name: /Where this comes from/ }).first()).toBeVisible();
});

test("Mohan-ji (52): Form 1A blocker shown and LL test at the RTO (P-03, P1 DoD)", async ({
  page,
}) => {
  await makePlan(page, { age: { dob: ["11", "02", "1974"] }, vehicles: [/^Car/], aadhaar: "Yes" });
  await expect(page.locator("[data-rule='JK-B04']")).toBeVisible();
  await expect(page.locator("[data-rule='JK-B04']")).toContainText("Form 1A");
  await expect(page.getByText("The LL test is at the RTO in your case.")).toBeVisible();
  await expect(page.getByTestId("plan-doc").filter({ hasText: "Form 1A" }).first()).toBeVisible();
});

test("Tanvi: address mismatch blocker on the plan, with a fix that re-checks (MD-107)", async ({
  page,
}) => {
  await makePlan(page, {
    age: { dob: ["07", "07", "2007"] },
    vehicles: [/Scooter, no gears/],
    aadhaar: "No, it's elsewhere",
  });
  const issue = page.locator("[data-rule='JK-B02']");
  await expect(issue).toBeVisible();
  await expect(issue).toContainText("How to fix");
  await expect(issue.getByRole("button", { name: /Where this comes from/ })).toBeVisible();
  await expect(page.getByTestId("fact-visits")).toContainText("2");
  await issue.getByRole("button", { name: "I've updated my Aadhaar address" }).click();
  await expect(page.locator("[data-rule='JK-B02']")).toHaveCount(0);
  await expect(page.getByTestId("fact-visits")).toContainText("1");
});

test("EC-01: year-only DOB asks for a full date-of-birth document", async ({ page }) => {
  await makePlan(page, { age: { year: "2006" }, vehicles: [/Bike with gears/], aadhaar: "Yes" });
  await expect(page.locator("[data-rule='JK-B10']")).toBeVisible();
  await expect(page.locator("[data-doc='full_dob_proof']")).toBeVisible();
});

test("EC-05 Rahul (16-17): only the 50 cc tile, family mode, guardian consent (MD-805)", async ({
  page,
}) => {
  await openPlanToAge(page, "Yes");
  await tapChoice(page, "radio", "16 or 17");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /Bike with gears/ })).toBeDisabled();
  await tapChoice(page, "checkbox", /Up to 50 cc/);
  await page.getByRole("button", { name: "Show my plan" }).click();
  const facts = await cardFacts(page);
  expect(facts.classes).toEqual(["MC50CC"]);
  expect(facts.docs).toContain("guardian_consent");
  await expect(page.getByText("Family mode", { exact: true })).toBeVisible();
  await expect(page.getByTestId("start-application")).toHaveText(
    "Start my application in family mode",
  );
  // Sharing a minor's plan needs the parent's consent first.
  await page.getByRole("button", { name: "Send this plan to WhatsApp" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Send on WhatsApp" })).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /parent or guardian/ }).check({ force: true });
  await expect(sheet.getByTestId("share-whatsapp")).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );
});

test("EC-06/EC-21: a transport class under 20 moves to a later date (MD-105)", async ({ page }) => {
  await makePlan(page, { age: { band: "18 or 19" }, vehicles: [/^Car/, /^Truck/], aadhaar: "Yes" });
  await expect(page.locator("[data-rule='BLK-TRANSPORT-UNDER-20']")).toBeVisible();
  await expect(page.getByText("Some classes come later")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "plan card scrolls sideways at 360 px").toBeLessThanOrEqual(0);
  await page.goto(`/en/plan/classes${new URL(page.url()).search}`);
  await expect(page.locator("[data-screen='SCR-015']")).toBeVisible();
  await expect(page.getByText("Different ages, different dates")).toBeVisible();
});

test("Send to WhatsApp builds a wa.me link with the plan summary and no date of birth", async ({
  page,
}) => {
  await makePlan(page, {
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  });
  await page.getByRole("button", { name: "Send this plan to WhatsApp" }).click();
  const href = (await page.getByTestId("share-whatsapp").getAttribute("href")) ?? "";
  const text = decodeURIComponent(href.replace("https://wa.me/?text=", ""));
  expect(text).toContain("Motorcycle with gears");
  expect(text).toMatch(/govt fee ₹[\d,]+/);
  expect(text).not.toContain("2007-03-14");
  expect(text).not.toContain("14-03-2007");
  // The shared link opens the same plan on another phone (age band only).
  const link = text.match(/https?:\/\/\S+/)?.[0] ?? "";
  await page.goto(link);
  await expect(page.getByTestId("plan-card")).toBeVisible();
  expect((await cardFacts(page)).classes).toEqual(["MCWG"]);
});

const GOLDEN: Array<{
  name: string;
  age: Age;
  vehicles: RegExp[];
  aadhaar: "Yes" | "No, it's elsewhere";
}> = [
  {
    name: "P-01 Kabir bike",
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/],
    aadhaar: "Yes",
  },
  {
    name: "P-01 Kabir bike + car",
    age: { dob: ["14", "03", "2007"] },
    vehicles: [/Bike with gears/, /^Car/],
    aadhaar: "Yes",
  },
  {
    name: "P-02 Tanvi",
    age: { dob: ["07", "07", "2007"] },
    vehicles: [/Scooter, no gears/],
    aadhaar: "No, it's elsewhere",
  },
  { name: "P-03 Mohan-ji", age: { dob: ["11", "02", "1974"] }, vehicles: [/^Car/], aadhaar: "Yes" },
];

for (const g of GOLDEN) {
  test(`MD-108 offline plan equals online: ${g.name}`, async ({ page, context }) => {
    await makePlan(page, g);
    await expect(page.getByTestId("plan-saved")).toBeVisible();
    const online = await cardFacts(page);

    await page.getByRole("link", { name: "Change my answers" }).click();
    await expect(page.locator("[data-screen='SCR-009']")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    // Walk the wizard again without network: the TS rules mirror computes the card.
    await replayPlan(page);
    await expect(page.getByTestId("computed-on-phone")).toBeVisible();
    const offline = await cardFacts(page);
    await context.setOffline(false);
    expect(offline).toEqual(online);
  });
}
