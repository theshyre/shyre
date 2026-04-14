import { test, expect } from "@playwright/test";

test("security groups page loads", async ({ page }) => {
  await page.goto("/settings/security-groups");
  await expect(
    page.getByRole("heading", { name: /security groups/i }),
  ).toBeVisible();
});
