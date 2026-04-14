import { test, expect } from "@playwright/test";

test("settings page loads", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
});

test("timer page loads", async ({ page }) => {
  await page.goto("/timer");
  await expect(page.getByRole("heading", { name: /timer/i })).toBeVisible();
});
