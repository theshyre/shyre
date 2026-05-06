import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateTeamAccess } from "@/lib/team-context";
import { logError } from "@/lib/logger";
import { materializeHarvestShellAccount } from "@/lib/import-shell-author";
import {
  validateHarvestCredentials,
  fetchHarvestClients,
  fetchHarvestProjects,
  fetchHarvestTimeEntries,
  fetchHarvestUsers,
  fetchHarvestInvoices,
  fetchHarvestInvoicePayments,
  fetchHarvestInvoiceMessages,
  HarvestApiError,
} from "@/lib/harvest";
import {
  buildCustomerRow,
  buildProjectRow,
  buildReconciliation,
  buildTimeEntryRow,
  buildInvoiceRow,
  buildInvoiceLineItemRow,
  buildInvoicePaymentRow,
  pickLatestSendRecipient,
  collectUniqueHarvestUsers,
  collectUniqueTaskNames,
  normalizeDateRange,
  proposeDefaultUserMapping,
  HARVEST_CATEGORY_SET_NAME,
  type ImportContext,
  type UserMapChoice,
} from "@/lib/harvest-import-logic";
import { NextResponse } from "next/server";

// Vercel default is 10s (hobby) / 60s (pro). A real-world Harvest
// account with a few thousand time entries routinely exceeds that —
// the API paginates 100 at a time and 429-throttles aggressively,
// so fetch alone can run 30-60s before any writes happen. Bumping
// to 5 minutes covers essentially every small-to-mid consulting
// practice. For accounts larger than that, the date-range filter
// (from / to in the UI) is the escape hatch — import a year at a
// time and each run fits comfortably under 5 min.
export const maxDuration = 300;

type SBClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Serialize a caught error into the JSON body returned to the client.
 * HarvestApiError carries a clean user-facing message and a capped
 * raw response body — we surface both so the UI's InlineErrorCard
 * can render the short message and stash the raw body behind a
 * "Copy details" toggle. Everything else becomes an unknown error.
 *
 * Also logs to error_logs via `logError` so admins see the failure
 * in /admin/errors — returning JSON with an error field isn't
 * sufficient on its own (the user's banner is the only other
 * surface and they often dismiss it).
 */
function errorResponse(
  err: unknown,
  context: { userId?: string; teamId?: string; action?: string },
): NextResponse {
  logError(err, { ...context, url: "/api/import/harvest" });

  if (err instanceof HarvestApiError) {
    return NextResponse.json(
      {
        error: err.message,
        errorCode: err.kind,
        status: err.status,
        endpoint: err.endpoint,
        detail: err.rawBody,
      },
      { status: 502 },
    );
  }
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "Import failed",
      errorCode: "unknown",
    },
    { status: 500 },
  );
}

interface ImportRequestBody {
  token: string;
  accountId: string;
  /** Target Shyre team id. Named `organizationId` for back-compat with
   * the previous API shape; internally treated as team_id. */
  organizationId: string;
  action: "validate" | "preview" | "import";
  /** Only used on action=import. Harvest user id → Shyre user id /
   * "importer" / "skip". */
  userMapping?: Record<string, UserMapChoice>;
  /** Only used on action=import. From the preview response. */
  timeZone?: string;
  /** Optional date range filter on time entries. Harvest accepts
   * from/to in YYYY-MM-DD. When set, only entries with `spent_date`
   * in the range are fetched — reduces import time on large accounts
   * and lets the user import one quarter / year at a time. */
  from?: string;
  to?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as ImportRequestBody;
  const { token, accountId, organizationId, action } = body;

  if (!token || !accountId || !organizationId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  // Role gate: owners and admins only. Previous route let any team
  // member trigger an import (SAL-009). Importing bulk-writes to
  // customers / projects / time_entries, which is an owner/admin-grade
  // action, not a member-grade one.
  let role: string;
  try {
    ({ role } = await validateTeamAccess(organizationId));
  } catch {
    return NextResponse.json(
      { error: "No access to this team" },
      { status: 403 },
    );
  }
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "Only team owners or admins can run imports." },
      { status: 403 },
    );
  }

  const opts = { token, accountId };

  if (action === "validate") {
    const result = await validateHarvestCredentials(opts);
    return NextResponse.json(result);
  }

  if (action === "preview") {
    try {
      const dateRange = normalizeDateRange(body.from, body.to);
      const [company, customers, projects, timeEntries, harvestUsers, invoices] =
        await Promise.all([
          validateHarvestCredentials(opts),
          fetchHarvestClients(opts),
          fetchHarvestProjects(opts),
          fetchHarvestTimeEntries(opts, dateRange),
          fetchHarvestUsers(opts),
          fetchHarvestInvoices(opts, dateRange),
        ]);

      if (!company.valid) {
        return NextResponse.json(
          { error: company.error ?? "Invalid credentials" },
          { status: 400 },
        );
      }

      // Suggest a default mapping by matching Harvest users to existing
      // Shyre team members and unlinked business people via email /
      // display_name. UI can override.
      const shyreMembers = await fetchTeamMembersForMapping(
        supabase,
        organizationId,
      );
      const businessPeople = await fetchBusinessPeopleForMapping(
        supabase,
        organizationId,
      );
      const callerDisplayName = await fetchCallerDisplayName(
        supabase,
        user.id,
      );
      const defaultMapping = proposeDefaultUserMapping(
        harvestUsers,
        shyreMembers,
        businessPeople,
      );
      const uniqueUsers = collectUniqueHarvestUsers(timeEntries);

      const invoiceLineItemCount = invoices.reduce(
        (sum, inv) => sum + (inv.line_items?.length ?? 0),
        0,
      );

      return NextResponse.json({
        companyName: company.companyName ?? "",
        timeZone: company.timeZone ?? "UTC",
        customers: customers.length,
        projects: projects.length,
        timeEntries: timeEntries.length,
        invoices: invoices.length,
        invoiceLineItems: invoiceLineItemCount,
        categoryCount: collectUniqueTaskNames(timeEntries).length,
        customerNames: customers.slice(0, 10).map((c) => c.name),
        projectNames: projects.slice(0, 10).map((p) => p.name),
        harvestUsers: harvestUsers.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim(),
          email: u.email,
          entryCount:
            uniqueUsers.find((x) => x.id === u.id)?.entryCount ?? 0,
        })),
        shyreMembers,
        businessPeople,
        callerDisplayName,
        callerUserId: user.id,
        defaultMapping,
      });
    } catch (err) {
      return errorResponse(err, {
        userId: user.id,
        teamId: organizationId,
        action: "harvestImportPreview",
      });
    }
  }

  if (action === "import") {
    const timeZone = body.timeZone ?? "UTC";
    const userMapping: Record<number, UserMapChoice> = {};
    for (const [k, v] of Object.entries(body.userMapping ?? {})) {
      userMapping[Number(k)] = v;
    }

    const ctx: ImportContext = {
      teamId: organizationId,
      importerUserId: user.id,
      importRunId: crypto.randomUUID(),
      importedAt: new Date().toISOString(),
    };

    // Record the run upfront so a mid-import failure still leaves a
    // trace (status=failed) for the user to see in the import
    // history — otherwise a crash would leave orphan rows stamped
    // with a run_id no parent row knows about.
    const { error: runInsertError } = await supabase
      .from("import_runs")
      .insert({
        id: ctx.importRunId,
        team_id: ctx.teamId,
        triggered_by_user_id: user.id,
        imported_from: "harvest",
        source_account_identifier: accountId,
        started_at: ctx.importedAt,
        status: "running",
      });
    if (runInsertError) {
      logError(runInsertError, {
        userId: user.id,
        teamId: organizationId,
        url: "/api/import/harvest",
        action: "harvestImportRunInsert",
      });
      return NextResponse.json(
        { error: `Could not record import run: ${runInsertError.message}` },
        { status: 500 },
      );
    }

    try {
      const dateRange = normalizeDateRange(body.from, body.to);
      const [
        harvestClients,
        harvestProjects,
        harvestTimeEntries,
        harvestInvoices,
      ] = await Promise.all([
        fetchHarvestClients(opts),
        fetchHarvestProjects(opts),
        fetchHarvestTimeEntries(opts, dateRange),
        fetchHarvestInvoices(opts, dateRange),
      ]);

      const errors: string[] = [];
      const customerMap = new Map<number, string>(); // Harvest id → Shyre id
      const projectMap = new Map<number, string>();
      const projectRateById = new Map<number, number | null>();
      const invoiceMap = new Map<number, string>(); // Harvest invoice id → Shyre invoice id

      // Helper: record a per-row failure both in the response (so the
      // UI's "Errors" list shows it) AND in error_logs (so /admin/errors
      // shows it). Two surfaces, one source — logError is fire-and-
      // forget so this never slows the import.
      const recordError = (message: string, detail: unknown): void => {
        errors.push(message);
        logError(detail instanceof Error ? detail : new Error(message), {
          userId: user.id,
          teamId: organizationId,
          url: "/api/import/harvest",
          action: "harvestImportRowError",
        });
      };

      // Pre-fetch existing Harvest imports for this team in two bulk
      // queries (one per table). Previous version did one SELECT per
      // Harvest row for the source-id dedupe plus another for the
      // name-fallback dedupe — 2N roundtrips on a cold import, the
      // single biggest contributor to import latency for accounts
      // with more than a handful of customers or projects.
      const existingCustomersBySourceId = new Map<string, string>();
      const existingCustomersByName = new Map<string, string>();
      {
        const { data: rows } = await supabase
          .from("customers")
          .select("id, name, import_source_id")
          .eq("team_id", organizationId)
          .eq("imported_from", "harvest");
        for (const row of rows ?? []) {
          const src = row.import_source_id as string | null;
          if (src) existingCustomersBySourceId.set(src, row.id as string);
        }

        // Separate query for pre-audit-trail rows (no source_id) that
        // should be matched by exact name. Scoped to imported_from
        // IS NULL so we never false-positive against a user's real
        // customer list.
        const { data: byNameRows } = await supabase
          .from("customers")
          .select("id, name")
          .eq("team_id", organizationId)
          .is("import_source_id", null);
        for (const row of byNameRows ?? []) {
          existingCustomersByName.set(row.name as string, row.id as string);
        }
      }

      // Customers ----------------------------------------------------
      let customersImported = 0;
      for (const hc of harvestClients) {
        if (!hc.is_active) continue;

        const bySource = existingCustomersBySourceId.get(String(hc.id));
        if (bySource) {
          customerMap.set(hc.id, bySource);
          continue;
        }

        const byName = existingCustomersByName.get(hc.name);
        if (byName) {
          customerMap.set(hc.id, byName);
          continue;
        }

        const row = buildCustomerRow(hc, ctx);
        const { data: inserted, error } = await supabase
          .from("customers")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          recordError(`Customer "${hc.name}": ${error.message}`, error);
          continue;
        }
        if (inserted) {
          customerMap.set(hc.id, inserted.id);
          customersImported++;
        }
      }

      // Category set + per-task categories ---------------------------
      // Must happen BEFORE projects are inserted so newly-created
      // projects can adopt this set as their base, satisfying the
      // validate_time_entry_category trigger when time entries later
      // reference categories from this set. One team-level "Harvest
      // Tasks" set; one category per unique task name the import
      // touches.
      const { setId: harvestSetId, idByTaskName: categoryIdByTaskName } =
        await upsertHarvestCategorySet(
          supabase,
          organizationId,
          user.id,
          harvestTimeEntries,
          ctx,
        );

      // Projects -----------------------------------------------------
      const existingProjectsBySourceId = new Map<string, string>();
      const existingProjectsByName = new Map<string, string>();
      // Track dedup'd projects that need a backfilled category_set_id.
      // Any existing project with category_set_id IS NULL gets filled
      // in so re-imports work after a prior run landed projects before
      // the Harvest Tasks set existed.
      const existingProjectSetIdById = new Map<string, string | null>();
      {
        const { data: rows } = await supabase
          .from("projects")
          .select("id, name, import_source_id, category_set_id")
          .eq("team_id", organizationId)
          .eq("imported_from", "harvest");
        for (const row of rows ?? []) {
          const src = row.import_source_id as string | null;
          if (src) existingProjectsBySourceId.set(src, row.id as string);
          existingProjectSetIdById.set(
            row.id as string,
            (row.category_set_id as string | null) ?? null,
          );
        }

        const { data: byNameRows } = await supabase
          .from("projects")
          .select("id, name, category_set_id")
          .eq("team_id", organizationId)
          .is("import_source_id", null);
        for (const row of byNameRows ?? []) {
          existingProjectsByName.set(row.name as string, row.id as string);
          existingProjectSetIdById.set(
            row.id as string,
            (row.category_set_id as string | null) ?? null,
          );
        }
      }

      /** Collect dedup'd project ids that need a category_set_id
       * backfill. We do one UPDATE ... IN (...) after the loop so
       * this stays O(1) roundtrips regardless of project count. */
      const projectsToBackfillSet: string[] = [];

      let projectsImported = 0;
      for (const hp of harvestProjects) {
        projectRateById.set(hp.id, hp.hourly_rate);

        const bySource = existingProjectsBySourceId.get(String(hp.id));
        if (bySource) {
          projectMap.set(hp.id, bySource);
          if (
            harvestSetId &&
            existingProjectSetIdById.get(bySource) === null
          ) {
            projectsToBackfillSet.push(bySource);
          }
          continue;
        }

        const byName = existingProjectsByName.get(hp.name);
        if (byName) {
          projectMap.set(hp.id, byName);
          if (
            harvestSetId &&
            existingProjectSetIdById.get(byName) === null
          ) {
            projectsToBackfillSet.push(byName);
          }
          continue;
        }

        const customerId = customerMap.get(hp.client.id) ?? null;
        const row = buildProjectRow(hp, customerId, ctx, harvestSetId);
        const { data: inserted, error } = await supabase
          .from("projects")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          recordError(`Project "${hp.name}": ${error.message}`, error);
          continue;
        }
        if (inserted) {
          projectMap.set(hp.id, inserted.id);
          projectsImported++;
        }
      }

      // Backfill category_set_id on dedup'd projects that had none.
      // Safe: we only touch rows that were NULL, so a user's manual
      // category-set assignment on an imported project is preserved.
      if (projectsToBackfillSet.length > 0 && harvestSetId) {
        const { error: backfillError } = await supabase
          .from("projects")
          .update({ category_set_id: harvestSetId })
          .in("id", projectsToBackfillSet)
          .is("category_set_id", null);
        if (backfillError) {
          recordError(
            `Backfilling category_set_id on dedup'd projects: ${backfillError.message}`,
            backfillError,
          );
        }
      }

      // Invoices -----------------------------------------------------
      // Run before time entries so the invoiceMap is populated and
      // each entry's `invoice` field can be backfilled on insert
      // (sets time_entries.invoice_id + invoiced=true). Invoices
      // dedupe by (team_id, imported_from='harvest', import_source_id)
      // via the partial unique index from the migration.
      const existingInvoicesBySourceId = new Map<string, string>();
      {
        const { data: rows } = await supabase
          .from("invoices")
          .select("id, import_source_id")
          .eq("team_id", organizationId)
          .eq("imported_from", "harvest");
        for (const row of rows ?? []) {
          const src = row.import_source_id as string | null;
          if (src) existingInvoicesBySourceId.set(src, row.id as string);
        }
      }

      let invoicesImported = 0;
      let invoicesRefreshed = 0;
      let invoiceLineItemsImported = 0;
      let invoicePaymentsImported = 0;
      // Skip reasons accumulate across both the invoices pass (here)
      // and the time-entries pass below. Time entries declared a
      // local map before this change; pulled it up so the payments
      // skip path can record into the same bucket.
      const skipReasons = new Map<string, number>();
      for (const hi of harvestInvoices) {
        const customerId = customerMap.get(hi.client.id) ?? null;
        const row = buildInvoiceRow(hi, customerId, ctx);

        const bySource = existingInvoicesBySourceId.get(String(hi.id));
        let shyreInvoiceId: string;

        if (bySource) {
          // Re-import: refresh the row from Harvest. Update only the
          // fields the importer owns — Harvest is the source of truth
          // for status, totals, and the sent_at / paid_at timestamps
          // we couldn't set on the original import. Leave team_id,
          // user_id, created_at, created_by_user_id alone (those were
          // set when the invoice first landed; refreshing them would
          // misattribute the original creation).
          const { error: updateError } = await supabase
            .from("invoices")
            .update({
              customer_id: row.customer_id,
              invoice_number: row.invoice_number,
              status: row.status,
              issued_date: row.issued_date,
              due_date: row.due_date,
              sent_at: row.sent_at,
              paid_at: row.paid_at,
              subtotal: row.subtotal,
              discount_amount: row.discount_amount,
              discount_rate: row.discount_rate,
              discount_reason: row.discount_reason,
              tax_rate: row.tax_rate,
              tax_amount: row.tax_amount,
              total: row.total,
              notes: row.notes,
              import_run_id: row.import_run_id,
            })
            .eq("id", bySource);
          if (updateError) {
            recordError(
              `Invoice "${hi.number}" refresh: ${updateError.message}`,
              updateError,
            );
            continue;
          }
          shyreInvoiceId = bySource;
          invoicesRefreshed++;

          // Line items: Harvest may have added/removed/changed lines
          // since the original import. Replace the set in one delete
          // + insert (cheaper than diffing for typical < 20-line
          // invoices). Cascade-delete on the FK would also drop child
          // rows tied to time_entries via time_entry_id; in practice
          // imported lines have time_entry_id=NULL so nothing is lost.
          const { error: deleteLiError } = await supabase
            .from("invoice_line_items")
            .delete()
            .eq("invoice_id", shyreInvoiceId);
          if (deleteLiError) {
            recordError(
              `Invoice "${hi.number}" line item refresh: ${deleteLiError.message}`,
              deleteLiError,
            );
            continue;
          }
        } else {
          // First import: insert.
          const { data: inserted, error } = await supabase
            .from("invoices")
            .insert(row)
            .select("id")
            .single();
          if (error) {
            recordError(`Invoice "${hi.number}": ${error.message}`, error);
            continue;
          }
          if (!inserted) continue;
          shyreInvoiceId = inserted.id as string;
          invoicesImported++;
        }

        invoiceMap.set(hi.id, shyreInvoiceId);

        // Line items piggyback on the parent. We stamp them all in
        // one batch per invoice — typical invoice has < 20 lines, so
        // chunking would be over-engineering.
        const lineItemRows = (hi.line_items ?? []).map((li) =>
          buildInvoiceLineItemRow(li, shyreInvoiceId),
        );
        if (lineItemRows.length > 0) {
          const { error: liError } = await supabase
            .from("invoice_line_items")
            .insert(lineItemRows);
          if (liError) {
            recordError(
              `Invoice "${hi.number}" line items: ${liError.message}`,
              liError,
            );
            continue;
          }
          invoiceLineItemsImported += lineItemRows.length;
        }

        // Payments. Harvest's invoice payload only has paid_at as
        // "the date a user clicked Mark paid" (often midnight UTC) —
        // the actual payment records live at /v2/invoices/{id}/payments
        // with the real timestamps + amounts + recorder. Only fetch
        // for invoices that could plausibly have payments (status
        // 'paid' or 'sent' — a 'sent' invoice can have partial
        // payments too); skip drafts and voids to save the round-trip.
        if (row.status === "paid" || row.status === "sent") {
          let harvestPayments: Awaited<
            ReturnType<typeof fetchHarvestInvoicePayments>
          > = [];
          try {
            harvestPayments = await fetchHarvestInvoicePayments(hi.id, opts);
          } catch (err) {
            recordError(
              `Invoice "${hi.number}" payments fetch: ${err instanceof Error ? err.message : String(err)}`,
              err,
            );
            continue;
          }

          // Replace existing imported payments before inserting fresh
          // ones — re-import semantics, same as line items.
          const { error: deletePayError } = await supabase
            .from("invoice_payments")
            .delete()
            .eq("invoice_id", shyreInvoiceId);
          if (deletePayError) {
            recordError(
              `Invoice "${hi.number}" payment refresh: ${deletePayError.message}`,
              deletePayError,
            );
            continue;
          }

          // Messages — used only for the latest send-recipient. Harvest
          // returns full message bodies + subjects too, but until
          // there's a UI to display them, importing the rest would be
          // pure DB churn. The activity log just needs the email +
          // name to render "Sent invoice to <name> <<email>>".
          try {
            const messages = await fetchHarvestInvoiceMessages(hi.id, opts);
            const recipient = pickLatestSendRecipient(messages);
            if (recipient) {
              const { error: sentToError } = await supabase
                .from("invoices")
                .update({
                  sent_to_email: recipient.email,
                  sent_to_name: recipient.name,
                })
                .eq("id", shyreInvoiceId);
              if (sentToError) {
                recordError(
                  `Invoice "${hi.number}" sent_to: ${sentToError.message}`,
                  sentToError,
                );
                // Don't continue — sent_to is best-effort metadata,
                // shouldn't abort the rest of this invoice's import.
              }
            }
          } catch (err) {
            recordError(
              `Invoice "${hi.number}" messages fetch: ${err instanceof Error ? err.message : String(err)}`,
              err,
            );
            // Same: best-effort. Fall through to the payments fetch.
          }

          // Harvest emits zero-amount payment records for things
          // like "thank you" notes and balance-zeroing adjustments;
          // our invoice_payments.amount has a CHECK (amount > 0).
          // Filter them out — they're not real payments, just
          // bookkeeping noise that would otherwise abort the row.
          // Negative amounts (refunds) are also out of scope today;
          // dropping them is consistent with how the importer
          // handles other Harvest-specific edge cases (the user's
          // refund flow is to add a manual line item).
          const realPayments = harvestPayments.filter((p) => p.amount > 0);
          const skippedPayments =
            harvestPayments.length - realPayments.length;
          if (skippedPayments > 0) {
            skipReasons.set(
              "non-positive payment amount",
              (skipReasons.get("non-positive payment amount") ?? 0) +
                skippedPayments,
            );
          }

          if (realPayments.length > 0) {
            const paymentRows = realPayments.map((p) =>
              buildInvoicePaymentRow(p, shyreInvoiceId, hi.currency),
            );
            const { error: payError } = await supabase
              .from("invoice_payments")
              .insert(paymentRows);
            if (payError) {
              recordError(
                `Invoice "${hi.number}" payments: ${payError.message}`,
                payError,
              );
              continue;
            }
            invoicePaymentsImported += paymentRows.length;
          }
        }
      }

      // Materialize "shell" + "bp:<id>" mapping choices -------------
      // Both flows produce a non-loggable auth.users row + team_members
      // row BEFORE buildTimeEntryRow runs (that function throws on an
      // unmaterialized sentinel). The bp:<id> variant additionally
      // links the resulting shell user to an existing business_people
      // row so the user's "I added Mariah under Business → People"
      // intent connects through to the imported time entries — no
      // orphan shell account created alongside the existing record.
      //
      // Both are idempotent on re-import (materializeHarvestShellAccount
      // returns the existing user_id; the business_people link uses
      // `user_id IS NULL` as a guard so a second run is a no-op).
      const harvestNameById = new Map<number, string>();
      for (const e of harvestTimeEntries) {
        if (!harvestNameById.has(e.user.id)) {
          harvestNameById.set(e.user.id, e.user.name);
        }
      }

      const shellEntries = Object.entries(userMapping).filter(
        ([, choice]) => choice === "shell" || (typeof choice === "string" && choice.startsWith("bp:")),
      );
      if (shellEntries.length > 0) {
        const adminClient = createAdminClient();
        for (const [k, choice] of shellEntries) {
          const harvestId = Number(k);
          const displayName = harvestNameById.get(harvestId);
          const linkedBusinessPersonId =
            typeof choice === "string" && choice.startsWith("bp:")
              ? choice.slice(3)
              : null;
          if (!displayName) {
            // No time entries reference this Harvest user in the
            // selected range. There is nothing to anchor a shell
            // account to and the bp:<id> link intent has no entries
            // to attach either — silent skip is the right behavior.
            //
            // Earlier this branch recorded a soft error
            // ("Shell account requested for Harvest user X but no
            // time entries reference them"). It surfaced as a red
            // ERRORS row on a successful 177-entry import for users
            // who'd been on Harvest historically but had zero entries
            // in the selected date range. That's expected behavior,
            // not a failure — drop the noise.
            continue;
          }
          try {
            const userId = await materializeHarvestShellAccount(adminClient, {
              teamId: organizationId,
              harvestUserId: harvestId,
              displayName,
            });
            if (linkedBusinessPersonId) {
              // Idempotent claim — only updates rows that don't yet have
              // a user_id set. A second import run is a no-op.
              const { error: linkErr } = await adminClient
                .from("business_people")
                .update({ user_id: userId })
                .eq("id", linkedBusinessPersonId)
                .is("user_id", null);
              if (linkErr) {
                recordError(
                  `business_people link failed for ${displayName} → person ${linkedBusinessPersonId}: ${linkErr.message}`,
                  linkErr,
                );
                // Don't fail the whole import — the time entries can
                // still attach to the shell user. The link can be
                // recovered manually from the People page.
              }
            }
            // Rewrite mapping in place — buildTimeEntryRow now sees a
            // real user_id and the resolver path stays linear.
            userMapping[harvestId] = userId;
          } catch (err) {
            recordError(
              `Shell account create failed for ${displayName}: ${err instanceof Error ? err.message : String(err)}`,
              err,
            );
            // Fall back to "skip" so the import doesn't half-attribute
            // their entries to the importer silently.
            userMapping[harvestId] = "skip";
          }
        }
      }

      // Time entries -------------------------------------------------
      let timeEntriesImported = 0;
      let timeEntriesSkipped = 0;

      // Bulk-load project ticket-defaults + classification once so the
      // per-row build can resolve short refs (#123 → octokit/rest.js#123)
      // and pin billable=false on internal projects without a per-row DB
      // query. First-time imports usually have ticket fields unset (the
      // user configures them post-import); subsequent re-imports benefit
      // when they're filled in. is_internal is already set by
      // buildProjectRow at insert time.
      const projectTicketDefaults = new Map<
        string,
        { github: string | null; jira: string | null; isInternal: boolean }
      >();
      const shyreProjectIds = [...projectMap.values()];
      if (shyreProjectIds.length > 0) {
        const { data: projectRows } = await supabase
          .from("projects")
          .select("id, github_repo, jira_project_key, is_internal")
          .in("id", shyreProjectIds);
        for (const row of projectRows ?? []) {
          projectTicketDefaults.set(row.id as string, {
            github: (row.github_repo as string | null) ?? null,
            jira: (row.jira_project_key as string | null) ?? null,
            isInternal: row.is_internal === true,
          });
        }
      }

      const okRows: Array<
        Exclude<
          ReturnType<typeof buildTimeEntryRow>,
          { skipped: true; reason: string }
        >
      > = [];

      for (const hte of harvestTimeEntries) {
        const shyreProjectId = projectMap.get(hte.project.id) ?? null;
        const ticketDefaults = shyreProjectId
          ? projectTicketDefaults.get(shyreProjectId)
          : undefined;
        // Dedupe by source id.
        const built = buildTimeEntryRow({
          entry: hte,
          projectId: shyreProjectId,
          projectHourlyRate: projectRateById.get(hte.project.id) ?? null,
          projectGithubRepo: ticketDefaults?.github ?? null,
          projectJiraProjectKey: ticketDefaults?.jira ?? null,
          projectIsInternal: ticketDefaults?.isInternal ?? false,
          userMapping,
          categoryIdByTaskName,
          ctx,
          timeZone,
          invoiceMap,
        });

        if ("skipped" in built) {
          timeEntriesSkipped++;
          skipReasons.set(built.reason, (skipReasons.get(built.reason) ?? 0) + 1);
          continue;
        }

        okRows.push(built);
      }

      // Batch upsert with idempotency via the partial unique index.
      // Conflicts are pre-existing imports — count them as skipped
      // rather than erroring the whole batch.
      // Upsert on the partial unique index (team_id, imported_from,
      // import_source_id). Re-import refreshes the row from Harvest
      // — same semantics the invoices pass already uses, and what
      // makes the user-facing "re-import to fix data" workflow
      // actually work. Without this, an entry's linked_ticket_*
      // columns (or a corrected description, or a new ticket
      // attachment in Harvest) would never propagate; the row would
      // just sit at its first-import state.
      //
      // Uses adminClient (not the user-scoped supabase) because
      // multi-author Harvest pulls assign user_id values that don't
      // match auth.uid() of the importer — once a "shell" account
      // has been materialized for a teammate who's never signed in,
      // their time entries have user_id = <shell user id>, which
      // the per-user time_entries_insert RLS check rejects. The
      // import route is owner/admin-gated (line 139), so writing on
      // the team's behalf via the service role is explicitly
      // authorized. Same precedent as materializeHarvestShellAccount
      // higher up in this file.
      const importAdminClient = createAdminClient();
      // The per-row time_entries trigger that protects invoiced
      // entries from UPDATE/DELETE raises with this exact message.
      // When a re-import would refresh an already-landed-and-now-
      // invoiced row, the upsert's ON CONFLICT … DO UPDATE path
      // hits the trigger, the WHOLE batch rolls back, and other
      // 99 rows in the batch silently fail to update too. We
      // detect the message, retry the batch row-by-row, and
      // route the locked rows to skipReasons rather than errors.
      const INVOICE_LOCK_MARKER = "Time entry is invoiced";
      const BATCH_SIZE = 100;
      for (let i = 0; i < okRows.length; i += BATCH_SIZE) {
        const batch = okRows.slice(i, i + BATCH_SIZE);
        const { error, count } = await importAdminClient
          .from("time_entries")
          .upsert(batch, {
            onConflict: "team_id,imported_from,import_source_id",
            ignoreDuplicates: false,
            count: "exact",
          });

        if (error) {
          if (error.message.includes(INVOICE_LOCK_MARKER)) {
            // Fall back to per-row upserts so the non-invoiced rows
            // in this batch still get refreshed. Invoiced rows skip
            // cleanly. The skipReasons line on the summary explains
            // exactly what happened so the user isn't left guessing.
            for (const row of batch) {
              const { error: rowErr, count: rowCount } =
                await importAdminClient
                  .from("time_entries")
                  .upsert([row], {
                    onConflict:
                      "team_id,imported_from,import_source_id",
                    ignoreDuplicates: false,
                    count: "exact",
                  });
              if (rowErr) {
                if (rowErr.message.includes(INVOICE_LOCK_MARKER)) {
                  skipReasons.set(
                    "Already imported and on a non-void invoice — refresh skipped",
                    (skipReasons.get(
                      "Already imported and on a non-void invoice — refresh skipped",
                    ) ?? 0) + 1,
                  );
                  timeEntriesSkipped++;
                  continue;
                }
                // Any other per-row error is a real failure.
                recordError(
                  `Time entries row: ${rowErr.message}`,
                  rowErr,
                );
                continue;
              }
              timeEntriesImported += rowCount ?? 1;
            }
            continue;
          }
          recordError(`Time entries batch: ${error.message}`, error);
          continue;
        }
        // Postgres returns the count of rows affected — both inserts
        // and updates. We don't have a clean way to split the two
        // from the client; report the total as imported and let the
        // reconciliation step expose the actual landed state.
        timeEntriesImported += count ?? batch.length;
      }

      // Reconciliation — re-query the landed Shyre rows by the Harvest
      // ids we fetched, so the response can show "Harvest said X hours,
      // Shyre has X hours" side by side. Chunked IN() queries to stay
      // under Postgres's parameter limit on very large imports.
      const reconciliation = await computeReconciliation(
        supabase,
        organizationId,
        harvestTimeEntries,
        Object.fromEntries(skipReasons),
      );

      // Date range covered by the entries Harvest returned for this
      // pull — independent of how many landed, so the user sees the
      // window they ASKED for (regardless of skip / error rejections).
      // Shown on the post-import summary screen (and the import
      // history list, computed there from time_entries).
      let earliestSpentDate: string | null = null;
      let latestSpentDate: string | null = null;
      for (const hte of harvestTimeEntries) {
        const d = hte.spent_date;
        if (!d) continue;
        if (earliestSpentDate === null || d < earliestSpentDate) {
          earliestSpentDate = d;
        }
        if (latestSpentDate === null || d > latestSpentDate) {
          latestSpentDate = d;
        }
      }

      const summary = {
        imported: {
          customers: customersImported,
          projects: projectsImported,
          invoices: invoicesImported,
          invoicesRefreshed,
          invoiceLineItems: invoiceLineItemsImported,
          invoicePayments: invoicePaymentsImported,
          timeEntries: timeEntriesImported,
        },
        skipped: {
          timeEntries: timeEntriesSkipped,
          reasons: Object.fromEntries(skipReasons),
        },
        errors,
        reconciliation,
        entryDateRange: {
          earliest: earliestSpentDate,
          latest: latestSpentDate,
        },
      };

      await supabase
        .from("import_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          summary,
        })
        .eq("id", ctx.importRunId);

      return NextResponse.json({
        success: true,
        importRunId: ctx.importRunId,
        ...summary,
      });
    } catch (err) {
      // Leave a trace in the import_runs record so the user can see
      // what happened in the history list — partial writes stay
      // addressable via undo even when the request itself crashed.
      await supabase
        .from("import_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          summary: {
            errors: [err instanceof Error ? err.message : String(err)],
          },
        })
        .eq("id", ctx.importRunId);

      return errorResponse(err, {
        userId: user.id,
        teamId: organizationId,
        action: "harvestImport",
      });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ────────────────────────────────────────────────────────────────
// Helpers — non-pure bits that wrap Supabase calls and belong here
// rather than in lib/harvest-import-logic.ts.
// ────────────────────────────────────────────────────────────────

/**
 * Query Shyre for the time_entries whose import_source_id matches
 * the Harvest entries we just fetched, then hand off to the pure
 * buildReconciliation to produce the side-by-side report.
 *
 * Chunked .in() queries — Postgres's query-string limit is generous
 * but a 10k-entry import would still build a ~100KB URL. 500 per
 * chunk keeps each request tidy.
 */
async function computeReconciliation(
  supabase: SBClient,
  teamId: string,
  harvestEntries: ReadonlyArray<{
    id: number;
    hours: number;
    client: { id: number; name: string };
  }>,
  skipReasons: Record<string, number>,
): Promise<ReturnType<typeof buildReconciliation>> {
  const harvestIds = harvestEntries.map((e) => String(e.id));
  const shyreRows: Array<{
    import_source_id: string;
    duration_min: number | null;
  }> = [];

  const CHUNK = 500;
  for (let i = 0; i < harvestIds.length; i += CHUNK) {
    const chunk = harvestIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("time_entries")
      .select("import_source_id, duration_min")
      .eq("team_id", teamId)
      .eq("imported_from", "harvest")
      .in("import_source_id", chunk);
    for (const row of data ?? []) {
      shyreRows.push({
        import_source_id: row.import_source_id as string,
        duration_min: (row.duration_min as number | null) ?? null,
      });
    }
  }

  return buildReconciliation({
    harvestEntries,
    shyreRows,
    skipReasons,
  });
}

async function fetchTeamMembersForMapping(
  supabase: SBClient,
  teamId: string,
): Promise<
  Array<{ user_id: string; email: string | null; display_name: string | null }>
> {
  const { data: members } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  const userIds = (members ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  const displayNameById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  // auth.users.email isn't available via the regular SSR client (RLS
  // on the auth schema). The import runs as an admin on the target
  // team; emails would be nice for matching but aren't required. For
  // now pass null — the mapper falls back to display-name matching.
  return userIds.map((id) => ({
    user_id: id,
    email: null,
    display_name: displayNameById.get(id) ?? null,
  }));
}

/**
 * Fetch unlinked business_people for the team's parent business. These
 * are payroll/HR records (1099 contractors, ex-employees) that the user
 * has captured under Business → People but who don't have a Shyre login
 * yet. Surfacing them in the import dropdown lets the user link a
 * Harvest user to an existing person record in one step instead of
 * creating an orphan shell account that doesn't tie back to the
 * People-page row they already filled in.
 *
 * RLS already gates SELECT on business_people to owner|admin (SAL-010),
 * which is exactly the scope required to run an import — so the regular
 * session client is appropriate here, no admin escalation needed.
 */
async function fetchBusinessPeopleForMapping(
  supabase: SBClient,
  teamId: string,
): Promise<
  Array<{
    id: string;
    legal_name: string;
    preferred_name: string | null;
    work_email: string | null;
    employment_type: string;
  }>
> {
  // teams.business_id resolves the parent business; business_people
  // hangs off business_id, not team_id.
  const { data: team } = await supabase
    .from("teams")
    .select("business_id")
    .eq("id", teamId)
    .maybeSingle();
  const businessId = (team?.business_id as string | undefined) ?? null;
  if (!businessId) return [];

  // Only unlinked rows are eligible for "claim this person" — a row with
  // user_id already set is its own active member and would already
  // appear in the Shyre team members section.
  const { data: people } = await supabase
    .from("business_people")
    .select("id, legal_name, preferred_name, work_email, employment_type")
    .eq("business_id", businessId)
    .is("user_id", null)
    .order("legal_name");
  return (people ?? []).map((p) => ({
    id: p.id as string,
    legal_name: p.legal_name as string,
    preferred_name: (p.preferred_name as string | null) ?? null,
    work_email: (p.work_email as string | null) ?? null,
    employment_type: p.employment_type as string,
  }));
}

/**
 * Fetch the caller's display name so the UI's "Me" option can read
 * "Me (Marcus Malcom)" instead of just "Me" — disambiguates against
 * the Shyre team members section, which currently lists the caller as
 * a separate option (visually duplicating the same destination).
 */
async function fetchCallerDisplayName(
  supabase: SBClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.display_name as string | null) ?? null;
}

/**
 * Upsert the "Harvest Tasks" team-scoped category_set and one category
 * per unique Harvest task name referenced by the imported entries.
 *
 * Returns `{ setId, idByTaskName }`:
 *   setId        — the category_set.id, needed when inserting / back-
 *                  filling projects so validate_time_entry_category
 *                  accepts time entries tagged with these categories.
 *                  May be null when there were no tasks to categorize.
 *   idByTaskName — task name → category id lookup for tagging time
 *                  entries.
 */
async function upsertHarvestCategorySet(
  supabase: SBClient,
  teamId: string,
  userId: string,
  entries: Array<{ task: { id: number; name: string } }>,
  ctx: ImportContext,
): Promise<{ setId: string | null; idByTaskName: Map<string, string> }> {
  const taskNames = collectUniqueTaskNames(entries);
  const idByTaskName = new Map<string, string>();
  if (taskNames.length === 0) return { setId: null, idByTaskName };

  // Find existing set by name; otherwise create.
  const { data: existingSet } = await supabase
    .from("category_sets")
    .select("id")
    .eq("team_id", teamId)
    .eq("name", HARVEST_CATEGORY_SET_NAME)
    .maybeSingle();

  let setId: string;
  if (existingSet) {
    setId = existingSet.id as string;
  } else {
    const { data: created, error } = await supabase
      .from("category_sets")
      .insert({
        team_id: teamId,
        project_id: null,
        name: HARVEST_CATEGORY_SET_NAME,
        description: "Imported from Harvest tasks.",
        is_system: false,
        created_by: userId,
        imported_from: "harvest",
        imported_at: ctx.importedAt,
        import_run_id: ctx.importRunId,
      })
      .select("id")
      .single();
    if (error || !created) return { setId: null, idByTaskName };
    setId = created.id as string;
  }

  // Fetch existing categories under that set.
  const { data: existingCats } = await supabase
    .from("categories")
    .select("id, name")
    .eq("category_set_id", setId);
  const existingByName = new Map<string, string>(
    (existingCats ?? []).map((c) => [c.name as string, c.id as string]),
  );

  const toInsert = taskNames.filter((name) => !existingByName.has(name));
  if (toInsert.length > 0) {
    const rows = toInsert.map((name, idx) => ({
      category_set_id: setId,
      name,
      color: "#6b7280",
      sort_order: idx,
      imported_from: "harvest",
      imported_at: ctx.importedAt,
      import_run_id: ctx.importRunId,
    }));
    const { data: inserted } = await supabase
      .from("categories")
      .insert(rows)
      .select("id, name");
    for (const row of inserted ?? []) {
      existingByName.set(row.name as string, row.id as string);
    }
  }

  for (const name of taskNames) {
    const id = existingByName.get(name);
    if (id) idByTaskName.set(name, id);
  }
  return { setId, idByTaskName };
}

