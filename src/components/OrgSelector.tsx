"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { selectClass, labelClass } from "@/lib/form-styles";
import type { OrgListItem } from "@/lib/org-context";

interface OrgSelectorProps {
  orgs: OrgListItem[];
  label?: string;
}

const LAST_ORG_KEY = "stint-last-org";

/**
 * Org selector for create forms.
 * - 1 org: hidden input, auto-selected
 * - Multiple orgs: visible dropdown, defaults to last-used org
 * After form submission, parent should call updateLastOrg().
 */
export function OrgSelector({
  orgs,
  label,
}: OrgSelectorProps): React.JSX.Element | null {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  useEffect(() => {
    if (orgs.length === 0) return;

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
  }, [orgs]);

  if (orgs.length === 0) return null;

  // Single org: hidden input
  if (orgs.length === 1) {
    const singleOrg = orgs[0];
    return (
      <input
        type="hidden"
        name="organization_id"
        value={singleOrg?.id ?? ""}
      />
    );
  }

  // Multiple orgs: visible dropdown
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
