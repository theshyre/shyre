export default function ProjectSettingsLoading(): React.JSX.Element {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading settings…</span>
      <div className="h-32 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="space-y-6 min-w-0">
        <div className="h-64 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-32 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-32 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      </div>
    </div>
  );
}
