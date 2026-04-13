import { ErrorDisplay } from "@/components/ErrorDisplay";

export default function DashboardNotFound(): React.JSX.Element {
  return <ErrorDisplay variant="notFound" showRetry={false} />;
}
