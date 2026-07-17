export default function ProposalDetailLoading(): React.JSX.Element {
  return (
    <div className="max-w-[880px] space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading proposal…</span>
      <div className="h-10 w-64 rounded bg-surface-raised animate-pulse" />
      <div className="h-20 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-40 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-24 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
