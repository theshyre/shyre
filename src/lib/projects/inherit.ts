/**
 * LIVE parent→child setting inheritance for nested projects.
 *
 * A child project whose own column is NULL resolves that setting from
 * its parent at READ time — the parent stays the source of truth and a
 * later parent change propagates to every inheriting child. Setting a
 * child's own value overrides the inheritance; clearing it re-inherits.
 * (Contrast with `parent-defaults.ts`, which COPIES values into the
 * New-project form at creation — a copied value is an override under
 * this model. Proposal-convert deliberately copies nothing.)
 *
 * v1 inherited fields:
 *   - category vocabulary: `category_set_id` (base set), and with it the
 *     parent's `extension_category_set_id` + `default_category_id` —
 *     the vocabulary travels as a UNIT. A child with its OWN base set
 *     inherits none of the parent's vocabulary.
 *   - `jira_project_key` — ticket detection on child entries resolves
 *     against the umbrella's key (AVDR: `AE-709` on a deliverable).
 *
 * Deliberately NOT inherited:
 *   - billing fields (rate / mode / fixed_price / budgets /
 *     default_billable) — per-deliverable by design: fixed-bid children
 *     legitimately live under an hourly umbrella;
 *   - `github_repo` on the agent API surface — the agent's repo→project
 *     map must resolve to ONE project, so `api_list_projects` returns
 *     only own values (ticket detection inherits it separately);
 *   - NOT-NULL booleans (`require_timestamps`, rate visibility) — no
 *     "unset" state to mean inherit; needs a tri-state refactor first.
 *
 * Hierarchy is one level deep (DB-enforced), so resolution is a single
 * parent lookup — no recursion.
 *
 * The DB mirrors this rule in `validate_time_entry_category`,
 * `api_list_projects`, and `api_log_entry`
 * (migration 20260723100000_project_setting_inheritance.sql). The two
 * layers must move together.
 */

export interface InheritableProjectFields {
  id: string;
  parent_project_id: string | null;
  category_set_id: string | null;
  extension_category_set_id: string | null;
  default_category_id?: string | null;
  jira_project_key: string | null;
}

/**
 * Resolve inherited fields for every project in `rows` (children find
 * parents within the same array — pass the full team list). Returns new
 * objects; input is not mutated. A child whose parent is absent from
 * `rows` (e.g. filtered out upstream) keeps its own values — the DB
 * layer remains authoritative for writes.
 */
export function resolveProjectInheritance<T extends InheritableProjectFields>(
  rows: T[],
): T[] {
  const byId = new Map(rows.map((p) => [p.id, p]));
  return rows.map((p) => {
    if (!p.parent_project_id) return p;
    const parent = byId.get(p.parent_project_id);
    if (!parent) return p;

    const next = { ...p };
    // The category vocabulary travels as a unit: only a child with NO
    // base set of its own inherits, and it inherits the parent's whole
    // vocabulary (base + extension + default). A child that owns a base
    // set keeps its own vocabulary — but its own extension set still
    // applies regardless.
    if (!p.category_set_id && parent.category_set_id) {
      next.category_set_id = parent.category_set_id;
      // Single-slot limitation: the app models a project's extension set
      // as ONE column, so an inheriting child that ALSO has its own
      // extension surfaces only its own (own ?? parent), never the union.
      // The DB (validate_time_entry_category / api_log_entry) unions both,
      // so this only ever UNDER-offers in the picker — a category the DB
      // would accept may not be surfaced. Safe direction (no rejected
      // write); the union case is rare (inheriting child + own extension).
      next.extension_category_set_id =
        p.extension_category_set_id ?? parent.extension_category_set_id;
      if ("default_category_id" in p) {
        next.default_category_id =
          p.default_category_id ?? parent.default_category_id ?? null;
      }
    }
    if (!p.jira_project_key && parent.jira_project_key) {
      next.jira_project_key = parent.jira_project_key;
    }
    return next;
  });
}
