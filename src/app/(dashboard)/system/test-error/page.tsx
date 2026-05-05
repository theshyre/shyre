import { requireSystemAdmin } from "@/lib/system-admin";
import { logError } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { AlertTriangle } from "lucide-react";

export default async function TestErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ log?: string }>;
}): Promise<React.JSX.Element> {
  const { userId } = await requireSystemAdmin();
  const params = await searchParams;
  let logged = false;

  if (params.log === "1") {
    logError(
      new AppError({
        code: "UNKNOWN",
        message: "Test error from /system/test-error",
        userMessageKey: "errors.unknown",
        details: { test: true, timestamp: new Date().toISOString() },
      }),
      { userId, action: "test-error-page" }
    );
    // Give the fire-and-forget logger a moment
    await new Promise((resolve) => setTimeout(resolve, 500));
    logged = true;
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <AlertTriangle size={24} className="text-warning" />
        <h1 className="text-page-title font-bold text-content">Test Error Logger</h1>
      </div>

      <p className="mt-4 text-body-lg text-content-secondary max-w-2xl">
        Click the button to log a test error. If the logger is working correctly
        (including SUPABASE_SERVICE_ROLE_KEY being set on the server), you should
        see the error appear in{" "}
        <a href="/system/errors" className="text-accent hover:underline">
          /system/errors
        </a>
        .
      </p>

      <div className="mt-6">
        <a
          href="/system/test-error?log=1"
          className="inline-flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-body-lg font-medium text-content-inverse hover:opacity-90 transition-colors"
        >
          <AlertTriangle size={16} />
          Log Test Error
        </a>
      </div>

      {logged && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-3 text-body-lg text-success-text">
          ✓ Test error sent to logger. Check{" "}
          <a href="/system/errors" className="underline">
            /system/errors
          </a>{" "}
          to see if it was recorded.
        </div>
      )}
    </div>
  );
}
