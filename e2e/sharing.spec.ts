import { test, expect } from "@playwright/test";

test("/settings redirects to /profile", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/profile/);
  await expect(
    page.getByRole("heading", { name: /your profile/i }),
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
