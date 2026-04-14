import { test, expect } from "@playwright/test";

test("organizations page loads", async ({ page }) => {
  await page.goto("/organizations");
  await expect(
    page.getByRole("heading", { name: /organizations/i }),
  ).toBeVisible();
});

test("create organization button is present", async ({ page }) => {
  await page.goto("/organizations");
  await expect(
    page.getByRole("button", { name: /create organization/i }),
  ).toBeVisible();
});
