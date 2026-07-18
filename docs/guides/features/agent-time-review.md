# Reviewing agent-tracked time

When AI agents (or integrations) track time on your behalf through
the API, those entries flow into the same invoicing pipeline as your
own. By design there is **no approval queue** — the invoice builder
is the one human gate where agent-tracked time gets reviewed before
it reaches a customer (see `docs/reference/multi-stream-timers.md`).
Shyre warns; it never auto-merges, auto-deletes, or blocks.

## Where it lives

- **Invoice builder** (`/invoices/new`) — the **Agent-tracked time**
  section appears in the left column whenever the current selection
  (customer + projects + date range) contains entries started by an
  agent. If no agent entries are in scope, the section is absent.
- **Reports** (`/reports`) — the **Source** filter (All sources /
  Human / Agent) sits under the period presets.

## The review section

Each agent-started entry shows:

- a **Bot icon + agent label** (e.g. "Claude Code") — the
  attribution recorded on `time_entries.agent_label` when the entry
  was created via an integration token;
- the entry's description, project, date, and duration;
- an **overlap warning** ("Overlaps your tracked time") when the
  agent entry's wall-clock range intersects one of **your own**
  entries on the **same project**. Hover the badge to see which
  entry it collides with. Different projects or different teammates
  never warn — parallel work is the point of agent tracking;
- an **Exclude** button.

### What Exclude does (and doesn't)

Exclude removes the entry from **this invoice's selection only**:

- totals, line items, and the inferred service period update
  immediately;
- the created invoice skips the entry, so the posted total always
  matches the preview;
- the time entry itself is **never modified or deleted** — it stays
  uninvoiced and shows up again on your next invoice run;
- **Include** on an excluded row undoes it instantly.

## Agent hours subtotal

The live preview rail shows an **Agent hours** line (Bot icon +
`Xh Ym`) whenever the current selection includes agent-tracked time,
so you always know how much of the invoice a machine logged. It
disappears when no agent time is selected.

## Reports: the Source lens

The **Source** filter separates hours by who initiated the entry:

- **Agent** — entries with `started_by_kind = 'agent'`;
- **Human** — everything else (`user`, `integration`, `import` —
  human-initiated even when a tool did the typing);
- **All sources** — no filter.

Human + Agent always add up to All, so the two lenses partition your
totals exactly. The filter applies to every hours/revenue table on
the page; **Collected (cash basis)** is payment-based and unaffected.

## Related

- Time-entry attribution columns (`started_by_kind`, `agent_label`,
  `started_by_ref`) are display-only and immutable after creation —
  they never change rates, billability, or invoice math.
- Design rationale: `docs/reference/multi-stream-timers.md`.
