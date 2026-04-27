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
} from "lucide-react";
import { Spinner } from "@theshyre/ui";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { InlineErrorCard } from "@/components/InlineErrorCard";
import type { TeamListItem } from "@/lib/team-context";

type Step = "credentials" | "preview" | "importing" | "done";

type UserMapChoice = string | "importer" | "skip";

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

interface PreviewData {
  companyName: string;
  timeZone: string;
  customers: number;
  projects: number;
  timeEntries: number;
  categoryCount: number;
  customerNames: string[];
  projectNames: string[];
  harvestUsers: HarvestUserSummary[];
  shyreMembers: ShyreMemberSummary[];
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
    timeEntries: number;
  };
  skipped: {
    timeEntries: number;
    reasons: Record<string, number>;
  };
  errors: string[];
  reconciliation?: Reconciliation;
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
      const validateData = await validateRes.json();

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
      const previewData = (await previewRes.json()) as
        | PreviewData
        | ApiErrorBody;

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
      const data = (await res.json()) as ImportResult | ApiErrorBody;

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
            <p className="text-xs text-content-muted">
              Import customers, projects, tasks, and time entries from Harvest
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 text-xs text-content-muted">
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
            <Spinner size="h-8 w-8" />
            <p className="text-sm text-content-secondary">
              Importing data from Harvest...
            </p>
            <p className="text-xs text-content-muted">
              This may take a minute for large accounts. Shyre retries
              automatically when Harvest rate-limits us.
            </p>
          </div>
        )}

        {step === "done" && result && <DoneStep result={result} />}
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
      <p className="text-sm text-content-secondary">
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
          <label className={labelClass}>Personal Access Token *</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Your Harvest API token"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Account ID *</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Your Harvest Account ID (numeric)"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Import into Team</label>
          {teams.length === 1 ? (
            <input
              type="text"
              value={teams[0]?.name ?? ""}
              disabled
              className={inputClass}
            />
          ) : (
            <select
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
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className={inputClass}
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
        {loading ? <Spinner /> : <Eye size={16} />}
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
    preview.customers + preview.projects + preview.timeEntries;

  return (
    <div className="space-y-5">
      {preview.companyName && (
        <p className="text-sm text-content-secondary">
          Connected to{" "}
          <strong className="text-content">{preview.companyName}</strong>
          {" · "}
          <span className="text-content-muted font-mono text-xs">
            {preview.timeZone}
          </span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <PreviewCard
          icon={Users}
          label="Customers"
          count={preview.customers}
          names={preview.customerNames}
        />
        <PreviewCard
          icon={FolderKanban}
          label="Projects"
          count={preview.projects}
          names={preview.projectNames}
        />
        <PreviewCard
          icon={Clock}
          label="Time entries"
          count={preview.timeEntries}
          names={[]}
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
  mapping,
  setMapping,
}: {
  harvestUsers: HarvestUserSummary[];
  shyreMembers: ShyreMemberSummary[];
  mapping: Record<number, UserMapChoice>;
  setMapping: (
    fn: (prev: Record<number, UserMapChoice>) => Record<number, UserMapChoice>,
  ) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-body font-semibold text-content flex items-center gap-1.5">
          <UserCog size={14} />
          Map Harvest users to Shyre
        </h3>
        <p className="mt-1 text-caption text-content-muted">
          Each Harvest user who logged time becomes the author of their entries
          in Shyre. Pick a Shyre user for each, or fall back to <em>me</em> to
          attribute them to you. Choose <em>Skip</em> to drop a user&apos;s
          entries entirely.
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
              style={{ maxWidth: 260 }}
            >
              <option value="importer">Me (attribute to caller)</option>
              <option value="skip">Skip (drop entries)</option>
              <optgroup label="Shyre team members">
                {shyreMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name ?? m.email ?? m.user_id.slice(0, 8)}
                  </option>
                ))}
              </optgroup>
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoneStep({
  result,
}: {
  result: ImportResult;
}): React.JSX.Element {
  const skipReasons = Object.entries(result.skipped.reasons ?? {});
  const recon = result.reconciliation;

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

      <div className="grid gap-3 sm:grid-cols-3">
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

      <Link href="/customers" className={buttonPrimaryClass}>
        View imported data
      </Link>
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
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        done
          ? "bg-success-soft text-success"
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
}: {
  icon: typeof Users;
  label: string;
  count: number;
  names: string[];
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-accent" />
        <span className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </span>
      </div>
      <p className="mt-1 text-xl font-bold font-mono text-content">{count}</p>
      {names.length > 0 && (
        <p className="mt-1 text-xs text-content-muted truncate">
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
        <span className="text-xs font-semibold uppercase tracking-wider text-success">
          {label}
        </span>
      </div>
      <p className="mt-1 text-xl font-bold font-mono text-content">{count}</p>
    </div>
  );
}
