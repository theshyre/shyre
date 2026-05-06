"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { normalizeGithubRepo } from "@/lib/projects/normalize";

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
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = normalizeGithubRepo(formData.get("github_repo"));
    const jira_project_key = normalizeJiraKey(formData.get("jira_project_key"));
    const invoice_code = normalizeInvoiceCode(formData.get("invoice_code"));
    const status = formData.get("status") as string;
    const category_set_id = (formData.get("category_set_id") as string) || null;
    const require_timestamps = formData.get("require_timestamps") === "on";

    const patch: Record<string, unknown> = {
      name,
      description,
      budget_hours,
      github_repo,
      jira_project_key,
      invoice_code,
      status,
      category_set_id,
      require_timestamps,
    };

    // Parent project re-parenting — only when the field is present on
    // the form (otherwise we leave the existing relationship alone).
    // Empty string normalizes to NULL ("detach from parent"). The DB
    // trigger validates same-customer + same-team + 1-level-deep + no
    // self-ref + no cycle.
    if (formData.has("parent_project_id")) {
      const raw = formData.get("parent_project_id") as string;
      patch.parent_project_id = raw === "" ? null : raw;
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

    // Guardrail: only include hourly_rate in the UPDATE if the caller is
    // authorized by rate_editability. Existing form submissions and
    // forged direct POSTs that include hourly_rate for an unauthorized
    // caller get silently dropped — the rest of the update applies so
    // a non-rate edit still succeeds. The dedicated setProjectRateAction
    // below is the right path for rate-only updates.
    if (formData.has("hourly_rate")) {
      const { data: canSet } = await supabase.rpc("can_set_project_rate", {
        p_project_id: id,
      });
      if (canSet) {
        const rateStr = formData.get("hourly_rate") as string;
        patch.hourly_rate = rateStr ? parseFloat(rateStr) : null;
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
