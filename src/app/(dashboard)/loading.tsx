/**
 * Skeleton shown while a dashboard route segment loads its server data.
 *
 * Intentionally minimal — the TopProgressBar at the very top of the
 * viewport already signals "something is loading"; this skeleton fills
 * the main column so the layout doesn't visibly empty out during slow
 * server renders.
 */
export default function DashboardLoading(): React.JSX.Element {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 rounded bg-surface-inset animate-pulse" />
        <div className="h-7 w-48 rounded bg-surface-inset animate-pulse" />
      </div>
      <div className="h-4 w-2/3 rounded bg-surface-inset animate-pulse" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 rounded-lg bg-surface-raised animate-pulse" />
        <div className="h-32 rounded-lg bg-surface-raised animate-pulse" />
      </div>
      <div className="h-64 rounded-lg bg-surface-raised animate-pulse" />
    </div>
  );
}
