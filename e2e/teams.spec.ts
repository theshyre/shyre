import { test, expect } from "@playwright/test";

test("teams page loads", async ({ page }) => {
  await page.goto("/teams");
  await expect(
    page.getByRole("heading", { name: /teams/i }),
  ).toBeVisible();
});

test("create team button is present", async ({ page }) => {
  await page.goto("/teams");
  await expect(
    page.getByRole("button", { name: /create team/i }),
  ).toBeVisible();
});
