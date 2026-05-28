export default function ProjectTimeLoading(): React.JSX.Element {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading time entries…</span>
      <div className="h-32 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-64 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
