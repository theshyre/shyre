"use client";

import { ErrorDisplay } from "@/components/ErrorDisplay";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <ErrorDisplay
      digest={error.digest}
      showRetry
      onRetry={reset}
    />
  );
}
