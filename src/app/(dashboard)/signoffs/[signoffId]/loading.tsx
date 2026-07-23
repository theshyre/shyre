export default function SignoffDetailLoading(): React.JSX.Element {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading sign-off…</span>
      <div className="h-8 w-72 rounded bg-surface-raised animate-pulse" />
      <div className="mt-[16px] space-y-3">
        <div className="h-24 rounded-lg border border-edge bg-surface-raised animate-pulse" />
        <div className="h-40 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      </div>
    </div>
  );
}
