import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";
import { loadPersona, mobileOnly } from "./journey-helpers";

/** P1 · Privacy centre (MD-134, MD-135, EC-26): consents, export, delete with confirmation. */
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

test("No consent is pre-ticked; one tap on and one tap off (MD-133/134)", async ({ page }) => {
  await loadPersona(page, "Kabir, new");
  await page.goto("/en/privacy");
  const switches = page.getByTestId("consents").getByRole("switch");
  await expect(switches.first()).toBeEnabled();
  const n = await switches.count();
  for (let i = 0; i < n; i++) await expect(switches.nth(i)).not.toBeChecked();
  const wa = page.getByTestId("consent-whatsapp_updates").getByRole("switch");
  await wa.check({ force: true });
  await expect(wa).toBeChecked();
  await wa.uncheck({ force: true });
  await expect(wa).not.toBeChecked();
});

test("Export contains the server copy and this phone's data, never an identity number", async ({
  page,
}) => {
  await loadPersona(page, "Kabir, LL day 12");
  await page.goto("/en/privacy");
  const dl = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe("margdarshak-my-data.json");
  const json = JSON.parse(readFileSync((await file.path()) as string, "utf8"));
  expect(json.server.data.cases).toHaveLength(1);
  expect(json.server.data.consents.map((c: { purpose: string }) => c.purpose)).toContain(
    "ai_coach",
  );
  expect(json.this_phone.active_case.caseId).toBe("cas_demo_kabir_d12");
  expect(JSON.stringify({ s: json.server, p: json.this_phone })).not.toMatch(
    /aadhaar_number|"otp"/i,
  );
});

test("Delete: type-to-confirm, reminders cancelled, clean home (EC-26)", async ({ page }) => {
  await loadPersona(page, "Kabir, LL day 12");
  await page.goto("/en/privacy");
  await page.getByTestId("delete-open").click();
  const confirm = page.getByTestId("delete-confirm");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("delete-word").fill("DELETE");
  await confirm.click();
  await expect(page.getByText("Your account and case are deleted")).toBeVisible();
  await expect(page.getByText(/scheduled reminders? (was|were) cancelled/)).toBeVisible();
  await expect(
    page.getByText("Anything on Sarathi stays on Sarathi.", { exact: false }),
  ).toBeVisible();
  await page.goto("/en");
  await expect(page.locator("[data-screen='SCR-003']")).toBeVisible();
  await expect(page.getByTestId("stage-home")).toHaveCount(0);
});

test("Privacy notice: plain sections, processors listed, built to the DPDP Rules (MD-135)", async ({
  page,
}) => {
  for (const locale of ["en", "hi"]) {
    await page.goto(`/${locale}/privacy/notice`);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(10);
    await expect(page.locator("main")).toContainText("Gemini");
    await expect(page.locator("main")).toContainText("Sarvam");
    await expect(page.locator("main")).not.toContainText(/DPDP[- ]compliant/i);
  }
});
