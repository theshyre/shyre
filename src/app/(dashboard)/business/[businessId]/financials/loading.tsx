/**
 * Route-segment loading state for the Financials tab. The page fans out
 * several aggregate queries (payments, outstanding AR, expenses, unbilled
 * time, locks), so a skeleton keeps the tab from flashing empty while the
 * server work runs.
 */
export default function FinancialsLoading(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <div className="h-8 w-40 rounded-md bg-surface-inset animate-pulse" />
        <div className="h-8 w-32 rounded-md bg-surface-inset animate-pulse" />
      </div>
      {[0, 1].map((block) => (
        <div
          key={block}
          className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
        >
          <div className="h-5 w-32 rounded bg-surface-inset animate-pulse" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((tile) => (
              <div
                key={tile}
                className="h-20 rounded-md border border-edge bg-surface animate-pulse"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
