"use client";

import { useTranslations } from "next-intl";

interface SectionLink {
  id: string;
  i18nKey: string;
}

const SECTIONS: SectionLink[] = [
  { id: "settings-details", i18nKey: "details.heading" },
  { id: "settings-classification", i18nKey: "classification.heading" },
  { id: "settings-categories", i18nKey: "categories.heading" },
];

/**
 * Sticky anchor TOC for the Settings page. Mirrors the
 * `/settings/*` left-rail pattern: each link scrolls to its
 * section's id. Stays out of the way on narrow viewports (the
 * grid collapses to single column above this).
 *
 * No active-section highlighting yet — the IntersectionObserver
 * dance isn't worth the complexity for three anchors. If the form
 * splits into more sections later, revisit with `scroll-padding-
 * top` + an observer.
 */
export function ProjectSettingsNav(): React.JSX.Element {
  const tSet = useTranslations("projects.settings");
  return (
    <nav
      aria-label={tSet("navAriaLabel")}
      className="lg:sticky lg:top-4 self-start"
    >
      <ul className="space-y-1 text-body">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="block rounded-md px-3 py-1.5 text-content-secondary hover:bg-hover hover:text-content"
            >
              {tSet(s.i18nKey)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
