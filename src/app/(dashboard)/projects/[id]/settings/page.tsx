import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { loadProject } from "../load-project";
import { ProjectEditForm, type Project } from "../project-edit-form";
import { ProjectClassification } from "../project-classification";
import { ProjectCategoriesEditor } from "../project-categories-editor";
import { MapLineHelper } from "../map-line-helper";
import { ProjectSettingsNav } from "./project-settings-nav";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  const t = await getTranslations("projects.sectionNav");
  return {
    title: `${t("settings")} — ${(project.row.name as string | null) ?? ""}`,
  };
}

/**
 * /projects/[id]/settings — every project setting on one
 * scrollable page, broken into anchor-linked sections:
 *
 *   1. Identity / Billing / Budget / Integrations (the existing
 *      ProjectEditForm — sectioned-from-within is a follow-up;
 *      visible breaks via the anchor TOC + section ids is the
 *      immediate win)
 *   2. Classification — internal vs client + customer picker
 *   3. Categories — base set + project-scoped extensions
 *
 * No budget masthead here. The masthead shows OUTPUT (current
 * burn vs caps); the form below it edits the INPUTS that feed
 * those outputs. Stacking them on Settings would read confusingly
 * — solo-consultant review caught this.
 *
 * Persona caveat: the ProjectEditForm itself is ~20 fields with
 * no internal section breaks. The next polish pass should split
 * its render into Identity / Billing / Budget / Integrations
 * panels so the TOC anchors actually land at the right spot. For
 * now the anchors land at the form root + the two follow-on
 * sections; the inside-form jump is approximate.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const project = await loadProject(id);
  const supabase = await createClient();
  const tSet = await getTranslations("projects.settings");

  // Children — drives the "this project has its own sub-projects"
  // disable for the parent-project picker on the form.
  const { data: childRows } = await supabase
    .from("projects_v")
    .select("id")
    .eq("parent_project_id", id);
  const hasChildren = (childRows ?? []).length > 0;

  // Eligible parent projects — same team + same customer, top-level
  // only, not this project itself. Matches the original page's
  // pre-fetch verbatim so the form's picker stays in parity.
  const { data: eligibleParents } = project.customer
    ? await supabase
        .from("projects_v")
        .select("id, name, customer_id")
        .eq("team_id", project.teamId)
        .eq("customer_id", project.customer.id)
        .neq("status", "archived")
        .is("parent_project_id", null)
        .neq("id", id)
        .order("name")
    : { data: [] };

  // Parent row + inheritable fields when this project IS a child —
  // drives the "Apply parent's settings" affordance on the form.
  let parentRef: {
    id: string;
    name: string;
    hourly_rate: number | string | null;
    default_billable: boolean | null;
    github_repo: string | null;
    jira_project_key: string | null;
    invoice_code: string | null;
    category_set_id: string | null;
    require_timestamps: boolean | null;
  } | null = null;
  if (project.row.parent_project_id) {
    const { data: parentRow } = await supabase
      .from("projects_v")
      .select(
        "id, name, hourly_rate, default_billable, github_repo, jira_project_key, invoice_code, category_set_id, require_timestamps",
      )
      .eq("id", project.row.parent_project_id as string)
      .maybeSingle();
    if (parentRow) {
      parentRef = {
        id: parentRow.id as string,
        name: parentRow.name as string,
        hourly_rate: parentRow.hourly_rate as number | string | null,
        default_billable: parentRow.default_billable as boolean | null,
        github_repo: parentRow.github_repo as string | null,
        jira_project_key: parentRow.jira_project_key as string | null,
        invoice_code: parentRow.invoice_code as string | null,
        category_set_id: parentRow.category_set_id as string | null,
        require_timestamps: parentRow.require_timestamps as boolean | null,
      };
    }
  }

  // Customers on the same team — drives the Classification picker
  // for switching between internal / customer work.
  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name")
    .eq("team_id", project.teamId)
    .eq("archived", false)
    .order("name");
  const customerOptions = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  // Category sets + project-scoped extensions — drives the
  // Categories editor.
  const categorySetsFull = await getVisibleCategorySets(project.teamId);
  const categorySets = categorySetsFull.map(
    ({
      id: setId,
      team_id,
      name,
      description,
      is_system,
      created_by,
      created_at,
    }) => ({
      id: setId,
      team_id,
      name,
      description,
      is_system,
      created_by,
      created_at,
    }),
  );
  const { data: projectSet } = await supabase
    .from("category_sets")
    .select("id, name, categories(id, name, color, sort_order)")
    .eq("project_id", id)
    .maybeSingle();
  const projectSetCategories =
    projectSet && Array.isArray(projectSet.categories)
      ? (
          projectSet.categories as Array<{
            id: string;
            name: string;
            color: string;
            sort_order: number;
          }>
        )
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
      : [];

  let baseSetName: string | null = null;
  let baseCategories: Array<{ id: string; name: string; color: string }> = [];
  if (project.row.category_set_id) {
    const { data: baseSet } = await supabase
      .from("category_sets")
      .select("name, categories(id, name, color, sort_order)")
      .eq("id", project.row.category_set_id as string)
      .maybeSingle();
    baseSetName = (baseSet?.name as string) ?? null;
    if (baseSet && Array.isArray(baseSet.categories)) {
      baseCategories = (
        baseSet.categories as Array<{
          id: string;
          name: string;
          color: string;
          sort_order: number;
        }>
      )
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id: cid, name: cname, color }) => ({
          id: cid,
          name: cname,
          color,
        }));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <ProjectSettingsNav />

      <div className="space-y-8 min-w-0">
        <section id="settings-details" aria-labelledby="settings-details-heading">
          <h2
            id="settings-details-heading"
            className="text-title font-semibold text-content mb-3"
          >
            {tSet("details.heading")}
          </h2>
          <ProjectEditForm
            project={project.row as unknown as Project}
            eligibleParents={(eligibleParents ?? []) as Array<{
              id: string;
              name: string;
              customer_id: string | null;
            }>}
            hasChildren={hasChildren}
            parent={parentRef}
          />
        </section>

        <section
          id="settings-classification"
          aria-labelledby="settings-classification-heading"
        >
          <h2
            id="settings-classification-heading"
            className="text-title font-semibold text-content mb-3"
          >
            {tSet("classification.heading")}
          </h2>
          <ProjectClassification
            projectId={id}
            isInternal={project.isInternal}
            defaultBillable={project.row.default_billable !== false}
            currentCustomerId={
              (project.row.customer_id as string | null) ?? null
            }
            customers={customerOptions}
          />
        </section>

        <section
          id="settings-categories"
          aria-labelledby="settings-categories-heading"
        >
          <h2
            id="settings-categories-heading"
            className="text-title font-semibold text-content mb-3"
          >
            {tSet("categories.heading")}
          </h2>
          <ProjectCategoriesEditor
            projectId={id}
            setId={projectSet?.id ?? null}
            setName={projectSet?.name ?? ""}
            initialCategories={projectSetCategories}
            initialBaseSetId={
              (project.row.category_set_id as string | null) ?? null
            }
            baseSetName={baseSetName}
            baseCategories={baseCategories}
            availableSets={categorySets.map((s) => ({
              id: s.id,
              name: s.name,
              is_system: s.is_system,
            }))}
            initialDefaultCategoryId={
              (project.row.default_category_id as string | null) ?? null
            }
            inheritedBase={
              // No base set of its own + a parent that has one → the
              // parent's vocabulary applies LIVE (inherit.ts); name the
              // inherited set in the caption. categorySets holds all
              // system + team sets, so the parent's base is resolvable.
              !project.row.category_set_id &&
              parentRef?.category_set_id
                ? {
                    parentName: parentRef.name,
                    setName:
                      categorySets.find(
                        (s) => s.id === parentRef?.category_set_id,
                      )?.name ?? "",
                  }
                : null
            }
          />
        </section>

        <section
          id="settings-tracking"
          aria-labelledby="settings-tracking-heading"
        >
          <h2
            id="settings-tracking-heading"
            className="text-title font-semibold text-content mb-3"
          >
            {tSet("tracking.heading")}
          </h2>
          <MapLineHelper
            githubRepo={(project.row.github_repo as string | null) ?? null}
            projectId={id}
          />
        </section>
      </div>
    </div>
  );
}
