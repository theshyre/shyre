import { test, expect } from "@playwright/test";

test("clients page loads with header", async ({ page }) => {
  await page.goto("/clients");
  await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible();
});

test("add client button is present", async ({ page }) => {
  await page.goto("/clients");
  await expect(
    page.getByRole("button", { name: /add client/i }),
  ).toBeVisible();
});
