export default function ProjectExpensesLoading(): React.JSX.Element {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading expenses…</span>
      <div className="h-12 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-64 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
