import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

/**
 * Public sign-off flow (SAL-036/045/046) — the one surface an anonymous
 * visitor can mutate the database through, and until now the only critical
 * flow with zero E2E coverage.
 *
 * Covers:
 *   1. Gate confidentiality — garbage and valid-shaped-but-unknown tokens
 *      both land on the link-problem page with no proposal content.
 *   2. Happy path (seeded via the service-role client, same as global-setup):
 *      identity gate shows masked email + no pricing → enter the one-time
 *      code → document renders → forwarded link in a SECOND context is still
 *      gated → select a subset → typed signature → accept → decided banner +
 *      DB acceptance record.
 *   3. Forwarded link after the decision — a fresh browser context (no
 *      view-session cookie) stays at the identity gate, no content.
 *
 * Seeding notes:
 *   - Rows are created directly with the service-role client (the same
 *     mechanism global-setup uses for the fixture user). The seeded team uses
 *     an `itest-` slug so global-teardown's team sweep is a safety net.
 *   - The one-time code is seeded as a KNOWN hash (`hashOtp(tokenId, code)`)
 *     rather than requested through the UI: `issueSignOtp` emails the code
 *     via the team's messaging config (none exists for a seeded team, so the
 *     request would fail with `email_failed`) and only the sha256 ever
 *     reaches the database, so a UI-requested code is unrecoverable by
 *     design. Seeding the hash exercises everything from "code in hand"
 *     onward: verify (atomic attempt RPC), view-session cookie mint, bundle
 *     render, decision recording.
 *   - `hashOtp` / `sha256Hex` are re-implemented inline because
 *     `src/lib/proposals/tokens.ts` is `server-only` and cannot be imported
 *     into a Playwright worker. The hash recipe (`sha256(tokenId + ":" +
 *     code)`) is pinned by `tokens.test.ts`; if it ever changes, this spec
 *     fails loudly at the verify step.
 */

/**
 * Dedicated author user for this spec — NOT the shared fixture user.
 * `proposals.user_id` is ON DELETE RESTRICT, so a leftover sent proposal
 * would block its author's deletion; scoping authorship to this user keeps a
 * crashed run from ever poisoning global-setup's fixture-user recreate. The
 * `itest-…@stint-test.local` shape keeps it inside the standard sweeps.
 */
const AUTHOR_EMAIL = "itest-sign-author@stint-test.local";
const SIGNER_EMAIL = "itest-signer@stint-test.local";
// maskEmail() shows the first two code points of the local part.
const SIGNER_EMAIL_MASKED = "it•••@stint-test.local";
const KNOWN_OTP = "123456";

const PROPOSAL_TITLE = "Itest Website Overhaul";
const ITEM_1_TITLE = "Discovery & UX audit";
const ITEM_2_TITLE = "Design system build-out";
const ITEM_1_PRICE = 1234.56;
const ITEM_2_PRICE = 890.12;
// formatCurrency(…, "USD") → "$1,234.56" / "$890.12" / "$2,124.68".
const ITEM_1_PRICE_TEXT = "1,234.56";
const ITEM_2_PRICE_TEXT = "890.12";

const ALLOWED_HOSTS = ["onbdbngemtbrnstjnbns.supabase.co"];

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Mirrors tokens.ts `hashOtp` — binds the code to its token row. */
function hashOtp(tokenId: string, code: string): string {
  return sha256Hex(`${tokenId}:${code}`);
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(`Refusing to run e2e tests against ${host}`);
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Seeded ids, populated in beforeAll and torn down in afterAll. */
const seeded = {
  businessId: "",
  teamId: "",
  customerId: "",
  proposalId: "",
  item1Id: "",
  item2Id: "",
  tokenId: "",
  /** The raw sign token — exists only in the emailed URL in production. */
  rawToken: "",
};

async function insertRow(
  admin: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from(table)
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to seed ${table}: ${error?.message}`);
  }
  return data.id as string;
}

/** Assert the page carries NO proposal content — the confidentiality bar for
 *  every unverified render (link-problem page and identity gate alike). */
async function expectNoProposalContent(page: Page): Promise<void> {
  const body = await page.content();
  expect(body).not.toContain(PROPOSAL_TITLE);
  expect(body).not.toContain(ITEM_1_TITLE);
  expect(body).not.toContain(ITEM_2_TITLE);
  expect(body).not.toContain(ITEM_1_PRICE_TEXT);
  expect(body).not.toContain(ITEM_2_PRICE_TEXT);
}

// The signer is an anonymous external visitor — no dashboard session. Drop
// the fixture user's stored auth state so every page here is a fresh browser.
test.use({ storageState: { cookies: [], origins: [] } });

/** Self-healing sweep: unwind any rows a previous crashed run left behind.
 *  Sent proposals must flip back to draft before the audit guard lets a
 *  cascade delete through — this is exactly why leftovers can't be left to
 *  global-teardown's plain team sweep. */
async function sweepStaleSignFlowData(admin: SupabaseClient): Promise<void> {
  const { data: staleTeams } = await admin
    .from("teams")
    .select("id, business_id")
    .like("slug", "itest-sign-flow-%");
  const teamIds = (staleTeams ?? []).map((t) => t.id as string);
  const businessIds = (staleTeams ?? [])
    .map((t) => t.business_id as string | null)
    .filter((id): id is string => id !== null);
  if (teamIds.length > 0) {
    await admin
      .from("proposals")
      .update({ status: "draft" })
      .in("team_id", teamIds);
    await admin.from("proposals").delete().in("team_id", teamIds);
    await admin.from("customers").delete().in("team_id", teamIds);
    await admin.from("teams").delete().in("id", teamIds);
    await admin.from("businesses").delete().in("id", businessIds);
  }
}

/** Create the dedicated author, reusing a leftover from a crashed run. */
async function ensureAuthorUser(admin: SupabaseClient): Promise<string> {
  const { data: created } = await admin.auth.admin.createUser({
    email: AUTHOR_EMAIL,
    password: `e2e-${randomUUID()}`,
    email_confirm: true,
  });
  if (created?.user) return created.user.id;
  const { data: users, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const existing = (users?.users ?? []).find((u) => u.email === AUTHOR_EMAIL);
  if (!existing) {
    throw new Error(`Could not create or find author user ${AUTHOR_EMAIL}`);
  }
  return existing.id;
}

test.describe("public sign flow", () => {
  test.beforeAll(async () => {
    const admin = adminClient();

    await sweepStaleSignFlowData(admin);
    const authorId = await ensureAuthorUser(admin);

    // Own team (itest- slug → global-teardown sweeps it as a safety net)
    // instead of the fixture user's personal team, so this spec's commercial
    // rows never bleed into the dashboard specs.
    // Teams belong to a business (teams.business_id NOT NULL, RESTRICT).
    seeded.businessId = await insertRow(admin, "businesses", {
      name: "Itest Sign Flow Business",
    });
    seeded.teamId = await insertRow(admin, "teams", {
      name: "Itest Sign Flow Co",
      slug: `itest-sign-flow-${randomUUID().slice(0, 8)}`,
      is_personal: false,
      business_id: seeded.businessId,
    });
    await admin.from("team_members").insert({
      team_id: seeded.teamId,
      user_id: authorId,
      role: "owner",
    });
    await admin.from("team_settings").insert({
      team_id: seeded.teamId,
      business_name: "Itest Sign Flow Co",
    });

    seeded.customerId = await insertRow(admin, "customers", {
      team_id: seeded.teamId,
      user_id: authorId,
      name: "Itest Customer GmbH",
    });

    // Inserted directly as 'sent' (the send-lock guards only fire on
    // UPDATE/DELETE) with a future valid_until so acceptance is allowed.
    const validUntil = new Date(Date.now() + 60 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    seeded.proposalId = await insertRow(admin, "proposals", {
      team_id: seeded.teamId,
      user_id: authorId,
      customer_id: seeded.customerId,
      proposal_number: "ITEST-SIGN-1",
      title: PROPOSAL_TITLE,
      status: "sent",
      valid_until: validUntil,
      currency: "USD",
    });

    seeded.item1Id = await insertRow(admin, "proposal_line_items", {
      proposal_id: seeded.proposalId,
      team_id: seeded.teamId,
      sort_order: 0,
      title: ITEM_1_TITLE,
      fixed_price: ITEM_1_PRICE,
    });
    seeded.item2Id = await insertRow(admin, "proposal_line_items", {
      proposal_id: seeded.proposalId,
      team_id: seeded.teamId,
      sort_order: 1,
      title: ITEM_2_TITLE,
      fixed_price: ITEM_2_PRICE,
    });

    // Token row with a KNOWN id so the OTP hash can be bound to it up front
    // (see the seeding notes in the header comment). otp_expires_at uses the
    // production TTL (10 min) — the whole spec runs well inside it.
    seeded.tokenId = randomUUID();
    seeded.rawToken = randomBytes(32).toString("base64url");
    const { error: tokenError } = await admin
      .from("proposal_access_tokens")
      .insert({
        id: seeded.tokenId,
        proposal_id: seeded.proposalId,
        team_id: seeded.teamId,
        token_hash: sha256Hex(seeded.rawToken),
        signer_email: SIGNER_EMAIL,
        signer_name: "Iris Tester",
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        otp_code_hash: hashOtp(seeded.tokenId, KNOWN_OTP),
        otp_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        otp_attempts: 0,
      });
    if (tokenError) {
      throw new Error(
        `Failed to seed proposal_access_tokens: ${tokenError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    const admin = adminClient();
    if (seeded.proposalId) {
      // A non-draft proposal cannot be deleted (send-lock audit guard), so
      // unlock it first, then delete in FK order: proposal (cascades line
      // items / token / events / acceptances) → customer (RESTRICT from
      // proposals until they're gone) → team (cascades settings + members).
      await admin
        .from("proposals")
        .update({ status: "draft" })
        .eq("id", seeded.proposalId);
      await admin.from("proposals").delete().eq("id", seeded.proposalId);
      await admin.from("customers").delete().eq("id", seeded.customerId);
      await admin.from("teams").delete().eq("id", seeded.teamId);
      await admin.from("businesses").delete().eq("id", seeded.businessId);
    }
    // With its proposals gone the RESTRICT FK no longer holds the author.
    // (Leaves the trigger-created personal org behind, same as the fixture
    // user's — global-setup's recreate cycle already accepts that.)
    const { data: users } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const author = (users?.users ?? []).find((u) => u.email === AUTHOR_EMAIL);
    if (author) await admin.auth.admin.deleteUser(author.id);
  });

  test("garbage token shows the link-problem page with no content", async ({
    page,
  }) => {
    await page.goto("/sign/garbage-token-123");
    await expect(
      page.getByRole("heading", { name: /this link isn't available/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/this sign-off link is invalid/i),
    ).toBeVisible();
    await expectNoProposalContent(page);
  });

  test("valid-shaped but unknown token shows the link-problem page with no content", async ({
    page,
  }) => {
    // Same shape as a real token (32 random bytes, base64url) — but no row.
    const unknownToken = randomBytes(32).toString("base64url");
    await page.goto(`/sign/${unknownToken}`);
    await expect(
      page.getByRole("heading", { name: /this link isn't available/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/this sign-off link is invalid/i),
    ).toBeVisible();
    await expectNoProposalContent(page);
  });

  test("happy path: gate → verify code → forwarded link stays gated → sign subset → decided", async ({
    page,
    browser,
  }) => {
    // Multi-step flow with two server-action round-trips plus a second
    // browser context — give it headroom over the default 30s.
    test.setTimeout(90_000);

    // --- Identity gate: masked recipient, zero proposal content ---
    await page.goto(`/sign/${seeded.rawToken}`);
    await expect(
      page.getByRole("heading", { name: /verify it's you/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SIGNER_EMAIL_MASKED)).toBeVisible();
    await expectNoProposalContent(page);
    // The unmasked recipient must not appear anywhere in the DOM either.
    expect(await page.content()).not.toContain(SIGNER_EMAIL);

    // --- Verify: the seeded outstanding code pre-opens the code field ---
    await page.locator("#gate-otp").fill(KNOWN_OTP);
    await page.getByRole("button", { name: /^verify$/i }).click();

    // Verify sets the httpOnly view-session cookie and refreshes into the
    // full document.
    await expect(
      page.getByRole("heading", { name: PROPOSAL_TITLE }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`$${ITEM_1_PRICE_TEXT}`).first()).toBeVisible();

    // --- Forwarded link: same URL, second context (no cookie) → gated ---
    const forwarded = await browser.newContext();
    try {
      const forwardedPage = await forwarded.newPage();
      await forwardedPage.goto(`/sign/${seeded.rawToken}`);
      await expect(
        forwardedPage.getByRole("heading", { name: /verify it's you/i }),
      ).toBeVisible({ timeout: 15_000 });
      await expectNoProposalContent(forwardedPage);
    } finally {
      await forwarded.close();
    }

    // --- Select a subset: keep item 1, drop item 2 ---
    await page.locator(`#sign-item-${seeded.item2Id}`).uncheck();
    await expect(
      page.getByText(`You are authorizing 1 item totaling $${ITEM_1_PRICE_TEXT}.`),
    ).toBeVisible();

    // --- Sign ---
    await page.locator("#sign-name").fill("Iris Tester");
    await page.locator("#sign-title").fill("COO");
    await page.locator("#sign-signature").fill("Iris Tester");
    await page.getByRole("button", { name: /^accept/i }).click();

    // --- Decided banner (refresh-driven terminal state) ---
    await expect(
      page.getByText(
        `This proposal was accepted — total $${ITEM_1_PRICE_TEXT}.`,
      ),
    ).toBeVisible({ timeout: 15_000 });

    // --- The mutation actually landed: acceptance record + status flip ---
    const admin = adminClient();
    const { data: acceptance } = await admin
      .from("proposal_acceptances")
      .select(
        "decision, signer_name, signer_email, signature_typed, selected_line_item_ids, accepted_total, otp_verified_at",
      )
      .eq("proposal_id", seeded.proposalId)
      .single();
    expect(acceptance).not.toBeNull();
    expect(acceptance?.decision).toBe("accepted");
    expect(acceptance?.signer_name).toBe("Iris Tester");
    expect(acceptance?.signer_email).toBe(SIGNER_EMAIL);
    expect(acceptance?.signature_typed).toBe("Iris Tester");
    expect(acceptance?.selected_line_item_ids).toEqual([seeded.item1Id]);
    expect(Number(acceptance?.accepted_total)).toBe(ITEM_1_PRICE);
    expect(acceptance?.otp_verified_at).not.toBeNull();

    const { data: proposal } = await admin
      .from("proposals")
      .select("status, accepted_total")
      .eq("id", seeded.proposalId)
      .single();
    expect(proposal?.status).toBe("accepted");
    expect(Number(proposal?.accepted_total)).toBe(ITEM_1_PRICE);

    const { data: token } = await admin
      .from("proposal_access_tokens")
      .select("consumed_at, first_viewed_at")
      .eq("id", seeded.tokenId)
      .single();
    expect(token?.consumed_at).not.toBeNull();
    expect(token?.first_viewed_at).not.toBeNull();
  });

  test("forwarded link after the decision is still gated with no content", async ({
    page,
  }) => {
    // Decided links stay re-viewable via re-verification (2026-07-18
    // decision) — but a browser without the view-session cookie must still
    // see only the identity gate, never the signed document.
    await page.goto(`/sign/${seeded.rawToken}`);
    await expect(
      page.getByRole("heading", { name: /verify it's you/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoProposalContent(page);
  });
});
