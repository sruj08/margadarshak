import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { onboard } from "./helpers";
import { mobileOnly } from "./journey-helpers";

/**
 * P1 · Journey-test lab replica (MD-139) and logging (MD-140). The server must be started with
 * LAB_TOKEN set (e.g. `LAB_TOKEN=labtest pnpm test:e2e`); without it the route is always 404.
 */
const TOKEN = process.env["LAB_TOKEN"] ?? "";

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(mobileOnly(testInfo), "P1 journey specs run on the 360 px profile");
  await onboard(context, baseURL ?? "", "en");
});

test("Lab replica is 404 without the token and with a wrong one", async ({ request }) => {
  expect((await request.get("/en/lab/sarathi-sequence")).status()).toBe(404);
  expect((await request.get("/en/lab/sarathi-sequence?token=wrong-token")).status()).toBe(404);
});

test("Lab replica: banner, noindex, logged trial, CSV with the FIELD_STUDY columns", async ({
  page,
  request,
}) => {
  test.skip(!TOKEN, "LAB_TOKEN not set for this run");
  const res = await request.get(`/en/lab/sarathi-sequence?token=${TOKEN}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-robots-tag"]).toContain("noindex");
  await page.goto(`/en/lab/sarathi-sequence?token=${TOKEN}`);
  await expect(
    page.getByText("Research replica of public Sarathi screens. Not a government site."),
  ).toBeVisible();
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);
  await page.getByTestId("lab-start").click();
  const replica = page.getByTestId("replica");
  await replica.getByRole("combobox", { name: "State Name" }).selectOption("Jammu and Kashmir");
  await replica.getByRole("button", { name: "Fee Payment", exact: true }).click(); // a wrong click is logged
  await replica.getByRole("button", { name: "ISSUE OF LEARNERS LICENCE" }).click();
  await replica.getByRole("button", { name: "Continue" }).click();
  await replica.getByRole("button", { name: "Submit" }).click(); // validation error is logged
  await expect(replica.getByRole("alert")).toContainText("mandatory");
  await page.getByTestId("lab-stop").click();
  const log = page.getByTestId("lab-log");
  await expect(log.locator("tbody tr")).toHaveCount(1);
  await expect(log.locator("tbody tr td").nth(5)).toHaveText("2");
  const dl = page.waitForEvent("download");
  await page.getByTestId("lab-csv").click();
  const csv = readFileSync((await (await dl).path()) as string, "utf8");
  const [header, row] = csv.split("\n");
  expect(header?.startsWith("pid,cell,order,system,case,t0_real_site_s")).toBe(true);
  expect(header?.split(",")).toHaveLength(42);
  expect(row).toContain("sarathi_lab");
});
