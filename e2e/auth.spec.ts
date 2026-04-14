import { test, expect } from "@playwright/test";

test("authenticated user lands on dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /dashboard/i }),
  ).toBeVisible();
});

test("sidebar nav items are visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /timer/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /clients/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /projects/i }).first()).toBeVisible();
});
