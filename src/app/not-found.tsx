import { ErrorDisplay } from "@/components/ErrorDisplay";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center">
      <ErrorDisplay variant="notFound" showRetry={false} />
    </div>
  );
}
