export default function SignoffSignLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-screen max-w-[440px] flex-col justify-center gap-4 px-[24px]"
    >
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-40 self-center rounded bg-surface-raised animate-pulse" />
      <div className="h-48 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </div>
  );
}
