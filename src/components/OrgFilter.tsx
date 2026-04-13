"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OrgListItem } from "@/lib/org-context";

interface OrgFilterProps {
  orgs: OrgListItem[];
  selectedOrgId: string | null;
}

/**
 * Filter pill for list pages. Shows "All" or selected org name.
 * Uses URL search param `?org=<id>` so it's page-local.
 * Hidden when user has only 1 org.
 */
export function OrgFilter({
  orgs,
  selectedOrgId,
}: OrgFilterProps): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);

  // Single org: show as a static pill (no dropdown needed)
  if (orgs.length === 1) {
    const singleOrg = orgs[0];
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-xs font-medium text-content-secondary">
        <Building2 size={12} />
        {singleOrg?.name ?? ""}
      </span>
    );
  }

  const label = selectedOrg ? selectedOrg.name : "All";

  function selectOrg(orgId: string | null): void {
    const params = new URLSearchParams(searchParams.toString());
    if (orgId) {
      params.set("org", orgId);
    } else {
      params.delete("org");
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          selectedOrgId
            ? "bg-accent-soft text-accent-text"
            : "bg-surface-inset text-content-secondary hover:bg-hover"
        }`}
      >
        <Building2 size={12} />
        {label}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden">
          <button
            onClick={() => selectOrg(null)}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
              !selectedOrgId
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover"
            }`}
          >
            All
          </button>
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => selectOrg(org.id)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                org.id === selectedOrgId
                  ? "bg-accent-soft text-accent-text"
                  : "text-content-secondary hover:bg-hover"
              }`}
            >
              {org.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
