import { test, expect } from "@playwright/test";

test("customers page loads with header", async ({ page }) => {
  await page.goto("/customers");
  // Exact match — the /customers/i regex also hits the "No customers yet"
  // empty-state heading (strict-mode violation on a fresh fixture user).
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
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
