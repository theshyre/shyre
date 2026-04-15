/**
 * Next.js instrumentation hooks.
 *
 * `onRequestError` fires for any server-side error — server components,
 * server actions, route handlers, middleware. Without this, thrown errors
 * in server components bypass runSafeAction's logError and never land in
 * error_logs, so /admin/errors shows empty even when the app is on fire.
 */

export async function register(): Promise<void> {
  // Intentionally empty — kept so Next.js picks up the file and loads
  // onRequestError. Add telemetry initialization here later if needed.
}

export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    renderSource?: string;
    revalidateReason?: string;
    renderType?: string;
  },
): Promise<void> {
  // Loud console log — always visible in Vercel runtime logs even if the
  // DB insert fails.
  console.error("[onRequestError]", {
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    routePath: context.routePath,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Best-effort DB insert. Import lazily so a missing SERVICE_ROLE_KEY
  // doesn't crash the instrumentation module itself.
  try {
    const { logError } = await import("@/lib/logger");
    logError(error, {
      url: request.path,
      action: `server-error:${context.routeType}:${context.routePath}`,
    });
  } catch (logErr) {
    console.error("[onRequestError] logger unavailable:", logErr);
  }
}
