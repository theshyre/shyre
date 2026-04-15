import { test, expect } from "@playwright/test";

test("customers page loads with header", async ({ page }) => {
  await page.goto("/customers");
  await expect(
    page.getByRole("heading", { name: /customers/i }),
  ).toBeVisible();
});

test("add customer button is present", async ({ page }) => {
  await page.goto("/customers");
  await expect(
    page.getByRole("button", { name: /add customer/i }),
  ).toBeVisible();
});

test("legacy /clients redirects to /customers", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/customers/);
});
