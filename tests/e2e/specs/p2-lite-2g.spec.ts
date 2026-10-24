import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";

/**
 * EC-19 Lite learning on 2G (MD-819, FRONTEND §9): with the network throttled to a 2G profile over
 * CDP, the Lite learn page arrives under the 300 KB budget and works without the full client
 * framework, and the Lite LL practice test scores itself on the phone when offline (practice only).
 */

const KB = 1024;
// A slow 2G profile: 250 kbit/s down, 50 kbit/s up, 800 ms RTT.
const TWO_G = {
  offline: false,
  latency: 800,
  downloadThroughput: (250 * KB) / 8,
  uploadThroughput: (50 * KB) / 8,
};

async function throttle(page: Page): Promise<{ cdp: CDPSession; bytes: () => number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", TWO_G);
  let total = 0;
  cdp.on("Network.loadingFinished", (e: { encodedDataLength: number }) => {
    total += e.encodedDataLength;
  });
  return { cdp, bytes: () => total };
}

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test.describe("EC-19 Lite learn on 2G", () => {
  test.setTimeout(180_000);

  test("EC-19: the Lite learn page loads under 300 KB on a 2G profile", async ({ page }) => {
    const net = await throttle(page);
    await page.goto("/en/lite/learn", { waitUntil: "load", timeout: 120_000 });
    await expect(page.getByTestId("lite-learn")).toBeVisible();
    await expect(page.getByTestId("non-affiliation-footer")).toBeVisible();
    await expect(page.getByTestId("lite-state-JK")).toContainText("10 questions, 6 to pass");
    // No full-app shell: no tab bar, no message catalogue for the client.
    await expect(page.locator(".md-tabbar")).toHaveCount(0);
    expect(net.bytes()).toBeLessThan(300 * KB);
  });

  test("EC-19: offline, the Lite LL practice test scores on the phone (practice only)", async ({
    page,
    context,
  }) => {
    await throttle(page);
    await page.goto("/en/lite/learn/ll-sim/JK", { waitUntil: "load", timeout: 120_000 });
    await expect(page.getByTestId("lite-format")).toContainText("10 questions, 6 to pass");
    const groups = page.locator("#lite-quiz fieldset");
    await expect(groups).toHaveCount(10);
    await context.setOffline(true);
    for (let i = 0; i < 10; i++) await groups.nth(i).getByRole("radio").first().check();
    const url = page.url();
    await page.getByRole("button", { name: "Check my answers" }).click();
    const out = page.getByTestId("lite-out");
    await expect(out).toBeVisible();
    await expect(out).toContainText(/\d+ of 10 right\./);
    await expect(out).toContainText("Counts for practice only.");
    expect(page.url()).toBe(url);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("md.lite.last") ?? "null"),
    );
    expect(saved).toMatchObject({ total: 10, practice: true });
  });

  test("EC-19 + EC-10: Kerala in Lite says the LL test is at the RTO", async ({ page }) => {
    await page.goto("/en/lite/learn/ll-sim/KL");
    await expect(page.getByTestId("lite-rto")).toContainText("taken at the RTO");
  });

  test("EC-19: online, the Lite form posts and the server scores it", async ({ page }) => {
    await page.goto("/en/lite/learn/review");
    const groups = page.locator("#lite-quiz > fieldset");
    await expect(groups).toHaveCount(8);
    for (let i = 0; i < 8; i++) {
      await groups.nth(i).locator('input[name^="a:"]').first().check();
      await groups.nth(i).locator('input[name^="c:"]').first().check();
    }
    await page.getByRole("button", { name: "Check my answers" }).click();
    await expect(page.getByTestId("lite-result")).toBeVisible();
    await expect(page.getByTestId("lite-result")).toContainText(/\d+ \/ 8/);
  });
});
