export default function ProposalPreviewLoading(): React.JSX.Element {
  return (
    <div className="max-w-[880px] space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading preview…</span>
      <div className="h-16 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-[420px] rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
