export default function SignLoading(): React.JSX.Element {
  return (
    <main
      className="mx-auto max-w-[720px] px-[24px] py-[40px]"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading proposal…</span>
      <div className="h-10 w-2/3 rounded bg-surface-raised animate-pulse" />
      <div className="mt-4 h-40 rounded-lg border border-edge bg-surface-raised animate-pulse" />
      <div className="mt-3 h-40 rounded-lg border border-edge bg-surface-raised animate-pulse" />
    </main>
  );
}
