"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, FileBadge, Receipt, Users, Lock } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { Tooltip } from "@/components/Tooltip";

interface Props {
  businessId: string;
  /** Whether the viewer can manage period locks (owner|admin only).
   *  Tab is hidden for plain members so they don't get a 404 click. */
  canManagePeriodLocks?: boolean;
}

/**
 * Sub-nav for a single business's pages. Lives between the page title and
 * the page body. Tab-style — active tab uses the accent color and a soft
 * underline. Each link uses LinkPendingSpinner so users see which tab
 * they clicked while the next route loads.
 *
 * Routes:
 *   /business/[businessId]            — Overview
 *   /business/[businessId]/identity   — Editable identity form
 *   /business/[businessId]/expenses   — Expenses CRUD
 *   /business/[businessId]/people     — People management
 */
export function BusinessSubNav({
  businessId,
  canManagePeriodLocks = false,
}: Props): React.JSX.Element {
  const pathname = usePathname();
  const t = useTranslations("business.subNav");

  const tabs: Array<{
    href: string;
    labelKey: string;
    icon: typeof LayoutDashboard;
    disabled?: boolean;
  }> = [
    { href: `/business/${businessId}`, labelKey: "overview", icon: LayoutDashboard },
    { href: `/business/${businessId}/identity`, labelKey: "identity", icon: FileBadge },
    { href: `/business/${businessId}/expenses`, labelKey: "expenses", icon: Receipt },
    { href: `/business/${businessId}/people`, labelKey: "people", icon: Users },
  ];
  if (canManagePeriodLocks) {
    tabs.push({
      href: `/business/${businessId}/period-locks`,
      labelKey: "periodLocks",
      icon: Lock,
    });
  }

  return (
    <nav
      aria-label="Business sections"
      className="flex flex-wrap gap-1 border-b border-edge"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === `/business/${businessId}`
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        const Icon = tab.icon;

        if (tab.disabled) {
          return (
            <Tooltip key={tab.href} label={t("comingSoon")}>
              <span
                className="inline-flex items-center gap-2 px-3 py-2 text-body-lg font-medium text-content-muted opacity-50 cursor-not-allowed"
              >
                <Icon size={14} />
                {t(tab.labelKey)}
                <span className="text-label uppercase tracking-wider">
                  {t("soon")}
                </span>
              </span>
            </Tooltip>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`inline-flex items-center gap-2 px-3 py-2 text-body-lg font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-accent text-accent"
                : "border-transparent text-content-secondary hover:text-content hover:border-edge"
            }`}
          >
            <Icon size={14} />
            {t(tab.labelKey)}
            <LinkPendingSpinner size={10} className="" />
          </Link>
        );
      })}
    </nav>
  );
}
