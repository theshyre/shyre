"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { isSystemAdmin } from "@/lib/system-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  generateSampleData,
  type SampleData,
} from "@/lib/sample-data/generate";
import {
  calculateLineItemAmount,
  calculateInvoiceTotals,
  generateInvoiceNumber,
  minutesToHours,
} from "@/lib/invoice-utils";

type SBClient = import("@supabase/supabase-js").SupabaseClient;

async function requireAdminOfTeam(
  supabase: SBClient,
  teamId: string,
): Promise<{ userId: string; teamName: string }> {
  if (!(await isSystemAdmin())) {
    throw new Error("System admin access required.");
  }
  const { userId, role } = await validateTeamAccess(teamId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners or admins of the target org can run this tool.");
  }
  const { data: teamRow } = await supabase
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();
  if (!teamRow) throw new Error("Team not found.");
  return { userId, teamName: teamRow.name as string };
}

function asTeamId(formData: FormData): string {
  const v = formData.get("team_id");
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("team_id is required.");
  }
  return v;
}

const SAMPLE_USER_DOMAIN = "shyre-sample.local";
const SAMPLE_USER_METADATA_KEY = "is_sample_user";

interface SampleUserMetadata {
  [SAMPLE_USER_METADATA_KEY]: true;
  sample_team_id: string;
  display_name: string;
}

// ────────────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────────────

async function deleteSampleRowsInOrg(
  supabase: SBClient,
  teamId: string,
): Promise<void> {
  // Invoice line items cascade when the invoice is deleted.
  assertSupabaseOk(
    await supabase
      .from("invoices")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("expenses")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("time_entries")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  // Team-scoped sample category sets. Project-scoped sets cascade when
  // their parent project is dropped below.
  assertSupabaseOk(
    await supabase
      .from("category_sets")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("projects")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );
  assertSupabaseOk(
    await supabase
      .from("customers")
      .delete()
      .eq("team_id", teamId)
      .eq("is_sample", true),
  );

  await deleteSampleUsersForTeam(teamId);
}

async function deleteSampleUsersForTeam(teamId: string): Promise<void> {
  const admin = createAdminClient();
  let page = 1;
  const perPage = 200;
  const toDelete: string[] = [];
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      if (
        meta[SAMPLE_USER_METADATA_KEY] === true &&
        meta["sample_team_id"] === teamId
      ) {
        toDelete.push(u.id);
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  for (const id of toDelete) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) {
      throw new Error(`deleteUser(${id}) failed: ${error.message}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────────

interface SampleUserResult {
  memberIdx: number;
  userId: string;
  membershipId: string;
}

async function createSampleUsers(
  admin: SBClient,
  teamId: string,
  data: SampleData,
): Promise<SampleUserResult[]> {
  const teamSuffix = teamId.slice(0, 8);
  const results: SampleUserResult[] = [];

  for (let i = 0; i < data.teamMembers.length; i++) {
    const m = data.teamMembers[i]!;
    const email = `sample+${m.slug}-${teamSuffix}@${SAMPLE_USER_DOMAIN}`;
    const metadata: SampleUserMetadata = {
      [SAMPLE_USER_METADATA_KEY]: true,
      sample_team_id: teamId,
      display_name: m.displayName,
    };
    const { data: createRes, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: metadata,
      });
    if (createErr) {
      throw new Error(`createUser(${email}) failed: ${createErr.message}`);
    }
    const userId = createRes.user!.id;

    await admin
      .from("user_profiles")
      .update({ display_name: m.displayName })
      .eq("user_id", userId);

    const insertMembership = await admin
      .from("team_members")
      .insert({
        team_id: teamId,
        user_id: userId,
        role: m.role,
        default_rate: m.default_rate,
        rate_visibility: m.rate_visibility,
        rate_editability: m.rate_editability,
      })
      .select("id")
      .single();
    assertSupabaseOk(insertMembership);

    results.push({
      memberIdx: i,
      userId,
      membershipId: insertMembership.data!.id as string,
    });
  }

  return results;
}

async function loadSample(
  supabase: SBClient,
  admin: SBClient,
  userId: string,
  teamId: string,
): Promise<void> {
  await deleteSampleRowsInOrg(supabase, teamId);

  const data = generateSampleData({ now: new Date() });

  // 1. Team settings (visibility / editability / delegation).
  assertSupabaseOk(
    await supabase.from("team_settings").upsert({
      team_id: teamId,
      rate_visibility: data.teamSettings.rate_visibility,
      rate_editability: data.teamSettings.rate_editability,
      time_entries_visibility: data.teamSettings.time_entries_visibility,
      admins_can_set_rate_permissions:
        data.teamSettings.admins_can_set_rate_permissions,
    }),
  );

  // 2. Sample auth users + team_members (admin bypass for RLS).
  const sampleUsers = await createSampleUsers(admin, teamId, data);
  const userIdByMemberIdx = new Map<number, string>(
    sampleUsers.map((r) => [r.memberIdx, r.userId]),
  );

  // 3. Customers.
  const customerInserts = data.customers.map((c) => ({
    user_id: userId,
    team_id: teamId,
    name: c.name,
    email: c.email,
    default_rate: c.default_rate,
    notes: c.notes,
    rate_visibility: c.rate_visibility,
    rate_editability: c.rate_editability,
    is_sample: true,
  }));
  const custRes = await supabase
    .from("customers")
    .insert(customerInserts)
    .select("id");
  assertSupabaseOk(custRes);
  const customerIds = (custRes.data ?? []).map((r) => r.id as string);
  if (customerIds.length !== data.customers.length) {
    throw new Error("Failed to insert all sample customers.");
  }

  // 4. Team-scoped category sets.
  const teamCategorySetInserts = data.categorySets
    .filter((s) => s.scope === "team")
    .map((s) => ({
      team_id: teamId,
      project_id: null,
      is_system: false,
      name: s.name,
      description: s.description,
      created_by: userId,
      is_sample: true,
    }));
  const setIdsByName = new Map<string, string>();
  if (teamCategorySetInserts.length > 0) {
    const res = await supabase
      .from("category_sets")
      .insert(teamCategorySetInserts)
      .select("id, name");
    assertSupabaseOk(res);
    for (const row of res.data ?? []) {
      setIdsByName.set(row.name as string, row.id as string);
    }
  }

  // 5. Projects.
  const projectInserts = data.projects.map((p) => ({
    user_id: userId,
    team_id: teamId,
    customer_id:
      p.customerIndex === null ? null : customerIds[p.customerIndex],
    name: p.name,
    description: p.description,
    hourly_rate: p.hourly_rate,
    github_repo: p.github_repo,
    status: p.status,
    rate_visibility: p.rate_visibility,
    rate_editability: p.rate_editability,
    time_entries_visibility: p.time_entries_visibility,
    category_set_id:
      p.baseCategorySet === null
        ? null
        : setIdsByName.get(p.baseCategorySet) ?? null,
    is_sample: true,
  }));
  const projRes = await supabase
    .from("projects")
    .insert(projectInserts)
    .select("id, name");
  assertSupabaseOk(projRes);
  const projectIds = (projRes.data ?? []).map((r) => r.id as string);
  const projectIdByName = new Map<string, string>(
    (projRes.data ?? []).map((r) => [r.name as string, r.id as string]),
  );
  if (projectIds.length !== data.projects.length) {
    throw new Error("Failed to insert all sample projects.");
  }

  // 6. Project-scoped category sets (extensions).
  const projectCategorySetInserts = data.categorySets
    .filter((s) => s.scope === "project")
    .map((s) => {
      const projectId = projectIdByName.get(s.extendsProjectName as string);
      if (!projectId) {
        throw new Error(
          `Sample category-set extension references unknown project "${s.extendsProjectName}".`,
        );
      }
      return {
        team_id: null,
        project_id: projectId,
        is_system: false,
        name: s.name,
        description: s.description,
        created_by: userId,
        is_sample: true,
      };
    });
  if (projectCategorySetInserts.length > 0) {
    const res = await supabase
      .from("category_sets")
      .insert(projectCategorySetInserts)
      .select("id, name");
    assertSupabaseOk(res);
    for (const row of res.data ?? []) {
      setIdsByName.set(row.name as string, row.id as string);
    }
  }

  // 7. Categories.
  const categoryInserts = data.categories.map((c) => {
    const setId = setIdsByName.get(c.setName);
    if (!setId) {
      throw new Error(
        `Sample category "${c.name}" references unknown set "${c.setName}".`,
      );
    }
    return {
      category_set_id: setId,
      name: c.name,
      color: c.color,
      sort_order: c.sort_order,
      is_sample: true,
    };
  });
  const catIdsByKey = new Map<string, string>();
  if (categoryInserts.length > 0) {
    const res = await supabase
      .from("categories")
      .insert(categoryInserts)
      .select("id, category_set_id, name");
    assertSupabaseOk(res);
    for (const row of res.data ?? []) {
      const key = `${row.category_set_id as string}::${row.name as string}`;
      catIdsByKey.set(key, row.id as string);
    }
  }

  // 8. Time entries (admin bypasses RLS so entries can belong to any
  // sample user without requiring their own auth session).
  const entryInserts = data.entries.map((e) => {
    const entryUserId =
      e.memberIndex === null
        ? userId
        : userIdByMemberIdx.get(e.memberIndex) ?? userId;
    let categoryId: string | null = null;
    if (e.categoryRef) {
      const setId = setIdsByName.get(e.categoryRef.setName);
      if (setId) {
        categoryId =
          catIdsByKey.get(`${setId}::${e.categoryRef.categoryName}`) ?? null;
      }
    }
    return {
      user_id: entryUserId,
      team_id: teamId,
      project_id: projectIds[e.projectIndex]!,
      category_id: categoryId,
      description: e.description,
      start_time: e.startIso,
      end_time: e.endIso,
      billable: e.billable,
      github_issue: e.github_issue,
      is_sample: true,
    };
  });
  const CHUNK = 200;
  for (let i = 0; i < entryInserts.length; i += CHUNK) {
    assertSupabaseOk(
      await admin
        .from("time_entries")
        .insert(entryInserts.slice(i, i + CHUNK)),
    );
  }

  // 9. Invoices (draft + sent).
  const now = new Date();
  const { data: settingsRow } = await supabase
    .from("team_settings")
    .select("invoice_prefix, invoice_next_num")
    .eq("team_id", teamId)
    .single();
  const prefix = (settingsRow?.invoice_prefix as string | null) ?? "INV";
  let nextNum = (settingsRow?.invoice_next_num as number | null) ?? 1;

  for (const inv of data.invoices) {
    const customerId = customerIds[inv.customerIndex];
    if (!customerId) continue;

    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - inv.windowDays.from);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() - inv.windowDays.to);
    windowEnd.setHours(23, 59, 59, 999);

    const { data: windowEntries } = await admin
      .from("time_entries")
      .select(
        "id, duration_min, description, user_id, project_id, projects!inner(name, hourly_rate, customer_id, customers(default_rate))",
      )
      .eq("team_id", teamId)
      .eq("is_sample", true)
      .eq("billable", true)
      .eq("invoiced", false)
      .gte("start_time", windowStart.toISOString())
      .lte("end_time", windowEnd.toISOString());

    const entriesForCustomer = (windowEntries ?? []).filter((e) => {
      const p = e.projects as unknown as {
        customer_id: string | null;
      } | null;
      return p && p.customer_id === customerId;
    });

    if (entriesForCustomer.length === 0) continue;

    const lineItems = entriesForCustomer.map((e) => {
      const p = e.projects as unknown as {
        name: string;
        hourly_rate: number | null;
        customers: { default_rate: number | null } | null;
      };
      const hours = minutesToHours(
        (e.duration_min as number | null) ?? 0,
      );
      const rate =
        (p.hourly_rate ? Number(p.hourly_rate) : null) ??
        (p.customers?.default_rate
          ? Number(p.customers.default_rate)
          : null) ??
        0;
      const amount = calculateLineItemAmount(hours, rate);
      const desc = e.description
        ? `${p.name}: ${e.description as string}`
        : p.name;
      return {
        description: desc,
        quantity: hours,
        unitPrice: rate,
        amount,
        time_entry_id: e.id as string,
      };
    });

    const totals = calculateInvoiceTotals(lineItems, 0);
    const invoiceNumber = `${generateInvoiceNumber(prefix, nextNum)}-${inv.invoice_number_suffix}`;
    nextNum += 1;

    const issuedDate = new Date(windowEnd);
    const dueDate = inv.due_days
      ? new Date(issuedDate.getTime() + inv.due_days * 24 * 60 * 60 * 1000)
      : null;

    const invRes = await supabase
      .from("invoices")
      .insert({
        user_id: userId,
        team_id: teamId,
        customer_id: customerId,
        invoice_number: invoiceNumber,
        issued_date: issuedDate.toISOString().slice(0, 10),
        due_date: dueDate ? dueDate.toISOString().slice(0, 10) : null,
        status: inv.status,
        subtotal: totals.subtotal,
        tax_rate: 0,
        tax_amount: 0,
        total: totals.total,
        notes: inv.notes,
        is_sample: true,
      })
      .select("id")
      .single();
    assertSupabaseOk(invRes);
    const invoiceId = invRes.data!.id as string;

    const lineItemRows = lineItems.map((li) => ({
      invoice_id: invoiceId,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unitPrice,
      amount: li.amount,
      time_entry_id: li.time_entry_id,
      is_sample: true,
    }));
    for (let i = 0; i < lineItemRows.length; i += CHUNK) {
      assertSupabaseOk(
        await supabase
          .from("invoice_line_items")
          .insert(lineItemRows.slice(i, i + CHUNK)),
      );
    }

    const entryIds = lineItems.map((li) => li.time_entry_id);
    for (let i = 0; i < entryIds.length; i += CHUNK) {
      assertSupabaseOk(
        await admin
          .from("time_entries")
          .update({ invoiced: true, invoice_id: invoiceId })
          .in("id", entryIds.slice(i, i + CHUNK)),
      );
    }
  }

  if (nextNum > ((settingsRow?.invoice_next_num as number | null) ?? 1)) {
    await supabase
      .from("team_settings")
      .update({ invoice_next_num: nextNum })
      .eq("team_id", teamId);
  }

  // 10. Expenses.
  const expenseInserts = data.expenses.map((e) => ({
    user_id: userId,
    team_id: teamId,
    project_id:
      e.projectIndex === null ? null : projectIds[e.projectIndex]!,
    incurred_on: e.incurredOn,
    amount: e.amount,
    currency: e.currency,
    vendor: e.vendor,
    category: e.category,
    description: e.description,
    billable: e.billable,
    is_sample: true,
  }));
  for (let i = 0; i < expenseInserts.length; i += CHUNK) {
    assertSupabaseOk(
      await supabase
        .from("expenses")
        .insert(expenseInserts.slice(i, i + CHUNK)),
    );
  }
}

// ────────────────────────────────────────────────────────────────
// Public server actions
// ────────────────────────────────────────────────────────────────

export async function loadSampleDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = asTeamId(fd);
      await requireAdminOfTeam(supabase, teamId);
      const admin = createAdminClient();
      await loadSample(supabase, admin, userId, teamId);
      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
      revalidatePath(`/teams/${teamId}`);
      revalidatePath("/invoices");
    },
    "loadSampleDataAction",
  );
}

export async function removeSampleDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = asTeamId(fd);
      await requireAdminOfTeam(supabase, teamId);
      await deleteSampleRowsInOrg(supabase, teamId);
      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
      revalidatePath(`/teams/${teamId}`);
      revalidatePath("/invoices");
    },
    "removeSampleDataAction",
  );
}

export async function clearAllTeamDataAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = asTeamId(fd);
      const confirmName = String(fd.get("confirm_name") ?? "");
      const { teamName } = await requireAdminOfTeam(supabase, teamId);
      if (confirmName !== teamName) {
        throw new Error(
          `Typed confirmation did not match the team name "${teamName}".`,
        );
      }

      assertSupabaseOk(
        await supabase.from("invoices").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("expenses").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("time_entries").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("category_sets").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("projects").delete().eq("team_id", teamId),
      );
      assertSupabaseOk(
        await supabase.from("customers").delete().eq("team_id", teamId),
      );

      await deleteSampleUsersForTeam(teamId);

      revalidatePath("/admin/sample-data");
      revalidatePath("/time-entries");
      revalidatePath("/customers");
      revalidatePath("/projects");
      revalidatePath("/business");
      revalidatePath(`/teams/${teamId}`);
      revalidatePath("/invoices");
    },
    "clearAllTeamDataAction",
  );
}
