import { test, expect } from "@playwright/test";

test("time home page loads with week grid", async ({ page }) => {
  await page.goto("/time-entries");
  await expect(page.getByRole("heading", { name: /time/i })).toBeVisible();
  // Week totals strip renders
  await expect(page.getByText(/billable/i).first()).toBeVisible();
});

test("timer redirect sends to time-entries", async ({ page }) => {
  await page.goto("/timer");
  await expect(page).toHaveURL(/\/time-entries/);
});

test("interval nav updates URL when next is clicked", async ({ page }) => {
  await page.goto("/time-entries");
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page).toHaveURL(/anchor=\d{4}-\d{2}-\d{2}/);
});

test("switching interval kind to month persists in URL", async ({ page }) => {
  await page.goto("/time-entries");
  await page.getByRole("button", { name: /choose interval/i }).click();
  await page.getByRole("menuitemradio", { name: /month/i }).click();
  await expect(page).toHaveURL(/interval=month/);
});

test("grouping toggle sets groupBy param", async ({ page }) => {
  await page.goto("/time-entries");
  // Open group-by picker via its label prefix
  await page.getByRole("button", { name: /group by/i }).click();
  await page.getByRole("menuitemradio", { name: /project/i }).click();
  await expect(page).toHaveURL(/groupBy=project/);
});
