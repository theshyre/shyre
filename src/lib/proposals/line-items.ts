/**
 * Pure domain rules for proposal line items — shared by the authoring form
 * (live preview + client-side validation), the Zod schema (server boundary),
 * and later the public acceptance page (P2 subset totals).
 *
 * A proposal's line items are proposed projects. An item may break into named
 * phases (one level deep — mirroring projects' parent/sub-project nesting)
 * whose sub-prices MUST sum to the item's fixed price; `isCapped` marks that
 * total as a hard cap on the client-facing document. Only top-level items are
 * client-selectable at sign-off; phases ride along with their parent.
 *
 * Money is dollars with 2-decimal precision (NUMERIC(10,2) in the DB). The
 * rounding convention matches the invoice money model: round each unit
 * independently, then sum.
 */

export interface ProposalPhaseInput {
  title: string;
  description?: string | null;
  fixedPrice: number;
}

export interface ProposalItemInput {
  title: string;
  /** Short one-line benefit for the Summary table's "what it does" column. */
  summary?: string | null;
  /** Rich markdown body (replaces the legacy prose fields when set). */
  bodyMarkdown?: string | null;
  description?: string | null;
  whyItMatters?: string | null;
  outOfScope?: string | null;
  definitionOfDone?: string | null;
  fixedPrice: number;
  isCapped?: boolean;
  phases?: ProposalPhaseInput[];
}

/**
 * The `proposal_line_items` columns the item-tree builder consumes — the one
 * select-string shared by every surface that renders the full document (sign
 * service, author preview, detail page). Surfaces needing extra columns append
 * them: `` `${PROPOSAL_ITEM_COLUMNS}, converted_project_id` ``.
 */
export const PROPOSAL_ITEM_COLUMNS =
  "id, parent_line_item_id, sort_order, title, summary, body_markdown, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped";

/** Flat `proposal_line_items` row as returned by a `PROPOSAL_ITEM_COLUMNS`
 *  select (NUMERIC comes back as a string over PostgREST). */
export interface ProposalItemDbRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
}

export interface ProposalItemTreePhase {
  title: string;
  description: string | null;
  fixedPrice: number;
}

export interface ProposalItemTreeNode {
  id: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string | null;
  description: string | null;
  whyItMatters: string | null;
  outOfScope: string | null;
  definitionOfDone: string | null;
  fixedPrice: number;
  isCapped: boolean;
  phases: ProposalItemTreePhase[];
}

/**
 * Rebuild the client-facing item tree from flat rows: top-level items in row
 * order (callers order by `sort_order`), each with its phases nested. NUMERIC
 * prices are coerced to numbers. The single source for the rows → parents-with-
 * nested-phases mapping previously triplicated across the sign service, the
 * author preview, and the detail page.
 */
export function buildProposalItemTree(
  rows: readonly ProposalItemDbRow[],
): ProposalItemTreeNode[] {
  return rows
    .filter((r) => r.parent_line_item_id === null)
    .map((parent) => ({
      id: parent.id,
      title: parent.title,
      summary: parent.summary ?? null,
      bodyMarkdown: parent.body_markdown,
      description: parent.description,
      whyItMatters: parent.why_it_matters,
      outOfScope: parent.out_of_scope,
      definitionOfDone: parent.definition_of_done,
      fixedPrice: Number(parent.fixed_price),
      isCapped: parent.is_capped,
      phases: rows
        .filter((r) => r.parent_line_item_id === parent.id)
        .map((phase) => ({
          title: phase.title,
          description: phase.description,
          fixedPrice: Number(phase.fixed_price),
        })),
    }));
}

/** NUMERIC(10,2) upper bound — 8 integer digits. */
export const MAX_MONEY = 99_999_999.99;

/** Round to cents, half-up — same convention as calculateLineItemAmount. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of an item's phase prices (each rounded first), rounded. */
export function phaseSum(item: ProposalItemInput): number {
  const phases = item.phases ?? [];
  return roundMoney(phases.reduce((sum, p) => sum + roundMoney(p.fixedPrice), 0));
}

/** Whole-proposal total: sum of top-level fixed prices. Phases are a
 *  breakdown of their parent, never additive on top of it. */
export function proposalTotal(items: readonly ProposalItemInput[]): number {
  return roundMoney(items.reduce((sum, i) => sum + roundMoney(i.fixedPrice), 0));
}

/** Total for a client-selected subset of top-level items (by index). The
 *  accepted total is computed from what's checked, never fixed to the whole
 *  proposal. Out-of-range indexes are ignored. */
export function selectedTotal(
  items: readonly ProposalItemInput[],
  selectedIndexes: readonly number[],
): number {
  const picked = new Set(selectedIndexes);
  return roundMoney(
    items.reduce(
      (sum, item, idx) => (picked.has(idx) ? sum + roundMoney(item.fixedPrice) : sum),
      0,
    ),
  );
}

/**
 * A validation finding. `key` is an i18n key under `proposals.validation.*`
 * so the form can render translated FieldErrors; `path` addresses the field
 * (`items.0.title`, `items.2.phases`); `params` feeds ICU placeholders.
 */
export interface LineItemIssue {
  path: string;
  key: string;
  params?: Record<string, string | number>;
}

function validMoney(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= MAX_MONEY;
}

/**
 * Cross-field money + structure rules the Zod shape can't express:
 *   - at least one line item
 *   - non-blank titles on items and phases
 *   - prices within [0, MAX_MONEY]
 *   - a phased item's phases sum to EXACTLY its fixed price (to the cent) —
 *     this is what makes "capped so it can't exceed the quote" enforceable
 */
export function validateProposalItems(
  items: readonly ProposalItemInput[],
): LineItemIssue[] {
  const issues: LineItemIssue[] = [];
  if (items.length === 0) {
    issues.push({ path: "items", key: "itemsRequired" });
    return issues;
  }
  items.forEach((item, i) => {
    if (item.title.trim() === "") {
      issues.push({ path: `items.${i}.title`, key: "titleRequired" });
    }
    if (!validMoney(item.fixedPrice)) {
      issues.push({ path: `items.${i}.fixedPrice`, key: "priceInvalid" });
    }
    const phases = item.phases ?? [];
    phases.forEach((phase, j) => {
      if (phase.title.trim() === "") {
        issues.push({ path: `items.${i}.phases.${j}.title`, key: "titleRequired" });
      }
      if (!validMoney(phase.fixedPrice)) {
        issues.push({ path: `items.${i}.phases.${j}.fixedPrice`, key: "priceInvalid" });
      }
    });
    if (phases.length > 0 && validMoney(item.fixedPrice)) {
      const sum = phaseSum(item);
      const expected = roundMoney(item.fixedPrice);
      if (sum !== expected) {
        issues.push({
          path: `items.${i}.phases`,
          key: "phaseSumMismatch",
          params: { expected, actual: sum },
        });
      }
    }
  });
  return issues;
}
