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

test("view toggle switches to day view and sets ?view=day", async ({ page }) => {
  await page.goto("/time-entries");
  await page.getByRole("button", { name: /^day/i }).click();
  await expect(page).toHaveURL(/view=day/);
});

test("view toggle back to week clears ?view param", async ({ page }) => {
  await page.goto("/time-entries?view=day");
  await page.getByRole("button", { name: /^week/i }).click();
  await expect(page).not.toHaveURL(/view=day/);
});

test("billable filter toggles ?billable=1 in URL", async ({ page }) => {
  await page.goto("/time-entries");
  await page.getByRole("button", { name: /all entries/i }).click();
  await expect(page).toHaveURL(/billable=1/);
});
