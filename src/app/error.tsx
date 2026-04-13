"use client";

import { ErrorDisplay } from "@/components/ErrorDisplay";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center">
      <ErrorDisplay
        digest={error.digest}
        showRetry
        onRetry={reset}
      />
    </div>
  );
}
