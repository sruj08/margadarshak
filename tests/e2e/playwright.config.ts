import { defineConfig, devices } from "@playwright/test";
import { REAL } from "./real-env.mjs";

/**
 * Margdarshak e2e + accessibility (MD-014). Two modes:
 *
 *  - mock (default): runs against E2E_BASE_URL (a preview URL in CI) or starts the production build
 *    of apps/web (.next, no API URL, so the UI uses its local mock API). Two profiles: a 360 x 800
 *    Android phone and a desktop.
 *      pnpm --filter @margdarshak/web build && pnpm test:e2e
 *
 *  - real (E2E_MODE=real): full stack. Starts the Go API on embedded PostgreSQL with the synthetic
 *    personas (scripts/real-api.mjs) and the web build in .next-real (built with NEXT_PUBLIC_API_URL
 *    pointing at the API), then runs specs/real-*.spec.ts on the 360 px profile.
 *      pnpm test:e2e:real   (builds .next-real first, see tests/e2e/package.json)
 */
const MODE = process.env["E2E_MODE"] === "real" ? "real" : "mock";
const PORT = MODE === "real" ? REAL.webPort : Number(process.env["E2E_PORT"] ?? 3100);
const baseURL = process.env["E2E_BASE_URL"] ?? `http://localhost:${PORT}`;
const reuse = !process.env["CI"];

const phone = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 800 },
  screen: { width: 360, height: 800 },
};

const webServer =
  MODE === "real"
    ? [
        {
          command: "node tests/e2e/scripts/real-api.mjs",
          url: `${REAL.apiUrl}/v1/health`,
          reuseExistingServer: reuse,
          timeout: 300_000,
          cwd: "../..",
          stdout: "ignore" as const,
        },
        {
          command: `pnpm --filter @margdarshak/web exec next start --port ${PORT}`,
          url: `${baseURL}/en/help`,
          reuseExistingServer: reuse,
          timeout: 120_000,
          cwd: "../..",
          env: {
            NEXT_DIST_DIR: REAL.nextDistDir,
            NEXT_PUBLIC_API_URL: REAL.apiUrl,
            LAB_TOKEN: REAL.labToken,
          },
        },
      ]
    : {
        command: `pnpm --filter @margdarshak/web exec next start --port ${PORT}`,
        url: `${baseURL}/en/help`,
        reuseExistingServer: reuse,
        timeout: 120_000,
        cwd: "../..",
      };

export default defineConfig({
  testDir: "./specs",
  ...(MODE === "real"
    ? { testMatch: "real-*.spec.ts", globalTeardown: "./scripts/real-teardown.mjs" }
    : { testIgnore: "real-*.spec.ts" }),
  fullyParallel: MODE !== "real",
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Real mode shares one database and one seeded persona set, so its specs run one at a time.
  workers: MODE === "real" ? 1 : process.env["CI"] ? 2 : 4,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    // The service worker precaches every chunk after load; block it so page timing is deterministic.
    // Offline behaviour gets its own spec with service workers allowed (P1).
    serviceWorkers: "block",
  },
  projects:
    MODE === "real"
      ? [{ name: "real-mobile-360", use: phone }]
      : [
          { name: "mobile-360", use: phone },
          {
            name: "desktop",
            use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
          },
        ],
  ...(process.env["E2E_BASE_URL"] && MODE === "mock" ? {} : { webServer }),
});
