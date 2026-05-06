"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle,
  ArrowRight,
  Upload,
  Eye,
  Users,
  FolderKanban,
  Clock,
  AlertTriangle,
  UserCog,
  FileText,
  Loader2,
} from "lucide-react";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { InlineErrorCard } from "@/components/InlineErrorCard";
import { DateField, type DateFieldPreset } from "@/components/DateField";
import type { TeamListItem } from "@/lib/team-context";

type Step = "credentials" | "preview" | "importing" | "done";

type UserMapChoice = string | "importer" | "skip" | "shell";

interface HarvestUserSummary {
  id: number;
  name: string;
  email: string | null;
  entryCount: number;
}

interface ShyreMemberSummary {
  user_id: string;
  email: string | null;
  display_name: string | null;
}

interface BusinessPersonSummary {
  id: string;
  legal_name: string;
  preferred_name: string | null;
  work_email: string | null;
  employment_type: string;
}

interface PreviewData {
  companyName: string;
  timeZone: string;
  customers: number;
  projects: number;
  timeEntries: number;
  invoices: number;
  invoiceLineItems: number;
  categoryCount: number;
  customerNames: string[];
  projectNames: string[];
  /** Per-entity counts of rows that ALREADY exist in Shyre (matched
   *  by Harvest source id). The import upserts those in place
   *  rather than creating duplicates. Drives the "N new · M will
   *  refresh" preview text so the user can tell at a glance
   *  whether a re-import will land fresh data or just refresh
   *  what's there. */
  existingMatches?: {
    customers: number;
    projects: number;
    timeEntries: number;
    invoices: number;
  };
  harvestUsers: HarvestUserSummary[];
  shyreMembers: ShyreMemberSummary[];
  businessPeople: BusinessPersonSummary[];
  /** Caller's display_name from user_profiles. Drives the "Me (Marcus
   *  Malcom)" label in the mapping dropdown. */
  callerDisplayName: string | null;
  /** Caller's auth user id. Used to filter the caller out of the
   *  "Shyre team members" optgroup so they aren't a duplicate of the
   *  "Me" option (both resolve to the same person). */
  callerUserId: string;
  defaultMapping: Record<string, UserMapChoice>;
}

interface ReconciliationPerCustomer {
  name: string;
  harvestHours: number;
  shyreHours: number;
  harvestEntries: number;
  shyreEntries: number;
  match: boolean;
}

interface Reconciliation {
  harvest: { entries: number; hours: number };
  shyre: { entries: number; hours: number };
  missing: {
    count: number;
    hours: number;
    reasonsByCount: Record<string, number>;
  };
  match: boolean;
  perCustomer: ReconciliationPerCustomer[];
}

interface ImportResult {
  importRunId: string;
  imported: {
    customers: number;
    projects: number;
    invoices: number;
    invoiceLineItems: number;
    timeEntries: number;
  };
  skipped: {
    timeEntries: number;
    reasons: Record<string, number>;
  };
  errors: string[];
  reconciliation?: Reconciliation;
  /** Date range covered by the Harvest entries this pull asked for —
   *  independent of how many landed (so a partially-rejected import
   *  still shows the window the user attempted). NULL when no time
   *  entries were in the response. */
  entryDateRange?: {
    earliest: string | null;
    latest: string | null;
  };
}

/**
 * Structured error body the route returns on failure. Matches the
 * shape produced by `errorResponse()` in the route handler. The
 * short `error` message drives the InlineErrorCard title; `detail`
 * (the capped raw response body) goes behind the Show details
 * toggle and into the clipboard on Copy details.
 */
interface ApiErrorBody {
  error: string;
  errorCode?: string;
  status?: number;
  endpoint?: string;
  detail?: string;
}

/**
 * Date presets for the import range. The going-live checklist
 * recommends importing year-by-year (current YTD first, then last
 * full year, etc.) — these presets one-click-fill the corresponding
 * "from" / "to" boundaries.
 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Locale-friendly date for the post-import summary's "Covers …"
 *  line. Year omitted when it matches the current year. spent_date
 *  is YYYY-MM-DD (calendar-only, no clock), parsed in local TZ. */
function formatSummaryDate(yyyymmdd: string): string {
  const parts = yyyymmdd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return yyyymmdd;
  const [y, m, d] = parts;
  const sameYear = y === new Date().getFullYear();
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function importFromPresets(): DateFieldPreset[] {
  const year = new Date().getFullYear();
  return [
    { label: `Jan 1, ${year}`, value: `${year}-01-01` },
    { label: `Jan 1, ${year - 1}`, value: `${year - 1}-01-01` },
    { label: `Jan 1, ${year - 2}`, value: `${year - 2}-01-01` },
  ];
}
function importToPresets(): DateFieldPreset[] {
  const year = new Date().getFullYear();
  return [
    { label: "Today", value: isoToday() },
    { label: `Dec 31, ${year - 1}`, value: `${year - 1}-12-31` },
    { label: `Dec 31, ${year - 2}`, value: `${year - 2}-12-31` },
  ];
}

/**
 * Surface HTTP failures with the actual status code so users get a
 * meaningful error instead of "Connection failed" when the platform
 * (not the route handler) returns a non-JSON 5xx — e.g. Vercel's
 * function-timeout HTML page when an import exceeds maxDuration.
 *
 * - 2xx with valid JSON → typed payload.
 * - non-2xx with JSON body → ApiErrorBody (preserves errorCode/detail).
 * - non-2xx with non-JSON body → ApiErrorBody synthesised from status.
 * - 2xx with malformed JSON → ApiErrorBody flagging the bad response.
 */
async function parseImportResponse<T extends object>(
  res: Response,
  fallbackMessage: string,
): Promise<T | ApiErrorBody> {
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      // Non-JSON error body (HTML timeout page, gateway error, etc.)
    }
    return {
      error: body.error ?? `${fallbackMessage} (HTTP ${res.status})`,
      status: res.status,
      ...(body.errorCode ? { errorCode: body.errorCode } : {}),
      ...(body.endpoint ? { endpoint: body.endpoint } : {}),
      ...(body.detail ? { detail: body.detail } : {}),
    };
  }
  try {
    return (await res.json()) as T;
  } catch {
    return {
      error: `${fallbackMessage} (invalid response)`,
      status: res.status,
    };
  }
}

export function HarvestImport({
  teams,
}: {
  teams: TeamListItem[];
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("credentials");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [userMapping, setUserMapping] = useState<Record<number, UserMapChoice>>(
    {},
  );
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleValidate(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const validateRes = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: teamId,
          action: "validate",
        }),
      });
      const validateData = await parseImportResponse<{
        valid: boolean;
        error?: string;
      }>(validateRes, "Could not validate Harvest credentials");

      // Discriminate on `valid` (not `error`): both ApiErrorBody and
      // the route's validate-failure body carry an optional `error`,
      // so `"error" in` doesn't narrow. The success body is the only
      // one that omits `valid`.
      if (!("valid" in validateData)) {
        setError(validateData);
        setLoading(false);
        return;
      }
      if (!validateData.valid) {
        setError({ error: validateData.error ?? "Invalid credentials" });
        setLoading(false);
        return;
      }

      const previewRes = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: teamId,
          action: "preview",
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      });
      const previewData = await parseImportResponse<PreviewData>(
        previewRes,
        "Could not load Harvest preview",
      );

      if ("error" in previewData) {
        setError(previewData);
        setLoading(false);
        return;
      }

      setPreview(previewData);
      // Seed local mapping state from the server's default proposal.
      const initial: Record<number, UserMapChoice> = {};
      for (const [k, v] of Object.entries(previewData.defaultMapping)) {
        initial[Number(k)] = v;
      }
      setUserMapping(initial);
      setStep("preview");
    } catch (err) {
      setError({
        error: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(): Promise<void> {
    if (!preview) return;
    setStep("importing");
    setError(null);

    try {
      const payload: Record<string, UserMapChoice> = {};
      for (const [k, v] of Object.entries(userMapping)) payload[String(k)] = v;

      const res = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: teamId,
          action: "import",
          timeZone: preview.timeZone,
          userMapping: payload,
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      });
      const data = await parseImportResponse<ImportResult>(
        res,
        "Import failed",
      );

      if ("error" in data) {
        setError(data);
        setStep("preview");
        return;
      }

      setResult(data);
      setStep("done");
    } catch (err) {
      setError({
        error: err instanceof Error ? err.message : "Import failed",
      });
      setStep("preview");
    }
  }

  return (
    <div className="mt-6">
      <div className="rounded-lg border border-edge bg-surface-raised p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-soft">
            <Upload size={20} className="text-warning" />
          </div>
          <div>
            <h2 className="font-semibold text-content">Harvest</h2>
            <p className="text-caption text-content-muted">
              Import customers, projects, tasks, and time entries from Harvest
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 text-caption text-content-muted">
          <StepIndicator
            label="Connect"
            active={step === "credentials"}
            done={step !== "credentials"}
          />
          <ArrowRight size={12} />
          <StepIndicator
            label="Review & map"
            active={step === "preview"}
            done={step === "importing" || step === "done"}
          />
          <ArrowRight size={12} />
          <StepIndicator
            label="Import"
            active={step === "importing"}
            done={step === "done"}
          />
        </div>

        {error && (
          <div className="mb-4">
            <InlineErrorCard
              title={error.error}
              detail={error.detail}
              context={buildErrorContext(error)}
              onRetry={() => {
                setError(null);
                if (step === "credentials") {
                  void handleValidate();
                } else if (step === "preview") {
                  void handleImport();
                }
              }}
            />
          </div>
        )}

        {step === "credentials" && (
          <CredentialsStep
            token={token}
            setToken={setToken}
            accountId={accountId}
            setAccountId={setAccountId}
            teamId={teamId}
            setTeamId={setTeamId}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            teams={teams}
            loading={loading}
            onSubmit={handleValidate}
          />
        )}

        {step === "preview" && preview && (
          <PreviewStep
            preview={preview}
            userMapping={userMapping}
            setUserMapping={setUserMapping}
            onImport={handleImport}
            onBack={() => {
              setStep("credentials");
              setPreview(null);
            }}
          />
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2
              className="h-8 w-8 animate-spin text-accent"
              aria-label="Loading"
              role="status"
            />
            <p className="text-body-lg text-content-secondary">
              Importing data from Harvest...
            </p>
            <p className="text-caption text-content-muted">
              This may take a minute for large accounts. Shyre retries
              automatically when Harvest rate-limits us.
            </p>
          </div>
        )}

        {step === "done" && result && (
          <DoneStep
            result={result}
            onAnother={() => {
              // Keep credentials + team in state (the user is most
              // likely importing another date range from the same
              // Harvest account) but reset the date inputs, preview,
              // mapping, and result so the form starts clean. Land
              // on the credentials step so the user sees the date
              // pickers again.
              setFromDate("");
              setToDate("");
              setPreview(null);
              setUserMapping({});
              setResult(null);
              setError(null);
              setStep("credentials");
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Map the structured fields returned by the route into the
 * `context` dict rendered by InlineErrorCard. We only include keys
 * that have values so the card doesn't show "—" rows. */
function buildErrorContext(err: ApiErrorBody): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (err.status !== undefined) ctx.status = String(err.status);
  if (err.endpoint) ctx.endpoint = err.endpoint;
  if (err.errorCode) ctx.kind = err.errorCode;
  return ctx;
}

// ────────────────────────────────────────────────────────────────
// Steps
// ────────────────────────────────────────────────────────────────

function CredentialsStep({
  token,
  setToken,
  accountId,
  setAccountId,
  teamId,
  setTeamId,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  teams,
  loading,
  onSubmit,
}: {
  token: string;
  setToken: (v: string) => void;
  accountId: string;
  setAccountId: (v: string) => void;
  teamId: string;
  setTeamId: (v: string) => void;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  teams: TeamListItem[];
  loading: boolean;
  onSubmit: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-body-lg text-content-secondary">
        Create a Personal Access Token at{" "}
        <a
          href="https://id.getharvest.com/developers"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          id.getharvest.com/developers
        </a>
        . You&apos;ll need the token and your Account ID.
      </p>

      <div className="space-y-3">
        <div>
          <label htmlFor="harvest-token" className={labelClass}>
            Personal Access Token *
          </label>
          <input
            id="harvest-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Your Harvest API token"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="harvest-account-id" className={labelClass}>
            Account ID *
          </label>
          <input
            id="harvest-account-id"
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Your Harvest Account ID (numeric)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="harvest-team" className={labelClass}>
            Import into Team
          </label>
          {teams.length === 1 ? (
            <input
              id="harvest-team"
              type="text"
              value={teams[0]?.name ?? ""}
              disabled
              className={inputClass}
            />
          ) : (
            <select
              id="harvest-team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className={selectClass}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="rounded-md border border-edge-muted bg-surface p-3">
          <div className="text-label font-semibold uppercase text-content-muted mb-2">
            Date range (optional)
          </div>
          <p className="text-caption text-content-muted mb-3">
            Limits which time entries get imported. Leave blank to import
            all time. Use a range (e.g. a single year) if your Harvest
            account has thousands of entries — keeps each import well
            under the 5-minute request limit and easier to roll back.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>From</label>
              <DateField
                value={fromDate}
                onChange={setFromDate}
                ariaLabel="Import range start"
                presets={importFromPresets()}
                max={toDate || undefined}
              />
            </div>
            <div>
              <label className={labelClass}>To</label>
              <DateField
                value={toDate}
                onChange={setToDate}
                ariaLabel="Import range end"
                presets={importToPresets()}
                min={fromDate || undefined}
              />
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !token || !accountId}
        className={buttonPrimaryClass}
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Eye size={16} />
        )}
        {loading ? "Connecting..." : "Connect & preview"}
      </button>
    </div>
  );
}

function PreviewStep({
  preview,
  userMapping,
  setUserMapping,
  onImport,
  onBack,
}: {
  preview: PreviewData;
  userMapping: Record<number, UserMapChoice>;
  setUserMapping: (
    fn: (prev: Record<number, UserMapChoice>) => Record<number, UserMapChoice>,
  ) => void;
  onImport: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const totalRows =
    preview.customers +
    preview.projects +
    preview.timeEntries +
    preview.invoices +
    preview.invoiceLineItems;
  const noTimeEntries = preview.timeEntries === 0;

  if (totalRows === 0) {
    return (
      <div className="space-y-5">
        {preview.companyName && (
          <p className="text-body-lg text-content-secondary">
            Connected to{" "}
            <strong className="text-content">{preview.companyName}</strong>
            {" · "}
            <span className="text-content-muted font-mono text-caption">
              {preview.timeZone}
            </span>
          </p>
        )}
        <div className="rounded-lg border border-edge-muted bg-surface p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-warning-soft">
            <AlertTriangle size={20} className="text-warning" />
          </div>
          <h3 className="text-body font-medium text-content mb-1">
            Nothing to import
          </h3>
          <p className="text-caption text-content-muted max-w-md mx-auto">
            Harvest returned no customers, projects, time entries, or invoices
            for this account. Go back and adjust the date range — or
            double-check that you connected the right Harvest account.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onBack} className={buttonSecondaryClass}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {preview.companyName && (
        <p className="text-body-lg text-content-secondary">
          Connected to{" "}
          <strong className="text-content">{preview.companyName}</strong>
          {" · "}
          <span className="text-content-muted font-mono text-caption">
            {preview.timeZone}
          </span>
        </p>
      )}

      {noTimeEntries && (
        <div className="rounded-md border border-warning/40 bg-warning-soft/40 p-3 text-caption text-content-secondary flex items-start gap-2">
          <AlertTriangle
            size={14}
            className="text-warning shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>
            <strong className="text-content">No time entries</strong> in this
            date range — only customers, projects, and categories will land.
            Go back to adjust the dates if you expected entries.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <PreviewCard
          icon={Users}
          label="Customers"
          count={preview.customers}
          names={preview.customerNames}
          existing={preview.existingMatches?.customers}
        />
        <PreviewCard
          icon={FolderKanban}
          label="Projects"
          count={preview.projects}
          names={preview.projectNames}
          existing={preview.existingMatches?.projects}
        />
        <PreviewCard
          icon={Clock}
          label="Time entries"
          count={preview.timeEntries}
          names={[]}
          existing={preview.existingMatches?.timeEntries}
        />
        <PreviewCard
          icon={FileText}
          label="Invoices"
          count={preview.invoices}
          names={[]}
          existing={preview.existingMatches?.invoices}
        />
        <PreviewCard
          icon={UserCog}
          label="Categories (tasks)"
          count={preview.categoryCount}
          names={[]}
        />
      </div>

      {preview.harvestUsers.length > 0 && (
        <UserMappingTable
          harvestUsers={preview.harvestUsers}
          shyreMembers={preview.shyreMembers}
          businessPeople={preview.businessPeople}
          callerDisplayName={preview.callerDisplayName}
          callerUserId={preview.callerUserId}
          mapping={userMapping}
          setMapping={setUserMapping}
        />
      )}

      <div className="rounded-md border border-edge-muted bg-surface p-3 text-caption text-content-muted space-y-1">
        <p>
          <strong className="text-content-secondary">
            Idempotent re-runs.
          </strong>{" "}
          Already-imported rows are dedup&apos;d by their Harvest id — running
          the importer twice won&apos;t double your data.
        </p>
        <p>
          <strong className="text-content-secondary">Time zone.</strong> Times
          are parsed in the Harvest account&apos;s zone (
          <span className="font-mono">{preview.timeZone}</span>) and stored as
          UTC. DST is handled correctly.
        </p>
        <p>
          <strong className="text-content-secondary">
            Archived projects.
          </strong>{" "}
          Inactive projects in Harvest come in as <em>archived</em> so their
          historical entries still have somewhere to attach.
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={onImport} className={buttonPrimaryClass}>
          <Upload size={16} />
          Import {totalRows} records
        </button>
        <button onClick={onBack} className={buttonSecondaryClass}>
          Back
        </button>
      </div>
    </div>
  );
}

function UserMappingTable({
  harvestUsers,
  shyreMembers,
  businessPeople,
  callerDisplayName,
  callerUserId,
  mapping,
  setMapping,
}: {
  harvestUsers: HarvestUserSummary[];
  shyreMembers: ShyreMemberSummary[];
  businessPeople: BusinessPersonSummary[];
  callerDisplayName: string | null;
  callerUserId: string;
  mapping: Record<number, UserMapChoice>;
  setMapping: (
    fn: (prev: Record<number, UserMapChoice>) => Record<number, UserMapChoice>,
  ) => void;
}): React.JSX.Element {
  // The caller is already covered by the "Me" option — listing them in
  // the "Shyre team members" optgroup as a separate row both resolves to
  // the same user_id and reads as a duplicate. Filter them out.
  const otherShyreMembers = shyreMembers.filter(
    (m) => m.user_id !== callerUserId,
  );
  const meLabel = callerDisplayName
    ? `Me (${callerDisplayName})`
    : "Me (attribute to caller)";

  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-body font-semibold text-content flex items-center gap-1.5">
          <UserCog size={14} />
          Map Harvest users to Shyre
        </h3>
        <p className="mt-1 text-caption text-content-muted">
          Each Harvest user who logged time becomes the author of their entries
          in Shyre. Pick a Shyre user for each, fall back to <em>Me</em> to
          attribute them to you, or — for ex-collaborators who won&apos;t sign
          in — <em>Create shell account</em> to anchor their historical entries
          under their name without granting login. If the person is already
          listed under <em>Business → People</em> but doesn&apos;t have a
          Shyre login, pick them from the <em>Business people</em> section
          to link the import to that existing record. Choose <em>Skip</em>{" "}
          to drop a user&apos;s entries entirely.
        </p>
      </div>

      <ul className="divide-y divide-edge-muted border-t border-edge-muted">
        {harvestUsers.map((hu) => (
          <li
            key={hu.id}
            className="py-2 flex items-center gap-3 flex-wrap"
          >
            <div className="flex-1 min-w-[180px]">
              <div className="text-body text-content font-medium">
                {hu.name}
              </div>
              <div className="text-caption text-content-muted">
                {hu.email ?? "—"}
                {" · "}
                <span className="font-mono">{hu.entryCount}</span> entr
                {hu.entryCount === 1 ? "y" : "ies"}
              </div>
            </div>

            <select
              value={String(mapping[hu.id] ?? "importer")}
              onChange={(e) =>
                setMapping((prev) => ({
                  ...prev,
                  [hu.id]: e.target.value as UserMapChoice,
                }))
              }
              className={selectClass}
              style={{ maxWidth: 280 }}
            >
              <option value="importer">{meLabel}</option>
              <option value="shell">Create shell account (no login)</option>
              <option value="skip">Skip (drop entries)</option>
              {otherShyreMembers.length > 0 ? (
                <optgroup label="Shyre team members">
                  {otherShyreMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name ?? m.email ?? m.user_id.slice(0, 8)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {businessPeople.length > 0 ? (
                <optgroup label="Business people (no Shyre login)">
                  {businessPeople.map((p) => {
                    const name = p.preferred_name || p.legal_name;
                    const tag =
                      p.employment_type === "1099_contractor"
                        ? " — 1099"
                        : p.employment_type === "w2_employee"
                          ? " — W-2"
                          : "";
                    return (
                      <option key={p.id} value={`bp:${p.id}`}>
                        {name}
                        {tag}
                      </option>
                    );
                  })}
                </optgroup>
              ) : null}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoneStep({
  result,
  onAnother,
}: {
  result: ImportResult;
  onAnother: () => void;
}): React.JSX.Element {
  const skipReasons = Object.entries(result.skipped.reasons ?? {});
  const recon = result.reconciliation;
  // Smart "View imported data" target — pick the entity type with
  // the most rows imported in this run. Time-entry-only re-imports
  // shouldn't dump the user on /customers; customers-only first-
  // time imports shouldn't dump them on /time-entries. Falls back
  // to /customers when nothing imported (e.g. a no-op re-run).
  const viewHref = (() => {
    const imp = result.imported;
    const entries = [
      { count: imp.timeEntries, href: "/time-entries" },
      { count: imp.invoices, href: "/invoices" },
      { count: imp.projects, href: "/projects" },
      { count: imp.customers, href: "/customers" },
    ];
    const top = entries.find((e) => e.count > 0);
    return top?.href ?? "/customers";
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {recon?.match ? (
          <>
            <CheckCircle size={20} className="text-success" />
            <span className="font-semibold text-success">
              Import complete — numbers match Harvest
            </span>
          </>
        ) : recon && !recon.match ? (
          <>
            <AlertTriangle size={20} className="text-warning" />
            <span className="font-semibold text-warning">
              Import complete — but numbers don&apos;t match Harvest
            </span>
          </>
        ) : (
          <>
            <CheckCircle size={20} className="text-success" />
            <span className="font-semibold text-success">Import complete</span>
          </>
        )}
      </div>

      {recon && <ReconciliationSection recon={recon} />}

      {result.entryDateRange?.earliest && result.entryDateRange?.latest && (
        // Date range covered by the imported entries — independent of
        // how many actually landed. Lets the user confirm at a glance
        // that the import picked up the calendar window they
        // intended ("yes, I pulled all of April"). Mirrors the
        // history list's "Covers Apr 1 – Apr 30" line.
        <div className="text-caption text-content-secondary">
          Covers{" "}
          {formatSummaryDate(result.entryDateRange.earliest)} –{" "}
          {formatSummaryDate(result.entryDateRange.latest)}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ResultCard
          icon={Users}
          label="Customers"
          count={result.imported.customers}
        />
        <ResultCard
          icon={FolderKanban}
          label="Projects"
          count={result.imported.projects}
        />
        <ResultCard
          icon={Clock}
          label="Time entries"
          count={result.imported.timeEntries}
        />
        <ResultCard
          icon={FileText}
          label={`Invoices (${result.imported.invoiceLineItems} line items)`}
          count={result.imported.invoices}
        />
      </div>

      <div className="text-caption text-content-muted">
        Run id: <span className="font-mono">{result.importRunId}</span>
      </div>

      {skipReasons.length > 0 && (
        <div className="rounded-md border border-edge-muted bg-surface p-3">
          <div className="text-label font-semibold uppercase text-content-muted mb-2">
            Skipped ({result.skipped.timeEntries})
          </div>
          <ul className="text-caption text-content-secondary space-y-0.5">
            {skipReasons.map(([reason, count]) => (
              <li key={reason}>
                <span className="font-mono">{count}</span> · {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="rounded-md border border-error/30 bg-error-soft/50 p-3">
          <div className="text-label font-semibold uppercase text-error mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Errors ({result.errors.length})
          </div>
          <ul className="text-caption text-content-secondary space-y-0.5 max-h-[192px] overflow-auto">
            {result.errors.map((msg, idx) => (
              <li key={idx} className="break-words">
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={viewHref} className={buttonPrimaryClass}>
          View imported data
        </Link>
        {/* "Import another" resets the form so the user can pull a
            different date range without leaving the page. Otherwise
            they're stuck on the success card and have to navigate
            away + back to start over. */}
        <button
          type="button"
          onClick={onAnother}
          className={buttonSecondaryClass}
        >
          <Upload size={14} />
          Import another
        </button>
      </div>
    </div>
  );
}

function ReconciliationSection({
  recon,
}: {
  recon: Reconciliation;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const mismatches = recon.perCustomer.filter((c) => !c.match);
  const mismatchCount = mismatches.length;

  const cardClass = recon.match
    ? "border-success/40 bg-success-soft/40"
    : "border-warning/50 bg-warning-soft/50";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${cardClass}`}>
      <div>
        <div className="text-label font-semibold uppercase text-content-muted mb-2">
          Reconciliation (Harvest vs Shyre)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-caption uppercase text-content-muted">
                <th className="py-1 pr-4 font-semibold">Metric</th>
                <th className="py-1 px-4 font-semibold font-mono">Harvest</th>
                <th className="py-1 px-4 font-semibold font-mono">Shyre</th>
                <th className="py-1 pl-4 font-semibold">Match</th>
              </tr>
            </thead>
            <tbody className="border-t border-edge-muted">
              <ReconRow
                label="Time entries"
                harvest={recon.harvest.entries}
                shyre={recon.shyre.entries}
                match={recon.harvest.entries === recon.shyre.entries}
              />
              <ReconRow
                label="Total hours"
                harvest={`${recon.harvest.hours}h`}
                shyre={`${recon.shyre.hours}h`}
                match={
                  Math.abs(recon.harvest.hours - recon.shyre.hours) < 0.01
                }
              />
            </tbody>
          </table>
        </div>
      </div>

      {recon.missing.count > 0 && (
        <div className="text-caption text-content-secondary">
          <span className="font-medium text-warning">
            {recon.missing.count} {recon.missing.count === 1 ? "entry" : "entries"}{" "}
            ({recon.missing.hours}h)
          </span>{" "}
          from Harvest aren&apos;t in Shyre.
          {Object.entries(recon.missing.reasonsByCount).length > 0 && (
            <>
              {" "}
              Reasons:{" "}
              {Object.entries(recon.missing.reasonsByCount)
                .map(([r, c]) => `${c} ${r}`)
                .join(", ")}
              .
            </>
          )}
        </div>
      )}

      {recon.perCustomer.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-caption text-accent hover:underline"
          >
            {expanded ? "Hide" : "Show"} per-customer breakdown (
            {recon.perCustomer.length}{" "}
            {recon.perCustomer.length === 1 ? "customer" : "customers"}
            {mismatchCount > 0
              ? `, ${mismatchCount} mismatch${mismatchCount === 1 ? "" : "es"}`
              : ""}
            )
          </button>
          {expanded && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-caption">
                <thead>
                  <tr className="text-left text-label uppercase text-content-muted">
                    <th className="py-1 pr-4 font-semibold">Customer</th>
                    <th className="py-1 px-4 font-semibold font-mono text-right">
                      Harvest
                    </th>
                    <th className="py-1 px-4 font-semibold font-mono text-right">
                      Shyre
                    </th>
                    <th className="py-1 pl-4 font-semibold">Match</th>
                  </tr>
                </thead>
                <tbody className="border-t border-edge-muted">
                  {recon.perCustomer.map((c) => (
                    <tr
                      key={c.name}
                      className="border-b border-edge-muted last:border-b-0"
                    >
                      <td className="py-1 pr-4 text-content">{c.name}</td>
                      <td className="py-1 px-4 font-mono text-right text-content-secondary">
                        {c.harvestEntries}·{c.harvestHours}h
                      </td>
                      <td className="py-1 px-4 font-mono text-right text-content-secondary">
                        {c.shyreEntries}·{c.shyreHours}h
                      </td>
                      <td className="py-1 pl-4">
                        {c.match ? (
                          <CheckCircle
                            size={12}
                            className="text-success inline"
                            aria-label="Match"
                          />
                        ) : (
                          <AlertTriangle
                            size={12}
                            className="text-warning inline"
                            aria-label="Mismatch"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReconRow({
  label,
  harvest,
  shyre,
  match,
}: {
  label: string;
  harvest: string | number;
  shyre: string | number;
  match: boolean;
}): React.JSX.Element {
  return (
    <tr className="border-b border-edge-muted last:border-b-0">
      <td className="py-1.5 pr-4 text-content">{label}</td>
      <td className="py-1.5 px-4 font-mono text-content-secondary">
        {harvest}
      </td>
      <td className="py-1.5 px-4 font-mono text-content-secondary">
        {shyre}
      </td>
      <td className="py-1.5 pl-4">
        {match ? (
          <CheckCircle
            size={14}
            className="text-success inline"
            aria-label="Match"
          />
        ) : (
          <AlertTriangle
            size={14}
            className="text-warning inline"
            aria-label="Mismatch"
          />
        )}
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────
// Small display helpers
// ────────────────────────────────────────────────────────────────

function StepIndicator({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium ${
        done
          ? "bg-success-soft text-success-text"
          : active
            ? "bg-accent-soft text-accent-text"
            : "bg-surface-inset text-content-muted"
      }`}
    >
      {done && <CheckCircle size={10} />}
      {label}
    </span>
  );
}

function PreviewCard({
  icon: Icon,
  label,
  count,
  names,
  existing,
}: {
  icon: typeof Users;
  label: string;
  count: number;
  names: string[];
  /** Number of rows already imported in Shyre (matched by Harvest
   *  source id). Drives the "X new · Y will refresh" line so the
   *  user can tell whether the import will create rows or refresh
   *  existing ones. Omit when not applicable (e.g. categories,
   *  which the importer derives from time entries on the fly). */
  existing?: number;
}): React.JSX.Element {
  const newCount = existing !== undefined ? Math.max(0, count - existing) : null;
  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-accent" />
        <span className="text-caption font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </span>
      </div>
      <p className="mt-1 text-title font-bold font-mono text-content">{count}</p>
      {newCount !== null && count > 0 && (
        // Three-channel encoding via plain language + count split.
        // "all new" → simple; "all existing" → emphasizes the refresh
        // case; mixed → both numbers so the user can scan exactly
        // what's about to happen. Color stays neutral; this is
        // informational, not a warning.
        <p className="mt-1 text-caption text-content-secondary">
          {existing === 0
            ? `${count} new`
            : existing === count
              ? `${count} will refresh`
              : `${newCount} new · ${existing} will refresh`}
        </p>
      )}
      {names.length > 0 && (
        <p className="mt-1 text-caption text-content-muted truncate">
          {names.join(", ")}
          {count > names.length && ` +${count - names.length} more`}
        </p>
      )}
    </div>
  );
}

function ResultCard({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Users;
  label: string;
  count: number;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-success/30 bg-success-soft p-3">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-success" />
        <span className="text-caption font-semibold uppercase tracking-wider text-success">
          {label}
        </span>
      </div>
      <p className="mt-1 text-title font-bold font-mono text-content">{count}</p>
    </div>
  );
}
