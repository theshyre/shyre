export default function IntegrationsSettingsLoading(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading integrations…</span>
      <div className="space-y-2">
        <div className="h-8 w-48 rounded bg-surface-raised animate-pulse" />
        <div className="h-5 w-96 max-w-full rounded bg-surface-raised animate-pulse" />
      </div>
      <div className="h-24 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-40 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="h-24 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
