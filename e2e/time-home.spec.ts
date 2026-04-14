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

test("week nav updates URL", async ({ page }) => {
  await page.goto("/time-entries");
  await page.getByRole("button", { name: /next/i }).click();
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
});
