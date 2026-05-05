"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TicketChip } from "@/components/TicketChip";
import { inputClass, labelClass } from "@/lib/form-styles";
import { formatTicketKeyForInput } from "@/lib/tickets/parse-input";

/**
 * Provider-aware ticket-link input shared between the new-time-entry
 * form and the inline-edit form. Adapts to whichever providers the
 * project has configured:
 *
 *   - Jira only: label "Jira issue", placeholder "AE-640 or 640"
 *   - GitHub only: label "GitHub issue", placeholder "#42 or 42"
 *   - Both: label "Linked ticket", placeholder shows both shapes
 *   - Neither: field is hidden entirely (caller can branch on
 *     `hasAnyProvider` from {@link ticketFieldVisible})
 *
 * Renders the existing `linked_ticket_*` chip above the input so the
 * user sees what's currently attached. Editing the input replaces
 * the attached ticket on save (server reads `name="ticket_ref"`).
 *
 * The component is intentionally NOT a controlled input — the form
 * action reads the raw value off the FormData on submit. Pre-fill
 * comes from the `defaultRef` prop (computed by the caller from
 * `linked_ticket_provider` + `linked_ticket_key` via
 * `formatTicketKeyForInput`).
 */

export interface TicketFieldProps {
  /** Stable id prefix so multiple TicketFields on the same page
   *  (rare, but possible) don't collide on label-for / aria-* refs. */
  idPrefix: string;
  /** Project's GitHub repo (e.g. "octokit/rest.js"). Null when not
   *  configured. */
  githubRepo: string | null;
  /** Project's Jira project key (e.g. "AE"). Null when not
   *  configured. */
  jiraProjectKey: string | null;
  /** Currently attached ticket — drives the chip preview AND seeds
   *  the input's defaultValue. */
  attached?: {
    provider: "jira" | "github";
    key: string;
    url: string | null;
    title: string | null;
  } | null;
  /** Entry id — only set on edit forms; enables the chip's refresh +
   *  apply-title actions. */
  entryId?: string;
  /** Whether the viewer is the author of the entry — drives chip
   *  refresh permissions. Defaults to true (we're authoring). */
  canRefresh?: boolean;
  /** Disable input (e.g. when the entry is locked / invoiced). */
  disabled?: boolean;
}

export function ticketFieldVisible(
  githubRepo: string | null,
  jiraProjectKey: string | null,
): boolean {
  return Boolean(githubRepo || jiraProjectKey);
}

export function TicketField({
  idPrefix,
  githubRepo,
  jiraProjectKey,
  attached = null,
  entryId,
  canRefresh = true,
  disabled = false,
}: TicketFieldProps): React.JSX.Element | null {
  const t = useTranslations("time.ticketField");
  const inputId = `${idPrefix}-ticket-ref`;

  // The chip's "Use as description" / refresh buttons mutate the
  // entry server-side; on success the page revalidates and the new
  // value flows back through props. Local state is just for the
  // input's defaultValue seed (we re-key on prop change to stay in
  // sync with the chip).
  const [seed] = useState<string>(() =>
    attached
      ? formatTicketKeyForInput(attached, {
          defaultGithubRepo: githubRepo,
          defaultJiraProjectKey: jiraProjectKey,
        })
      : "",
  );

  if (!ticketFieldVisible(githubRepo, jiraProjectKey)) return null;

  let labelText: string;
  let placeholder: string;
  if (jiraProjectKey && githubRepo) {
    labelText = t("labelBoth");
    placeholder = t("placeholderBoth", {
      jiraExample: `${jiraProjectKey}-640`,
      githubExample: `#42`,
    });
  } else if (jiraProjectKey) {
    labelText = t("labelJira");
    placeholder = t("placeholderJira", {
      jiraExample: `${jiraProjectKey}-640`,
      shortExample: "640",
    });
  } else {
    labelText = t("labelGitHub");
    placeholder = t("placeholderGitHub", { shortExample: "#42" });
  }

  return (
    <div>
      <label htmlFor={inputId} className={labelClass}>
        {labelText}
      </label>
      {attached && (
        <div className="mb-1.5">
          <TicketChip
            entryId={entryId}
            provider={attached.provider}
            ticketKey={attached.key}
            url={attached.url}
            title={attached.title}
            canRefresh={canRefresh && Boolean(entryId)}
            size="md"
          />
        </div>
      )}
      <input
        id={inputId}
        name="ticket_ref"
        type="text"
        autoComplete="off"
        defaultValue={seed}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClass}
      />
    </div>
  );
}
