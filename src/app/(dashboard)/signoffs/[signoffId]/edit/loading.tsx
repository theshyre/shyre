export default function EditSignoffLoading(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 rounded bg-surface-raised animate-pulse" />
      <div className="mt-[16px] h-64 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
