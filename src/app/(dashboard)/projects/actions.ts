"use server";

import { runSafeAction } from "@/lib/safe-action";
import { AppError, assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess, requireTeamAdmin } from "@/lib/team-context";
import { isTeamAdmin } from "@/lib/team-roles";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeGithubRepo } from "@/lib/projects/normalize";
import type { ProjectHistoryEntry } from "./[id]/history/project-history-types";
import {
  ALLOWED_BUDGET_PERIODS,
  ALLOWED_BUDGET_CARRYOVER,
  TERMINAL_PROJECT_STATUSES,
} from "./allow-lists";

/** Atlassian project keys are uppercase 2+ chars, letters/digits.
 *  Normalize for symmetry with the detection regex in
 *  src/lib/tickets/detect.ts so a user typing "proj" still resolves
 *  short refs against "PROJ-123" later. Empty / whitespace → null. */
function normalizeJiraKey(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z][A-Z0-9_]+$/.test(s)) {
    throw new Error(
      "Jira project key must be uppercase letters / digits, 2+ chars (e.g. PROJ).",
    );
  }
  return s;
}

/** Invoice code rendered as `[CODE]` on each line item. Hyphens
 *  allowed (unlike Jira keys, which are hyphen-free by Atlassian
 *  convention). 2–16 chars, uppercase, must start with a letter.
 *  Empty → null. */
function normalizeInvoiceCode(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z][A-Z0-9-]{1,15}$/.test(s)) {
    throw new Error(
      "Invoice code must be uppercase letters / digits / hyphens, 2–16 chars (e.g. PC-ITOPS).",
    );
  }
  return s;
}

/** Planning dates submitted by `<DateField>` arrive as ISO `YYYY-MM-DD`
 *  via its hidden input (or empty → no date). Validate the shape so a
 *  forged POST can't write a malformed DATE; empty → null. */
function normalizeProjectedEndDate(
  value: FormDataEntryValue | null,
): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Projected end date must be a valid date (YYYY-MM-DD).");
  }
  return s;
}

export async function createProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId } = await validateTeamAccess(teamId);

    const name = formData.get("name") as string;
    const is_internal = formData.get("is_internal") === "on";
    const customer_id_raw = (formData.get("customer_id") as string) || null;
    // Internal projects must have NULL customer; the CHECK constraint
    // `projects_internal_xor_customer` would reject an inconsistent
    // pair, but we normalize at the boundary so the user sees a clean
    // form rather than a Postgres constraint error.
    const customer_id = is_internal ? null : customer_id_raw;
    if (!is_internal && !customer_id) {
      throw new Error(
        "Pick a customer for this project, or mark it as an internal project.",
      );
    }
    // Internal projects are non-billable by definition (they never
    // appear on an invoice). Force the default; a UI override on
    // billable would be misleading.
    const default_billable = is_internal
      ? false
      : formData.get("default_billable") !== "off";
    const description = (formData.get("description") as string) || null;
    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = normalizeGithubRepo(formData.get("github_repo"));
    let jira_project_key = normalizeJiraKey(formData.get("jira_project_key"));
    const invoice_code = normalizeInvoiceCode(formData.get("invoice_code"));
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";
    // Optional parent project — when set, the new project is a
    // sub-project under the chosen parent. The DB trigger
    // `projects_enforce_parent_invariants` validates same-customer +
    // same-team + 1-level-deep; we trust it and pass through.
    const parent_project_id =
      (formData.get("parent_project_id") as string) || null;

    // Sub-project inheritance: silently fill in fields the form
    // doesn't expose (today: jira_project_key) from the parent so
    // sub-projects auto-link to the same Jira project / repo /
    // invoice code without the user re-typing them. Visible form
    // fields are pre-filled on the client (NewProjectForm) so the
    // user sees + can override what they're inheriting; this server
    // path is for fields with no UI.
    //
    // Form values still WIN — we only fill from parent when the
    // resolved value is null. Future additions to this block belong
    // alongside the visible-field list in
    // `src/lib/projects/parent-defaults.ts`.
    if (parent_project_id && jira_project_key === null) {
      const { data: parent } = await supabase
        .from("projects")
        .select("jira_project_key")
        .eq("id", parent_project_id)
        .maybeSingle();
      const parentKey =
        (parent as { jira_project_key?: string | null } | null)
          ?.jira_project_key ?? null;
      if (parentKey) jira_project_key = parentKey;
    }

    assertSupabaseOk(
      await supabase.from("projects").insert({
        team_id: teamId,
        user_id: userId,
        customer_id,
        is_internal,
        default_billable,
        name,
        description,
        hourly_rate,
        budget_hours,
        github_repo,
        jira_project_key,
        invoice_code,
        category_set_id,
        require_timestamps,
        parent_project_id,
      })
    );

    revalidatePath("/projects");
    if (customer_id) revalidatePath(`/customers/${customer_id}`);
  }, "createProjectAction") as unknown as void;
}

export async function updateProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const github_repo = normalizeGithubRepo(formData.get("github_repo"));
    const jira_project_key = normalizeJiraKey(formData.get("jira_project_key"));
    const invoice_code = normalizeInvoiceCode(formData.get("invoice_code"));
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";

    const patch: Record<string, unknown> = {
      name,
      description,
      github_repo,
      jira_project_key,
      invoice_code,
      category_set_id,
      require_timestamps,
    };

    // Status: only the two live states are settable through the generic
    // edit form. Terminal transitions (close-out / reopen / archive) go
    // through their own owner/admin-gated verbs, so this path can't be a
    // backdoor around the role gate + lifecycle triggers.
    const rawStatus = formData.get("status");
    if (rawStatus != null && String(rawStatus) !== "") {
      const s = String(rawStatus);
      if (s !== "active" && s !== "paused") {
        throw new Error(
          "Use Close out / Reopen / Archive to set a terminal project status.",
        );
      }
      // A live-status write must not silently reopen a closed-out or
      // archived project — reopening is an admin-gated verb.
      const { data: current } = await supabase
        .from("projects")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      const currentStatus = (current as { status?: string } | null)?.status;
      if (currentStatus && TERMINAL_PROJECT_STATUSES.has(currentStatus)) {
        throw new Error(
          "This project is closed or archived. Use Reopen to make it active again.",
        );
      }
      patch.status = s;
    }

    // Parent project re-parenting — only when the field is present on
    // the form (otherwise we leave the existing relationship alone).
    // Empty string normalizes to NULL ("detach from parent"). The DB
    // trigger validates same-customer + same-team + 1-level-deep + no
    // self-ref + no cycle.
    if (formData.has("parent_project_id")) {
      const raw = formData.get("parent_project_id") as string;
      patch.parent_project_id = raw === "" ? null : raw;
    }

    // Projected end date — planning metadata, not commercial info, so
    // it is NOT rate-gated. Guarded by presence so a partial caller
    // can't wipe it; the edit form's Schedule subsection always submits
    // it (empty string clears the date).
    if (formData.has("projected_end_date")) {
      patch.projected_end_date = normalizeProjectedEndDate(
        formData.get("projected_end_date"),
      );
    }

    // default_billable is editable on external projects only — internal
    // projects are pinned to false by setProjectInternalAction. Skip
    // the field for internal projects (the form hides it) so a stale
    // checkbox can't flip the value.
    if (formData.has("default_billable")) {
      const { data: existing } = await supabase
        .from("projects")
        .select("is_internal")
        .eq("id", id)
        .maybeSingle();
      if (existing && (existing as { is_internal?: boolean }).is_internal !== true) {
        patch.default_billable = formData.get("default_billable") !== "off";
      }
    }

    // Guardrail: only include hourly_rate AND the budget fields in
    // the UPDATE if the caller is authorized by rate_editability.
    // Budget edits reveal the same shape of commercial information
    // as the rate (retainer size, dollar caps), so they share the
    // gate per the agency-owner persona consultation. Existing form
    // submissions and forged direct POSTs that include these fields
    // for an unauthorized caller get silently dropped — the rest
    // of the update applies so a non-rate edit still succeeds.
    const touchesRateOrBudget =
      formData.has("hourly_rate") ||
      formData.has("budget_hours") ||
      formData.has("budget_hours_per_period") ||
      formData.has("budget_dollars_per_period") ||
      formData.has("budget_period") ||
      formData.has("budget_carryover") ||
      formData.has("budget_alert_threshold_pct");
    if (touchesRateOrBudget) {
      const { data: canSet } = await supabase.rpc("can_set_project_rate", {
        p_project_id: id,
      });
      if (canSet) {
        if (formData.has("hourly_rate")) {
          const rateStr = formData.get("hourly_rate") as string;
          patch.hourly_rate = rateStr ? parseFloat(rateStr) : null;
        }
        if (formData.has("budget_hours")) {
          const s = formData.get("budget_hours") as string;
          patch.budget_hours = s ? parseFloat(s) : null;
        }
        if (formData.has("budget_hours_per_period")) {
          const s = formData.get("budget_hours_per_period") as string;
          patch.budget_hours_per_period = s ? parseFloat(s) : null;
        }
        if (formData.has("budget_dollars_per_period")) {
          const s = formData.get("budget_dollars_per_period") as string;
          patch.budget_dollars_per_period = s ? parseFloat(s) : null;
        }
        if (formData.has("budget_period")) {
          const raw = (formData.get("budget_period") as string) || "";
          patch.budget_period =
            raw === "" ? null : raw;
          if (raw !== "" && !ALLOWED_BUDGET_PERIODS.has(raw)) {
            throw new Error(
              `Invalid budget period: ${raw}. Allowed: weekly, monthly, quarterly.`,
            );
          }
        }
        if (formData.has("budget_carryover")) {
          const raw = (formData.get("budget_carryover") as string) || "none";
          if (!ALLOWED_BUDGET_CARRYOVER.has(raw)) {
            throw new Error(
              `Invalid budget carryover: ${raw}. Allowed: none, within_quarter, lifetime.`,
            );
          }
          patch.budget_carryover = raw;
        }
        if (formData.has("budget_alert_threshold_pct")) {
          const raw = (formData.get("budget_alert_threshold_pct") as string) || "";
          if (raw === "") {
            patch.budget_alert_threshold_pct = null;
          } else {
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 1 || n > 100) {
              throw new Error(
                "Alert threshold must be between 1 and 100, or empty for no alerts.",
              );
            }
            patch.budget_alert_threshold_pct = n;
          }
        }
      }
    }

    assertSupabaseOk(
      await supabase.from("projects").update(patch).eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "updateProjectAction") as unknown as void;
}

export async function setProjectRateAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: canSet } = await supabase.rpc("can_set_project_rate", {
      p_project_id: id,
    });
    if (!canSet) {
      throw new Error("Not authorized to set this project's rate.");
    }

    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;

    assertSupabaseOk(
      await supabase.from("projects").update({ hourly_rate }).eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "setProjectRateAction") as unknown as void;
}

const PROJECT_TIME_ENTRIES_VISIBILITY = new Set([
  "own_only",
  "read_all",
  "read_write_all",
]);

/**
 * Set the per-project time_entries_visibility override. Pass `null`
 * (or omit the level field) to clear and fall back to the team value.
 * Owner/admin only.
 */
export async function setProjectTimeEntriesVisibilityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: project } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", id)
      .single();
    const teamId = (project as { team_id?: string } | null)?.team_id;
    if (!teamId) throw new Error("Project not found.");

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error(
        "Only owners and admins can change project time-entry visibility.",
      );
    }

    const rawLevel = formData.get("level");
    let level: string | null;
    if (rawLevel === null || rawLevel === "") {
      level = null; // inherit team
    } else {
      level = rawLevel as string;
      if (!PROJECT_TIME_ENTRIES_VISIBILITY.has(level)) {
        throw new Error(
          `Invalid level "${level}". Allowed: own_only, read_all, read_write_all, or empty to inherit.`,
        );
      }
    }

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ time_entries_visibility: level })
        .eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath(`/teams/${teamId}`);
  }, "setProjectTimeEntriesVisibilityAction") as unknown as void;
}

interface ProjectCategoryInput {
  /** Existing category id — present when editing an already-saved category. */
  id?: string;
  name: string;
  color: string;
  sort_order: number;
}

/**
 * Upsert the project's full category configuration in one call:
 *   - base_category_set_id: pointer to a system or team set (nullable)
 *   - project-scoped extension set + its categories (additive)
 *
 * Form contract:
 *   project_id — required
 *   base_category_set_id — optional; if present (including empty string
 *     to mean "none") updates projects.category_set_id
 *   set_name — name of the extension set (defaults to "Project categories")
 *   categories — JSON array of { id?, name, color, sort_order } for the
 *     extension set. Empty array clears the extension (extension set is
 *     preserved for re-use but has no categories).
 */
export async function upsertProjectCategoriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const project_id = formData.get("project_id") as string;
    if (!project_id) throw new Error("project_id is required");
    const setName =
      (formData.get("set_name") as string) || "Project categories";
    const categoriesRaw = formData.get("categories") as string;
    const categories: ProjectCategoryInput[] = categoriesRaw
      ? (JSON.parse(categoriesRaw) as ProjectCategoryInput[])
      : [];
    // base_category_set_id is optional — only set when the caller is
    // also changing the base. Empty string means "no base set".
    const baseSetRaw = formData.get("base_category_set_id");
    const baseSetUpdateRequested = baseSetRaw !== null;
    const baseSetId =
      typeof baseSetRaw === "string" && baseSetRaw.length > 0
        ? baseSetRaw
        : null;

    // Resolve the project's team (membership check) — derive server-side
    // so a stale form can't target a project the user can't edit.
    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id, category_set_id")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");
    await validateTeamAccess(project.team_id as string);

    // Update the base pointer first so the picker's read-side stays
    // consistent if the extension upsert is expensive.
    if (
      baseSetUpdateRequested &&
      project.category_set_id !== baseSetId
    ) {
      assertSupabaseOk(
        await supabase
          .from("projects")
          .update({ category_set_id: baseSetId })
          .eq("id", project_id),
      );
    }

    // Cross-set overlap check: extension names must not collide (case-
    // insensitive) with categories in the base set. Two "Admin" items
    // in the picker would be confusing and unresolvable.
    const effectiveBaseId = baseSetUpdateRequested
      ? baseSetId
      : (project.category_set_id as string | null);
    if (effectiveBaseId && categories.length > 0) {
      const { data: baseCats } = await supabase
        .from("categories")
        .select("name")
        .eq("category_set_id", effectiveBaseId);
      const baseNames = new Set(
        (baseCats ?? []).map((c) => (c.name as string).toLowerCase()),
      );
      const overlapping = categories.filter((c) =>
        baseNames.has(c.name.trim().toLowerCase()),
      );
      if (overlapping.length > 0) {
        const names = overlapping.map((c) => c.name).join(", ");
        throw new Error(
          `These names already exist in the base set: ${names}. Rename or remove them to avoid duplicates in the picker.`,
        );
      }
    }

    // Find or create the project-scoped set. It's identified by
    // project_id (one project-scoped set per project).
    const { data: existingSet } = await supabase
      .from("category_sets")
      .select("id")
      .eq("project_id", project_id)
      .maybeSingle();
    let setId = existingSet?.id as string | undefined;
    if (!setId) {
      const insert = await supabase
        .from("category_sets")
        .insert({
          project_id,
          team_id: null,
          is_system: false,
          name: setName,
          created_by: userId,
        })
        .select("id")
        .single();
      assertSupabaseOk(insert);
      setId = insert.data?.id as string;
    } else if (setName) {
      // Rename on subsequent calls so the set label stays in sync.
      assertSupabaseOk(
        await supabase
          .from("category_sets")
          .update({ name: setName })
          .eq("id", setId),
      );
    }

    // Sync categories: delete rows whose id is no longer in the payload,
    // update rows with matching id, insert rows without id.
    const { data: currentRows } = await supabase
      .from("categories")
      .select("id")
      .eq("category_set_id", setId);
    const keptIds = categories
      .map((c) => c.id)
      .filter((x): x is string => typeof x === "string");
    const toDelete = (currentRows ?? [])
      .map((r) => r.id as string)
      .filter((id) => !keptIds.includes(id));
    if (toDelete.length > 0) {
      assertSupabaseOk(
        await supabase.from("categories").delete().in("id", toDelete),
      );
    }

    for (const cat of categories) {
      if (cat.id) {
        assertSupabaseOk(
          await supabase
            .from("categories")
            .update({
              name: cat.name,
              color: cat.color,
              sort_order: cat.sort_order,
            })
            .eq("id", cat.id),
        );
      } else {
        assertSupabaseOk(
          await supabase.from("categories").insert({
            category_set_id: setId,
            name: cat.name,
            color: cat.color,
            sort_order: cat.sort_order,
          }),
        );
      }
    }

    // Intentionally DO NOT repoint `projects.category_set_id`. The project
    // keeps whatever base set (system or team) it's using; the project-
    // scoped set here is an *extension* discovered via
    // `category_sets.project_id = project.id`. Time-entry pickers union
    // the two at read time.

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "upsertProjectCategoriesAction") as unknown as void;
}

/**
 * Remove the project's project-scoped extension category set. Drops the
 * set (categories cascade via FK). The project's base `category_set_id`
 * is intentionally left alone — the user keeps whatever system / team
 * set they had. Time entries that referenced extension categories get
 * their `category_id` nulled automatically via ON DELETE SET NULL on
 * time_entries.category_id.
 */
export async function deleteProjectCategoriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const project_id = formData.get("project_id") as string;
    if (!project_id) throw new Error("project_id is required");

    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");
    await validateTeamAccess(project.team_id as string);

    const { data: set } = await supabase
      .from("category_sets")
      .select("id")
      .eq("project_id", project_id)
      .maybeSingle();

    if (set?.id) {
      // ON DELETE CASCADE drops categories under the set.
      assertSupabaseOk(
        await supabase.from("category_sets").delete().eq("id", set.id),
      );
    }

    revalidatePath(`/projects/${project_id}`);
    revalidatePath("/time-entries");
  }, "deleteProjectCategoriesAction") as unknown as void;
}

/**
 * Flip a project between "internal" (no customer, never invoiced) and
 * "client work" (has customer, invoiceable). The two states have
 * mutually exclusive shapes — the DB CHECK constraint enforces that
 * `is_internal` ⇔ `customer_id IS NULL` — so the operation has to be
 * atomic: setting one without updating the other fails the constraint.
 *
 * Form contract:
 *   id (required) — project id
 *   target (required) — "internal" or "client_work"
 *   customer_id — required when target = "client_work"
 *
 * Guards:
 *   - flipping to internal is blocked if the project has any line
 *     items on a non-void invoice (the project's hours are already
 *     committed to a customer's bill; reclassifying it as internal
 *     would mean the historical invoice references a project that
 *     "shouldn't" be invoiceable). Resolve the invoice — void it or
 *     remove the line items — first.
 *   - flipping to client work requires a customer_id; the form picker
 *     submits one, but a forged POST without it returns the same
 *     error the form would show.
 *
 * Side effects when flipping to internal:
 *   - default_billable is forced to false (a non-invoiceable project
 *     can't have billable time by definition).
 */
export async function setProjectInternalAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const target = formData.get("target") as string;
    if (target !== "internal" && target !== "client_work") {
      throw new Error(
        `Invalid target "${target}". Expected "internal" or "client_work".`,
      );
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id, customer_id, is_internal")
      .eq("id", id)
      .maybeSingle();
    if (!project) throw new Error("Project not found.");
    await validateTeamAccess(project.team_id as string);

    if (target === "internal") {
      // Block if any time entry on this project is locked to a
      // non-void invoice. The locked entries pre-existed under a
      // customer; reclassifying the project as internal silently
      // would leave the historical invoice referencing a project
      // that's no longer invoiceable. Force the user to confront
      // the historical state first.
      const { data: invoicedRows } = await supabase
        .from("time_entries")
        .select("invoice_id")
        .eq("project_id", id)
        .not("invoice_id", "is", null)
        .limit(50);
      const invoiceIds = Array.from(
        new Set(
          (invoicedRows ?? [])
            .map((r) => r.invoice_id as string | null)
            .filter((x): x is string => x !== null),
        ),
      );
      if (invoiceIds.length > 0) {
        const { data: blocking } = await supabase
          .from("invoices")
          .select("id, invoice_number, status")
          .in("id", invoiceIds)
          .neq("status", "void");
        if ((blocking ?? []).length > 0) {
          const numbers = (blocking ?? [])
            .map((b) => b.invoice_number as string)
            .join(", ");
          throw new Error(
            `Can't make this project internal — its time is on invoice ${numbers}. Void the invoice or remove the project's entries from it first.`,
          );
        }
      }

      assertSupabaseOk(
        await supabase
          .from("projects")
          .update({
            is_internal: true,
            customer_id: null,
            default_billable: false,
          })
          .eq("id", id),
      );

      const previousCustomer = project.customer_id as string | null;
      revalidatePath(`/projects/${id}`);
      revalidatePath("/projects");
      if (previousCustomer) revalidatePath(`/customers/${previousCustomer}`);
    } else {
      const customer_id = (formData.get("customer_id") as string) || null;
      if (!customer_id) {
        throw new Error(
          "Pick a customer to make this a client project.",
        );
      }
      assertSupabaseOk(
        await supabase
          .from("projects")
          .update({
            is_internal: false,
            customer_id,
          })
          .eq("id", id),
      );
      revalidatePath(`/projects/${id}`);
      revalidatePath("/projects");
      revalidatePath(`/customers/${customer_id}`);
    }
  }, "setProjectInternalAction") as unknown as void;
}

/**
 * Bulk-apply the project's current `default_billable` to every
 * already-existing, not-yet-invoiced, not-trashed time entry on the
 * project. The "switch pathway" the user explicitly called out: when
 * a project's default flips, this lets you propagate the change to
 * historical entries in one click instead of touching them one at a
 * time.
 *
 * Skipped rows:
 *   - `invoice_id IS NOT NULL` — already locked to an invoice; the
 *     invoice's totals depend on the row's billable flag. Editing
 *     locked rows is the invoice-mutation path, not this one.
 *   - `deleted_at IS NOT NULL` — trash. They'll inherit the new
 *     default if restored later (or not, depending on workflow —
 *     trash is out of scope for this action).
 *
 * Returns nothing on success; the page revalidates and the caller
 * sees the count via toast (form action).
 */
export async function applyDefaultBillableAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("project_id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: project } = await supabase
      .from("projects")
      .select("id, team_id, default_billable, is_internal")
      .eq("id", id)
      .maybeSingle();
    if (!project) throw new Error("Project not found.");
    await validateTeamAccess(project.team_id as string);

    // Internal projects always have default_billable=false (CHECK +
    // server enforcement). Running this on them is a no-op but
    // explicit — set unbilled entries to false to align with policy.
    const target = (project as { default_billable: boolean }).default_billable;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ billable: target })
        .eq("project_id", id)
        .is("invoice_id", null)
        .is("deleted_at", null),
    );

    revalidatePath(`/projects/${id}`);
    revalidatePath("/time-entries");
    revalidatePath("/reports");
  }, "applyDefaultBillableAction") as unknown as void;
}

/**
 * Bulk archive — Pattern B selection toolbar on /projects. Flips
 * `status = 'archived'` on every selected project at once. RLS
 * gates the actual write per row; rows the caller can't archive
 * are silently skipped. Pair with `bulkRestoreProjectsAction`
 * for the Undo toast.
 */
export async function bulkArchiveProjectsAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "archived" })
        .in("id", ids),
    );

    revalidatePath("/projects");
    revalidatePath("/time-entries");
  }, "bulkArchiveProjectsAction") as unknown as void;
}

/**
 * Bulk-switch the category set across the selected projects. Pairs
 * with the agency-owner persona's "switch all 8 of our projects
 * from Set X to Set Y" workflow — replaces the one-by-one Edit
 * dance with a single gesture from /projects' multi-select strip.
 *
 * Form contract:
 *   id (multiple) — project ids to update.
 *   category_set_id — empty string clears the set; a UUID sets it.
 *
 * Validation: the chosen set must be visible to the caller (RLS on
 * `category_sets` handles this when we attempt to read it). A
 * forged POST with a foreign id silently no-ops on the visibility
 * check rather than leaking which sets exist.
 *
 * RLS on `projects` skips ids the caller can't update — partial
 * outcomes are expected and silent (mirrors bulkArchiveProjects).
 *
 * The original `category_set_id` is NOT captured for an Undo —
 * unlike archive, switching a set has no canonical "previous
 * value" since the operation is many-to-one (could be coming from
 * different sets). The user re-runs the action with their old set
 * to reverse, which is one click on the same UI surface. The
 * `projects_history` audit trail (added 2026-05-06) records the
 * pre-change snapshot for every project as a side effect of the
 * UPDATE trigger.
 */
export async function bulkSwitchCategorySetAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    const rawSetId = (formData.get("category_set_id") as string) ?? "";
    const category_set_id = rawSetId.length > 0 ? rawSetId : null;

    // Defense-in-depth: confirm the chosen set is one the caller can
    // actually read. RLS on `category_sets` (system + team + project-
    // scoped, the latter being a separate concept we don't expose
    // here) gates this. A null `category_set_id` skips the check —
    // clearing the set is always allowed.
    if (category_set_id) {
      const { data: visible } = await supabase
        .from("category_sets")
        .select("id")
        .eq("id", category_set_id)
        .maybeSingle();
      if (!visible) {
        throw new Error(
          "That category set isn't accessible. Pick a set from your team's library.",
        );
      }
    }

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ category_set_id })
        .in("id", ids),
    );

    revalidatePath("/projects");
    revalidatePath("/time-entries");
  }, "bulkSwitchCategorySetAction") as unknown as void;
}

/**
 * Bulk restore — Undo from the bulk-archive toast. Resets
 * `status = 'active'` on the given ids. Uses 'active' rather than
 * a captured pre-archive status because we don't track that —
 * same trade-off as expense restore.
 */
export async function bulkRestoreProjectsAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "active" })
        .in("id", ids),
    );

    revalidatePath("/projects");
    revalidatePath("/time-entries");
  }, "bulkRestoreProjectsAction") as unknown as void;
}

/**
 * Close out a project — transition to the existing `completed`
 * lifecycle status. The DB does the rest: `tg_projects_stamp_closed_at`
 * stamps `closed_at` + `closed_by_user_id`, and
 * `tg_projects_block_close_with_open_children` rejects the close when a
 * sub-project is still open (surfaced here as the trigger's friendly
 * message via the runSafeAction error envelope).
 *
 * Owner/admin only. Close-out is a billing-adjacent, state-finalizing
 * action — it deliberately does NOT ride the generic project-edit RLS
 * gate, which a per-customer `admin` (who can be a plain team member)
 * satisfies. Reversible via `reopenProjectAction`.
 */
export async function closeOutProjectAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: project } = await supabase
      .from("projects")
      .select("team_id, status")
      .eq("id", id)
      .single();
    const proj = project as { team_id?: string; status?: string } | null;
    if (!proj?.team_id) throw new Error("Project not found.");

    await requireTeamAdmin(proj.team_id);

    // Already closed out — idempotent no-op (don't re-stamp closed_at).
    if (proj.status === "completed") return;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "completed" })
        .eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath("/time-entries");
  }, "closeOutProjectAction") as unknown as void;
}

/**
 * Reopen a closed-out project — transition back to `active`. The
 * stamping trigger clears `closed_at` + `closed_by_user_id` (the CHECK
 * forbids a close date on a live project). Owner/admin only, symmetric
 * with close-out. `projects_history` audits both transitions.
 */
export async function reopenProjectAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Project id is required.");

    const { data: project } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", id)
      .single();
    const teamId = (project as { team_id?: string } | null)?.team_id;
    if (!teamId) throw new Error("Project not found.");

    await requireTeamAdmin(teamId);

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "active" })
        .eq("id", id),
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath("/time-entries");
  }, "reopenProjectAction") as unknown as void;
}

/**
 * Resolve which of the given teams the caller is an owner/admin of.
 * Used by the bulk close/reopen actions to gate per team — a forged
 * POST mixing in teams the caller doesn't administer silently drops
 * those rows rather than throwing the whole batch.
 */
async function resolveAdminTeamIds(teamIds: string[]): Promise<Set<string>> {
  const adminTeamIds = new Set<string>();
  for (const tid of [...new Set(teamIds)]) {
    try {
      const { role } = await validateTeamAccess(tid);
      if (isTeamAdmin(role)) adminTeamIds.add(tid);
    } catch {
      // Not a member of this team (forged id) → not an admin; skip it.
      continue;
    }
  }
  return adminTeamIds;
}

/**
 * Bulk close-out — Pattern B selection toolbar on /projects. Closes
 * every eligible selected project in one statement.
 *
 * Eligibility is pre-filtered so the single batch UPDATE never trips
 * the block-open-children trigger (which would abort the whole batch):
 *   - caller must be owner/admin of the project's team,
 *   - project must not already be terminal (completed/archived),
 *   - project must have NO open sub-projects.
 * A parent with open phases is therefore skipped — close the phases
 * first (one gesture), then the parent. Skips are silent; the list
 * revalidates so the outcome is visible. Pair with
 * `bulkReopenProjectsAction` for the Undo toast.
 */
export async function bulkCloseProjectsAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    const { data: rows } = await supabase
      .from("projects")
      .select("id, team_id, status")
      .in("id", ids);
    const projects = (rows ?? []) as Array<{
      id: string;
      team_id: string;
      status: string;
    }>;
    if (projects.length === 0) return;

    const adminTeamIds = await resolveAdminTeamIds(
      projects.map((p) => p.team_id),
    );

    // Parents with at least one still-open child can't be closed yet —
    // pre-filter them out so the batch UPDATE stays single-statement.
    const { data: childRows } = await supabase
      .from("projects")
      .select("parent_project_id, status")
      .in(
        "parent_project_id",
        projects.map((p) => p.id),
      );
    const parentsWithOpenChildren = new Set<string>();
    for (const c of (childRows ?? []) as Array<{
      parent_project_id: string | null;
      status: string;
    }>) {
      if (c.parent_project_id && !TERMINAL_PROJECT_STATUSES.has(c.status)) {
        parentsWithOpenChildren.add(c.parent_project_id);
      }
    }

    const closable = projects
      .filter((p) => adminTeamIds.has(p.team_id))
      .filter((p) => !TERMINAL_PROJECT_STATUSES.has(p.status))
      .filter((p) => !parentsWithOpenChildren.has(p.id))
      .map((p) => p.id);

    if (closable.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "completed" })
        .in("id", closable),
    );

    revalidatePath("/projects");
    revalidatePath("/time-entries");
  }, "bulkCloseProjectsAction") as unknown as void;
}

/**
 * Bulk reopen — Undo from the bulk-close toast. Resets the given ids to
 * `active` (the stamping trigger clears their close stamps). Owner/admin
 * gated per team, mirroring `bulkCloseProjectsAction`. Like bulk
 * restore, this reopens to `active` rather than a captured pre-close
 * status — the same trade-off the archive Undo makes.
 */
export async function bulkReopenProjectsAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    const { data: rows } = await supabase
      .from("projects")
      .select("id, team_id")
      .in("id", ids);
    const projects = (rows ?? []) as Array<{ id: string; team_id: string }>;
    if (projects.length === 0) return;

    const adminTeamIds = await resolveAdminTeamIds(
      projects.map((p) => p.team_id),
    );
    const reopenable = projects
      .filter((p) => adminTeamIds.has(p.team_id))
      .map((p) => p.id);
    if (reopenable.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({ status: "active" })
        .in("id", reopenable),
    );

    revalidatePath("/projects");
    revalidatePath("/time-entries");
  }, "bulkReopenProjectsAction") as unknown as void;
}

/**
 * Unbilled, billable work still sitting on a project — surfaced in the
 * close-out prompt ("X unbilled — invoice before closing?"). Purely
 * informational; closing is never blocked on it (legitimate write-offs
 * and next-cycle billing exist). Hours + counts only, no dollar total,
 * to stay clear of the no-cross-currency-sum rule (time bills in the
 * team currency; expenses carry their own). RLS scopes both reads to
 * what the caller can see.
 */
export async function getProjectUnbilledSummaryAction(
  projectId: string,
): Promise<{
  timeMinutes: number;
  timeCount: number;
  expenseCount: number;
  /** The actual unbilled time entries (newest first) so the close-out
   *  prompt can SHOW which entries it's counting — not just a total the
   *  user can't verify. */
  timeEntries: Array<{
    id: string;
    startTime: string | null;
    description: string | null;
    minutes: number;
  }>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: timeRows, error: timeError } = await supabase
    .from("time_entries")
    .select("id, start_time, description, duration_min")
    .eq("project_id", projectId)
    .eq("invoiced", false)
    .eq("billable", true)
    .not("end_time", "is", null)
    .is("deleted_at", null)
    .order("start_time", { ascending: false });
  if (timeError) throw AppError.fromSupabase(timeError);
  const times = (timeRows ?? []) as Array<{
    id: string;
    start_time: string | null;
    description: string | null;
    duration_min: number | null;
  }>;
  const timeMinutes = times.reduce((sum, r) => sum + (r.duration_min ?? 0), 0);

  const { data: expenseRows, error: expenseError } = await supabase
    .from("expenses")
    .select("id")
    .eq("project_id", projectId)
    .eq("invoiced", false)
    .eq("billable", true)
    .is("deleted_at", null);
  if (expenseError) throw AppError.fromSupabase(expenseError);

  return {
    timeMinutes,
    timeCount: times.length,
    expenseCount: (expenseRows ?? []).length,
    timeEntries: times.map((r) => ({
      id: r.id,
      startTime: r.start_time,
      description: r.description,
      minutes: r.duration_min ?? 0,
    })),
  };
}

/**
 * Read-only fetch of `projects_history` for one project, paginated
 * newest-first. Used by the /projects/[id]/history page + dialog.
 *
 * RLS on `projects_history` already restricts SELECT to
 * `public.user_team_role(team_id) IN ('owner','admin')`. This action
 * trusts that and adds a friendly "you don't have access" envelope
 * around it so callers don't have to handle empty-when-not-admin as
 * a separate state.
 *
 * Actor display names are resolved in a single round-trip after the
 * page slice is selected — same shape as
 * `getBusinessIdentityHistoryAction`. Mirrors the existing audit
 * surfaces so future maintainers find one consistent pattern.
 */
export async function getProjectHistoryAction(
  projectId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ history: ProjectHistoryEntry[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  const fetchSize = limit + 1;

  const { data, error } = await supabase
    .from("projects_history")
    .select("id, operation, changed_at, changed_by_user_id, previous_state")
    .eq("project_id", projectId)
    .order("changed_at", { ascending: false })
    .range(offset, offset + fetchSize - 1);
  if (error) throw AppError.fromSupabase(error);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const trimmed = rows.slice(0, limit);

  // Resolve actor names in one round-trip.
  const actorIds = Array.from(
    new Set(
      trimmed
        .map((r) => r.changed_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const nameById = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of profiles ?? []) {
      nameById.set(
        p.user_id as string,
        (p.display_name as string | null) ?? null,
      );
    }
  }

  const history: ProjectHistoryEntry[] = trimmed.map((r) => ({
    id: r.id as string,
    operation: r.operation as "UPDATE" | "DELETE",
    changedAt: r.changed_at as string,
    changedBy: {
      userId: (r.changed_by_user_id as string | null) ?? null,
      displayName:
        nameById.get((r.changed_by_user_id as string | null) ?? "") ??
        null,
    },
    previousState: (r.previous_state as Record<string, unknown>) ?? {},
  }));

  return { history, hasMore };
}
