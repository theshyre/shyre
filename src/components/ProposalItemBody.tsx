"use client";

import { MarkdownView } from "@/components/MarkdownView";

interface Props {
  bodyMarkdown: string | null;
  description: string | null;
  whyItMatters: string | null;
  outOfScope: string | null;
  definitionOfDone: string | null;
  /** Translated labels for the legacy prose fields (namespace differs per
   *  surface, so they're passed in). */
  labels: {
    whyItMatters: string;
    outOfScope: string;
    definitionOfDone: string;
  };
}

/**
 * A line item's body across every WEB surface (detail / sign / preview): render
 * the rich `bodyMarkdown` when set, else fall back to the legacy structured
 * prose fields so proposals authored before the markdown feature keep rendering
 * their content until re-saved.
 */
export function ProposalItemBody({
  bodyMarkdown,
  description,
  whyItMatters,
  outOfScope,
  definitionOfDone,
  labels,
}: Props): React.JSX.Element | null {
  if (bodyMarkdown && bodyMarkdown.trim() !== "") {
    return <MarkdownView content={bodyMarkdown} className="mt-1" />;
  }

  const hasLegacy =
    description || whyItMatters || outOfScope || definitionOfDone;
  if (!hasLegacy) return null;

  return (
    <>
      {description && (
        <p className="mt-1 text-body text-content-secondary">{description}</p>
      )}
      {whyItMatters && (
        <p className="mt-1 text-caption text-content-secondary">
          <span className="font-semibold">{labels.whyItMatters}: </span>
          {whyItMatters}
        </p>
      )}
      {outOfScope && (
        <p className="mt-1 text-caption text-content-secondary">
          <span className="font-semibold">{labels.outOfScope}: </span>
          {outOfScope}
        </p>
      )}
      {definitionOfDone && (
        <p className="mt-1 text-caption text-content-secondary">
          <span className="font-semibold">{labels.definitionOfDone}: </span>
          {definitionOfDone}
        </p>
      )}
    </>
  );
}
