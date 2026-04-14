import { requireSystemAdmin } from "@/lib/system-admin";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Database, Building2 } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { SampleDataControls } from "./controls";

interface PageProps {
  searchParams: Promise<{ org?: string }>;
}

interface OrgCounts {
  customersTotal: number;
  customersSample: number;
  projectsTotal: number;
  projectsSample: number;
  entriesTotal: number;
  entriesSample: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
}

async function fetchCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<OrgCounts> {
  const [customersTotal, customersSample, projectsTotal, projectsSample, entriesTotal, entriesSample, firstEntry, lastEntry] = await Promise.all([
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_sample", true),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_sample", true),
    supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_sample", true),
    supabase
      .from("time_entries")
      .select("start_time")
      .eq("organization_id", orgId)
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select("start_time")
      .eq("organization_id", orgId)
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    customersTotal: customersTotal.count ?? 0,
    customersSample: customersSample.count ?? 0,
    projectsTotal: projectsTotal.count ?? 0,
    projectsSample: projectsSample.count ?? 0,
    entriesTotal: entriesTotal.count ?? 0,
    entriesSample: entriesSample.count ?? 0,
    firstEntryAt: (firstEntry.data?.start_time as string | undefined) ?? null,
    lastEntryAt: (lastEntry.data?.start_time as string | undefined) ?? null,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function SampleDataPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const t = await getTranslations("sampleData");
  const tc = await getTranslations("common");
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const sp = await searchParams;

  const selectedOrgId = sp.org ?? orgs[0]?.id ?? null;
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? null;
  const counts = selectedOrgId ? await fetchCounts(supabase, selectedOrgId) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Database size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId} />
      </div>

      <p className="text-sm text-content-secondary max-w-3xl">{t("subtitle")}</p>

      {!selectedOrgId || !selectedOrg || !counts ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-sm text-content-muted">
          {t("noOrg")}
        </div>
      ) : (
        <>
          {/* Current state summary */}
          <section className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-content-muted" />
              <h2 className="text-sm font-semibold text-content">{selectedOrg.name}</h2>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <CountBlock
                label={tc("nav.customers")}
                total={counts.customersTotal}
                sample={counts.customersSample}
                tSample={t("sampleLabel")}
              />
              <CountBlock
                label={tc("nav.projects")}
                total={counts.projectsTotal}
                sample={counts.projectsSample}
                tSample={t("sampleLabel")}
              />
              <CountBlock
                label={tc("nav.time")}
                total={counts.entriesTotal}
                sample={counts.entriesSample}
                tSample={t("sampleLabel")}
              />
            </dl>
            <div className="text-xs text-content-muted pt-1">
              {t("entryRange", {
                first: formatDate(counts.firstEntryAt),
                last: formatDate(counts.lastEntryAt),
              })}
            </div>
          </section>

          <SampleDataControls
            orgId={selectedOrgId}
            orgName={selectedOrg.name}
            hasSample={counts.entriesSample > 0 || counts.projectsSample > 0 || counts.customersSample > 0}
          />
        </>
      )}
    </div>
  );
}

function CountBlock({
  label,
  total,
  sample,
  tSample,
}: {
  label: string;
  total: number;
  sample: number;
  tSample: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </dt>
      <dd className="mt-1">
        <span className="text-2xl font-bold text-content tabular-nums">{total}</span>
        {sample > 0 && (
          <span className="ml-2 text-xs text-content-muted">
            · {sample} {tSample}
          </span>
        )}
      </dd>
    </div>
  );
}
