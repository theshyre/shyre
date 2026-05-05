import { test, expect } from "@playwright/test";

/**
 * Route smoke test — hits every static dashboard route as the
 * authenticated fixture user (auth state is loaded by the
 * Playwright config from `e2e/.auth/user.json`, written by
 * `global-setup.ts`).
 *
 * Defends against the bug class that crashed `/projects` in
 * batch 7: server-side closures passed across the server/client
 * boundary surface ONLY at request time, not at `next build`.
 * `npm run ci:local` won't catch them; this will.
 *
 * Each route assertion:
 *   1. Response status is 2xx (a 500 = unhandled render exception).
 *   2. Page body does NOT contain Next.js's generic
 *      "Application error" / "An error occurred in the Server
 *      Components" text — those appear when render throws but the
 *      route still serves a 200 (rare, but possible).
 *   3. The expected sidebar landmark is present, proving the
 *      dashboard layout rendered (auth context + sidebar + main
 *      content area all reached).
 *
 * Dynamic-`[id]` routes (`/customers/[id]`, `/invoices/[id]`,
 * `/teams/[id]`, `/business/[businessId]`, `/projects/[id]`,
 * `/projects/[id]`) are NOT covered — they need fixture data the
 * global setup doesn't seed today. Those should ship in a
 * follow-up that creates one each of customer, project, invoice,
 * business, etc. for the fixture user. The static routes catch
 * the cross-boundary bug class regardless.
 */

const STATIC_ROUTES = [
  "/",
  "/customers",
  "/projects",
  "/invoices",
  "/invoices/new",
  "/time-entries",
  "/time-entries/trash",
  "/reports",
  "/categories",
  "/templates",
  "/import",
  "/security-groups",
  "/profile",
  "/settings",
  "/teams",
  "/business",
  "/business/info",
  "/docs",
] as const;

for (const route of STATIC_ROUTES) {
  test(`smoke: ${route} renders without server error`, async ({ page }) => {
    const response = await page.goto(route);

    expect(response, `no response for ${route}`).not.toBeNull();
    expect(
      response!.status(),
      `${route} returned ${response!.status()}`,
    ).toBeLessThan(400);

    // Generic Next.js render-error pages serve 200 with a body
    // that includes one of these strings. Catch them explicitly
    // — `expect(toBeLessThan(400))` alone wouldn't.
    const body = await page.content();
    expect(body).not.toContain("Application error");
    expect(
      body,
      `${route} contains "An error occurred in the Server Components render"`,
    ).not.toContain("An error occurred in the Server Components render");

    // Sidebar landmark proves the dashboard layout reached the
    // browser. If a route re-renders to /login (auth fail) or to
    // a system-locked screen, the sidebar's nav landmarks won't
    // be there and we fail fast.
    await expect(
      page.locator("aside#primary-sidebar"),
      `${route}: sidebar landmark not found`,
    ).toBeVisible({ timeout: 10_000 });
  });
}
