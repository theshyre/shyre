export default function EditProposalLoading(): React.JSX.Element {
  return (
    <div className="max-w-[880px] space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading proposal editor…</span>
      <div className="h-10 w-56 rounded bg-surface-raised animate-pulse" />
      <div className="h-24 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-64 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
