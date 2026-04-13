"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { selectClass, inputClass, labelClass } from "@/lib/form-styles";
import type { OrgListItem } from "@/lib/org-context";

interface OrgSelectorProps {
  orgs: OrgListItem[];
  label?: string;
  /** Pre-select this org (e.g., from current page filter) */
  defaultOrgId?: string | null;
}

const LAST_ORG_KEY = "stint-last-org";

/**
 * Org selector for create forms.
 * Always visible — shows the org name even when there's only one.
 */
export function OrgSelector({
  orgs,
  label,
  defaultOrgId,
}: OrgSelectorProps): React.JSX.Element | null {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  useEffect(() => {
    if (orgs.length === 0) return;

    // Priority: explicit default > last-used > first org
    if (defaultOrgId && orgs.some((o) => o.id === defaultOrgId)) {
      setSelectedOrgId(defaultOrgId);
      return;
    }

    const lastOrg = localStorage.getItem(LAST_ORG_KEY);
    const validLast = lastOrg && orgs.some((o) => o.id === lastOrg);

    if (validLast) {
      setSelectedOrgId(lastOrg);
    } else {
      const firstOrg = orgs[0];
      if (firstOrg) {
        setSelectedOrgId(firstOrg.id);
      }
    }
  }, [orgs, defaultOrgId]);

  if (orgs.length === 0) return null;

  // Single org: show as read-only so user always sees where data goes
  if (orgs.length === 1) {
    const singleOrg = orgs[0];
    return (
      <div>
        <label className={labelClass}>
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={14} className="text-accent" />
            {label ?? "Organization"}
          </span>
        </label>
        <input
          type="text"
          value={singleOrg?.name ?? ""}
          disabled
          className={inputClass}
        />
        <input
          type="hidden"
          name="organization_id"
          value={singleOrg?.id ?? ""}
        />
      </div>
    );
  }

  // Multiple orgs: dropdown
  return (
    <div>
      <label className={labelClass}>
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={14} className="text-accent" />
          {label ?? "Organization"}
        </span>
      </label>
      <select
        name="organization_id"
        required
        value={selectedOrgId}
        onChange={(e) => {
          setSelectedOrgId(e.target.value);
          localStorage.setItem(LAST_ORG_KEY, e.target.value);
        }}
        className={selectClass}
      >
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Call after successful form submission to remember the last-used org.
 */
export function updateLastOrg(orgId: string): void {
  localStorage.setItem(LAST_ORG_KEY, orgId);
}
