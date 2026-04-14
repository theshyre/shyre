import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const E2E_EMAIL = "itest-e2e-fixture@stint-test.local";
const E2E_PASSWORD = "e2e-fixed-password-for-testing-only";
const AUTH_FILE = "e2e/.auth/user.json";

const ALLOWED_HOSTS = ["onbdbngemtbrnstjnbns.supabase.co"];

async function globalSetup(config: FullConfig): Promise<void> {
  void config;

  // Validate env
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(`Refusing to run e2e tests against ${host}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Clean up any stragglers first
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    if (u.email?.includes("itest-") && u.email?.endsWith("@stint-test.local")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  // Create the e2e fixture user
  const { data: createData, error: createErr } =
    await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
    });
  if (createErr || !createData.user) {
    throw new Error(`Failed to create e2e user: ${createErr?.message}`);
  }

  // Sign in via Playwright and save auth state
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("http://localhost:3000/login");
  await page.fill('input[type="email"]', E2E_EMAIL);
  await page.fill('input[type="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });

  // Ensure auth directory exists
  await fs.mkdir("e2e/.auth", { recursive: true });
  await context.storageState({ path: AUTH_FILE });

  await browser.close();
}

export default globalSetup;
