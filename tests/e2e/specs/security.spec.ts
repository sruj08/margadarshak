import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";

test.describe("analytics-free baseline and headers (MD-025) @smoke", () => {
  test("home sends CSP, HSTS, Referrer-Policy and Permissions-Policy", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(`${baseURL}/en/help`);
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });

  test("home makes no request to a third-party domain", async ({ page, context, baseURL }) => {
    await onboard(context, baseURL ?? "", "en");
    const origin = new URL(baseURL ?? "").origin;
    const foreign: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    await page.goto("/en");
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    expect(foreign).toEqual([]);
  });

  test("the simulated chip renders for mock adapter data (MD-045)", async ({
    page,
    context,
    baseURL,
  }) => {
    await onboard(context, baseURL ?? "", "hi");
    await page.goto("/hi/dev/components");
    const chips = page.getByTestId("simulated-chip");
    // Two mock-adapter chips render; the real ("nic") adapter renders none.
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText("सिमुलेशन");
    await expect(chips.first()).toHaveAttribute("data-adapter-mode", "mock");
  });

  test("manifest and service worker are served", async ({ request, baseURL }) => {
    const manifest = await request.get(`${baseURL}/manifest.webmanifest`);
    expect(manifest.ok()).toBe(true);
    const json = await manifest.json();
    expect(json.short_name).toBe("Margdarshak");
    expect(json.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    const sw = await request.get(`${baseURL}/serwist/sw.js`);
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["service-worker-allowed"]).toBe("/");
    const icon = await request.get(`${baseURL}/pwa/icon-192.png`);
    expect(icon.headers()["content-type"]).toContain("image/png");
  });
});
