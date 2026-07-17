export default function ProposalsListLoading(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading proposals…</span>
      <div className="h-8 w-48 rounded bg-surface-raised animate-pulse" />
      <div className="mt-[16px] space-y-2">
        <div className="h-12 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-12 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-12 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      </div>
    </div>
  );
}
