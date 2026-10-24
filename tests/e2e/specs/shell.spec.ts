import { expect, test } from "@playwright/test";
import { FOOTER_TEXT, LOCALES, onboard, ROUTES } from "./helpers";

test.describe("P0 demo checkpoint @smoke", () => {
  test("first run: language picker, launch notice, then the home shell", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/language$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your language");
    await page.getByRole("radio", { name: /हिन्दी/ }).check({ force: true });
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/\/hi\/welcome$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.getByRole("button", { name: "ठीक है" }).click();

    await expect(page).toHaveURL(/\/hi$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "मुख्य" }).getByRole("link")).toHaveCount(4);
    await expect(page.getByTestId("non-affiliation-footer")).toContainText(FOOTER_TEXT.hi);

    // Next visit to "/" goes straight home in the chosen language.
    await page.goto("/");
    await expect(page).toHaveURL(/\/hi$/);
  });

  test("trust line shows fees from fees.json with a source chip popover", async ({
    page,
    context,
    baseURL,
  }) => {
    await onboard(context, baseURL ?? "", "en");
    await page.goto("/en");
    const trust = page.getByTestId("trust-line");
    await expect(trust).toContainText("Govt fee for one vehicle class:");
    // Amounts are formatted by Intl (₹ + digits) from the rule pack, never typed in copy.
    await expect(trust.locator(".md-trust__num")).toHaveCount(2);
    await expect(trust.locator(".md-trust__num").first()).toHaveText(/^₹[\d,]+$/);
    await expect(trust).toContainText("Never pay agents.");

    await trust.getByRole("button", { name: /Where this comes from: CMVR r\.32/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Where this comes from" })).toBeVisible();
    await expect(dialog).toContainText("CMVR");
    await expect(dialog.getByRole("link", { name: /Open the source/ })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  test("the shell fits 360 px without horizontal scroll", async ({ page, context, baseURL }) => {
    await onboard(context, baseURL ?? "", "hi");
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ["/hi", "/en", "/hi/help"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("non-affiliation footer on every route (MD-005)", () => {
  for (const locale of LOCALES) {
    for (const route of ROUTES) {
      test(`${locale}${route || "/"}`, async ({ page, context, baseURL }) => {
        await onboard(context, baseURL ?? "", locale);
        await page.goto(`/${locale}${route}`);
        const footer = page.getByTestId("non-affiliation-footer");
        await expect(footer).toBeVisible();
        await expect(footer).toContainText(FOOTER_TEXT[locale]);
      });
    }
  }
});

test("clearing the device brings the launch notice back (MD-005)", async ({
  page,
  context,
  baseURL,
}) => {
  await onboard(context, baseURL ?? "", "en");
  await page.goto("/en");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Clear this device" }).click();
  await page.getByRole("button", { name: "Clear now" }).click();
  await expect(page).toHaveURL(/\/(en|hi)\/language$/);
  await page.getByRole("button", { name: /Continue|जारी रखें/ }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});
