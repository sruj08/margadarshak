import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { onboard } from "./helpers";

/**
 * P2 learning (workstream D, mock mode): the LL simulator's rule-pack format (J&K 10 / 6, EC-10
 * Kerala at the RTO), an offline review that syncs exactly once, and axe on the hub, review,
 * readiness and the LL exam.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}

/** page.evaluate that tolerates a navigation in progress (returns null and lets poll retry). */
async function safeEval<T>(page: Page, fn: () => T | Promise<T>): Promise<T | null> {
  try {
    await page.waitForLoadState("load");
    return await page.evaluate(fn);
  } catch {
    return null;
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await onboard(context, baseURL ?? "", "en");
});

test.describe("LL test simulator (F-22, MD-214)", () => {
  test("J&K mock is 10 questions with 6 to pass", async ({ page }) => {
    await page.goto("/en/learn/practise/ll-sim?state=JK");
    await expect(page.getByTestId("ll-format-line")).toHaveText("10 questions, 6 to pass.");
    await expect(page.getByTestId("ll-rto")).toHaveCount(0);
    await page.getByTestId("ll-start").click();
    await expect(page).toHaveURL(/\/en\/learn\/practise\/ll-sim\/exam\?mode=mock&state=JK/);
    await page.getByTestId("stage-start").click();
    const counter = page.getByTestId("exam-counter");
    for (let i = 1; i <= 10; i++) {
      await expect(counter).toHaveText(`Question ${i} of 10`);
      await page.getByTestId("ll-exam").getByRole("radio").first().check();
      await page.getByTestId("exam-next").click();
    }
    await expect(page.getByTestId("results-reveal")).toBeVisible();
    await expect(page.getByTestId("reveal-score")).toContainText("10");
    const rec = await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem("md.learn.llsim.v1") ?? "[]") as {
        total: number;
        pass: number;
        state: string;
      }[];
      return all.at(-1) ?? null;
    });
    expect(rec).toMatchObject({ total: 10, pass: 6, state: "JK" });
    await page.getByTestId("reveal-debrief").click();
    await expect(page.getByTestId("ll-result-score")).toHaveText(/^\d+ \/ 10$/);
    await expect(page.getByTestId("ll-result")).toContainText(/Pass mark:? 6/);
  });

  test("EC-10 Kerala shows the RTO path and the unconfirmed practice format", async ({ page }) => {
    await page.goto("/en/learn/practise/ll-sim?state=KL");
    await expect(page.getByTestId("ll-rto")).toContainText(
      "In Kerala the LL test is taken at the RTO.",
    );
    await expect(page.getByTestId("ll-format-line")).toHaveText(
      "Format not confirmed for Kerala. Using 15 questions, 9 to pass, as a practice format.",
    );
  });
});

test.describe("review session (MD-211)", () => {
  test("an offline review syncs once", async ({ page, context }) => {
    await page.goto("/en/learn/review");
    await expect(page.getByTestId("question-card")).toBeVisible();
    await context.setOffline(true);
    for (let i = 0; i < 30; i++) {
      const card = page.getByTestId("question-card");
      if (!(await card.isVisible())) break;
      const item = await card.getAttribute("data-item");
      await card.getByRole("radio").first().check();
      await page.getByLabel("Fairly · 75%").check();
      await page.getByRole("button", { name: "Check" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      // Wait for the next card or the end screen (finishing a sitting is async).
      const done = page.getByTestId("review-done");
      await expect(
        done.or(page.locator(`[data-testid="question-card"]:not([data-item="${item}"])`)),
      ).toBeVisible();
      if (await done.isVisible()) break;
    }
    await expect(page.getByTestId("review-done")).toBeVisible();
    const sync = page.getByTestId("sync-state");
    await expect(sync).toHaveText("Saved on this phone, will sync");
    const answered = await page.evaluate(async () => (await window.__mdLearn?.outbox()) ?? -1);
    expect(answered).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__mdLearn?.server().answers)).toBe(0);

    // Back online the outbox posts by itself (the shell no longer reloads on "online"). The mock
    // server's record lives on this phone, and it must hold every answer exactly once.
    await context.setOffline(false);
    await expect
      .poll(async () => (await safeEval(page, () => window.__mdLearn?.server() ?? null))?.answers, {
        timeout: 15_000,
      })
      .toBe(answered);
    await expect
      .poll(() => safeEval(page, async () => (await window.__mdLearn?.outbox()) ?? -1))
      .toBe(0);
    const after = await safeEval(page, () => window.__mdLearn?.server() ?? null);
    expect(after?.answers).toBe(answered);
    expect(after?.batches).toBeGreaterThanOrEqual(1);
    // The summary survives reconnecting (no reload wipes it).
    await expect(page.getByTestId("review-done")).toBeVisible();

    // A second "online" and a reload (which re-runs the outbox on mount) never count the same
    // answers again.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.reload();
    await expect(page.getByRole("heading", { name: "All caught up." })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => window.__mdLearn?.server())).toEqual(after);
  });
});

declare global {
  interface Window {
    __mdLearn?: {
      server: () => { answers: number; batches: number };
      outbox: () => Promise<number>;
    };
  }
}

test.describe("learn accessibility @a11y", () => {
  test("axe: learn hub @a11y", async ({ page }) => {
    await page.goto("/en/learn");
    await expect(page.getByTestId("hub-queue").or(page.getByText("All caught up."))).toBeVisible();
    await expect(page.getByTestId("node-SK-LL1")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("axe: review card @a11y", async ({ page }) => {
    await page.goto("/en/learn/review");
    await expect(page.getByTestId("question-card")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("axe: readiness @a11y", async ({ page }) => {
    await page.goto("/en/learn/readiness");
    await expect(page.getByTestId("readiness-eq")).toBeVisible();
    await expect(page.getByTestId("book-anyway")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("axe: LL exam @a11y", async ({ page }) => {
    await page.goto("/en/learn/practise/ll-sim/exam?mode=mock&state=JK");
    await page.getByTestId("stage-start").click();
    await expect(page.getByTestId("exam-counter")).toHaveText("Question 1 of 10");
    expect(await axe(page)).toEqual([]);
  });

  test("hi: the hub and readiness render in Hindi with the footer @a11y", async ({
    page,
    context,
    baseURL,
  }) => {
    await onboard(context, baseURL ?? "", "hi");
    await page.goto("/hi/learn/readiness");
    await expect(page.getByRole("heading", { name: "टेस्ट की तैयारी" })).toBeVisible();
    await expect(page.getByTestId("book-anyway")).toBeVisible();
    await expect(page.getByTestId("non-affiliation-footer")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});
