import { test, expect } from "@playwright/test";

test("/settings renders the settings hub", async ({ page }) => {
  // /settings stopped redirecting to /profile when it became the settings
  // hub (four-persona IA review) — assert the hub's own heading instead.
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("profile page loads directly", async ({ page }) => {
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: /your profile/i }),
  ).toBeVisible();
});

test("timer page redirects to time-entries", async ({ page }) => {
  await page.goto("/timer");
  await expect(page).toHaveURL(/\/time-entries/);
});
