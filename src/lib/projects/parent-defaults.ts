/**
 * Field defaults a sub-project pre-fills from its parent.
 *
 * Two surfaces consume this:
 *   - the New project form, which pre-populates inputs when the user
 *     picks a parent (visible to the user, who can override before
 *     saving);
 *   - the create-project server action, which silently inherits
 *     fields the form doesn't expose (currently `jira_project_key`)
 *     so the child rows in `projects` carry the parent's value
 *     without the user having to type it.
 *
 * The list intentionally excludes:
 *   - `name` / `description` — phase-specific by definition;
 *   - `budget_hours` — a parent budget would be a CAP across all
 *     children rather than a per-child default; pre-filling it would
 *     suggest the same number for every phase, which is wrong;
 *   - `customer_id` / `is_internal` — already trigger-enforced to
 *     match the parent (so they're not "inherited" — they're
 *     constrained);
 *   - `status` — phase lifecycle is independent (a phase can be
 *     archived without the parent);
 *   - `extension_category_set_id` — project-scoped extension sets
 *     are identified by `project_id`, so a child can't share the
 *     parent's. Cloning categories would be a separate, deliberate
 *     action.
 *
 * Mutating this list changes default behavior on a fresh sub-
 * project — flag any addition / removal in the sub-projects roadmap
 * doc.
 */

export interface ParentInheritableFields {
  hourly_rate: number | null;
  default_billable: boolean;
  github_repo: string | null;
  jira_project_key: string | null;
  invoice_code: string | null;
  category_set_id: string | null;
  require_timestamps: boolean;
}

/**
 * Coerce a parent row's relevant columns into the typed shape the
 * form + action expect. Tolerant of nulls / undefineds since the
 * Supabase select can return `null` for any optional column.
 */
export function readParentInheritableFields(
  parent: {
    hourly_rate?: number | string | null;
    default_billable?: boolean | null;
    github_repo?: string | null;
    jira_project_key?: string | null;
    invoice_code?: string | null;
    category_set_id?: string | null;
    require_timestamps?: boolean | null;
  } | null,
): ParentInheritableFields | null {
  if (!parent) return null;
  return {
    hourly_rate:
      parent.hourly_rate == null
        ? null
        : typeof parent.hourly_rate === "number"
          ? parent.hourly_rate
          : Number(parent.hourly_rate),
    // Booleans default to `false` when the column is null — matches
    // how the existing form treats an unset checkbox.
    default_billable: parent.default_billable ?? false,
    github_repo: parent.github_repo ?? null,
    jira_project_key: parent.jira_project_key ?? null,
    invoice_code: parent.invoice_code ?? null,
    category_set_id: parent.category_set_id ?? null,
    require_timestamps: parent.require_timestamps ?? false,
  };
}

/**
 * Form-input shape for the inheritable subset. Strings (not numbers /
 * booleans) for the text/number fields because the New project form
 * keeps them as raw input strings — coercion happens at submit time
 * via parseFloat / FormData. Keeps this helper symmetric with what
 * the form's `useState` slots actually hold.
 */
export interface InheritableFormValues {
  hourly_rate: string;
  github_repo: string;
  invoice_code: string;
  category_set_id: string;
  default_billable: boolean;
  require_timestamps: boolean;
}

/**
 * Whether each inheritable field has been edited by the user in the
 * current session. A `true` flag locks that field — a later parent
 * pick will NOT clobber the user's typed value.
 */
export interface InheritableTouched {
  hourly_rate: boolean;
  github_repo: boolean;
  invoice_code: boolean;
  category_set_id: boolean;
  default_billable: boolean;
  require_timestamps: boolean;
}

/**
 * Compute the form values to render after a parent pick: untouched
 * fields take the parent's value (or "" / false fallback when the
 * parent has none); touched fields keep what the user typed.
 *
 * Returns a flag alongside the merged values: `appliedAny` is true
 * when at least one untouched field actually received a non-empty
 * parent value, which the form uses to decide whether to render the
 * "Filled from parent" hint.
 *
 * Pure — no side effects on the inputs. The form drives state from
 * the returned object.
 */
export function applyParentDefaults(
  defaults: ParentInheritableFields,
  current: InheritableFormValues,
  touched: InheritableTouched,
): { values: InheritableFormValues; appliedAny: boolean } {
  let appliedAny = false;
  const next: InheritableFormValues = { ...current };

  if (!touched.hourly_rate) {
    next.hourly_rate =
      defaults.hourly_rate != null ? String(defaults.hourly_rate) : "";
    if (defaults.hourly_rate != null) appliedAny = true;
  }
  if (!touched.github_repo) {
    next.github_repo = defaults.github_repo ?? "";
    if (defaults.github_repo) appliedAny = true;
  }
  if (!touched.invoice_code) {
    next.invoice_code = defaults.invoice_code ?? "";
    if (defaults.invoice_code) appliedAny = true;
  }
  if (!touched.category_set_id) {
    next.category_set_id = defaults.category_set_id ?? "";
    if (defaults.category_set_id) appliedAny = true;
  }
  if (!touched.default_billable) {
    next.default_billable = defaults.default_billable;
    // Booleans always count — flipping false → false on an inherit
    // is still an inherited choice, and the user-visible hint ("we
    // pulled values from the parent") should fire either way so
    // they know the row was inspected. Avoids the surprise where a
    // parent with default_billable=false fills nothing visible.
    appliedAny = true;
  }
  if (!touched.require_timestamps) {
    next.require_timestamps = defaults.require_timestamps;
    appliedAny = true;
  }

  return { values: next, appliedAny };
}
