export default function ProjectOverviewLoading(): React.JSX.Element {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading project overview…</span>
      <div className="h-32 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-48 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      </div>
    </div>
  );
}
