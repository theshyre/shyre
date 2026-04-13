"use client";

import { useState } from "react";
import {
  CheckCircle,
  Loader2,
  AlertCircle,
  ArrowRight,
  Upload,
  Eye,
  Users,
  FolderKanban,
  Clock,
} from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { OrgSelector } from "@/components/OrgSelector";
import type { OrgListItem } from "@/lib/org-context";

type Step = "credentials" | "preview" | "importing" | "done";

interface PreviewData {
  clients: number;
  projects: number;
  timeEntries: number;
  clientNames: string[];
  projectNames: string[];
}

interface ImportResult {
  imported: {
    clients: number;
    projects: number;
    timeEntries: number;
  };
  skipped: {
    timeEntries: number;
  };
}

export function HarvestImport({
  orgs,
}: {
  orgs: OrgListItem[];
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("credentials");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleValidate(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: orgId,
          action: "validate",
        }),
      });
      const data = await res.json();

      if (!data.valid) {
        setError(data.error ?? "Invalid credentials");
        setLoading(false);
        return;
      }

      setCompanyName(data.companyName ?? "");

      // Immediately fetch preview
      const previewRes = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: orgId,
          action: "preview",
        }),
      });
      const previewData = await previewRes.json();

      if (previewData.error) {
        setError(previewData.error);
        setLoading(false);
        return;
      }

      setPreview(previewData);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(): Promise<void> {
    setStep("importing");
    setError(null);

    try {
      const res = await fetch("/api/import/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          accountId,
          organizationId: orgId,
          action: "import",
        }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setStep("preview");
        return;
      }

      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("preview");
    }
  }

  return (
    <div className="mt-6">
      {/* Harvest card */}
      <div className="rounded-lg border border-edge bg-surface-raised p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-soft">
            <Upload size={20} className="text-warning" />
          </div>
          <div>
            <h2 className="font-semibold text-content">Harvest</h2>
            <p className="text-xs text-content-muted">
              Import clients, projects, and time entries from Harvest
            </p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-6 text-xs text-content-muted">
          <StepIndicator
            label="Connect"
            active={step === "credentials"}
            done={step !== "credentials"}
          />
          <ArrowRight size={12} />
          <StepIndicator
            label="Preview"
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
          <div className="mb-4 flex items-center gap-2 text-sm text-error bg-error-soft rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Step 1: Credentials */}
        {step === "credentials" && (
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
                <label className={labelClass}>Import into Organization</label>
                {orgs.length === 1 ? (
                  <>
                    <input
                      type="text"
                      value={orgs[0]?.name ?? ""}
                      disabled
                      className={inputClass}
                    />
                    <input
                      type="hidden"
                      value={orgs[0]?.id ?? ""}
                      onChange={(e) => setOrgId(e.target.value)}
                    />
                  </>
                ) : (
                  <select
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    className={inputClass}
                  >
                    {orgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <button
              onClick={handleValidate}
              disabled={loading || !token || !accountId}
              className={buttonPrimaryClass}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Eye size={16} />
              )}
              {loading ? "Connecting..." : "Connect & Preview"}
            </button>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="space-y-4">
            {companyName && (
              <p className="text-sm text-content-secondary">
                Connected to <strong className="text-content">{companyName}</strong>
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <PreviewCard
                icon={Users}
                label="Clients"
                count={preview.clients}
                names={preview.clientNames}
              />
              <PreviewCard
                icon={FolderKanban}
                label="Projects"
                count={preview.projects}
                names={preview.projectNames}
              />
              <PreviewCard
                icon={Clock}
                label="Time Entries"
                count={preview.timeEntries}
                names={[]}
              />
            </div>

            <p className="text-xs text-content-muted">
              Existing records with matching names will be skipped (no duplicates).
              Only active clients and projects will be imported.
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleImport}
                className={buttonPrimaryClass}
              >
                <Upload size={16} />
                Import {preview.clients + preview.projects + preview.timeEntries} records
              </button>
              <button
                onClick={() => {
                  setStep("credentials");
                  setPreview(null);
                }}
                className={buttonSecondaryClass}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === "importing" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 size={32} className="animate-spin text-accent" />
            <p className="text-sm text-content-secondary">
              Importing data from Harvest...
            </p>
            <p className="text-xs text-content-muted">
              This may take a minute for large accounts.
            </p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle size={20} />
              <span className="font-semibold">Import Complete</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <ResultCard
                icon={Users}
                label="Clients"
                count={result.imported.clients}
              />
              <ResultCard
                icon={FolderKanban}
                label="Projects"
                count={result.imported.projects}
              />
              <ResultCard
                icon={Clock}
                label="Time Entries"
                count={result.imported.timeEntries}
              />
            </div>

            {result.skipped.timeEntries > 0 && (
              <p className="text-xs text-content-muted">
                {result.skipped.timeEntries} time entries skipped (no matching project found).
              </p>
            )}

            <a href="/clients" className={buttonPrimaryClass}>
              View Imported Data
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

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
