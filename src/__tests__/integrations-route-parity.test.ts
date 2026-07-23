/**
 * Wrapper-parity check for the session-less integration surface
 * (SAL-051) — the realtime-parity.test.ts pattern applied to route
 * sources.
 *
 * The middleware exempts /api/v1 and /api/mcp from session auth BY
 * DESIGN, so the bearer-PAT wrapper is the only gate: a route file
 * under src/app/api/v1/** that forgets `runIntegrationRoute` is
 * PUBLIC. This test greps every route source on that surface and fails
 * the build instead.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const V1_DIR = join(process.cwd(), "src", "app", "api", "v1");
const MCP_ROUTE = join(process.cwd(), "src", "app", "api", "mcp", "route.ts");

function collectRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectRouteFiles(full));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      files.push(full);
    }
  }
  return files.sort();
}

const routeFiles = collectRouteFiles(V1_DIR);

describe("integrations route parity (SAL-051)", () => {
  it("covers the expected /api/v1 surface — a vanished route file means the glob broke, not that the API shrank", () => {
    const rel = routeFiles.map((f) => relative(V1_DIR, f));
    expect(rel).toEqual([
      "entries/[id]/route.ts",
      "entries/route.ts",
      "me/route.ts",
      "projects/route.ts",
      "timer/route.ts",
      "timer/start/route.ts",
      "timer/stop/route.ts",
    ]);
  });

  it.each(routeFiles.map((f) => [relative(process.cwd(), f), f]))(
    "%s authenticates through the shared wrapper",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain('from "@/lib/integrations/api-auth"');
      expect(src).toContain("runIntegrationRoute(");
    },
  );

  it.each(routeFiles.map((f) => [relative(process.cwd(), f), f]))(
    "%s never touches a Supabase client directly — the service layer is the only data path",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("@/lib/supabase/server");
      expect(src).not.toContain("@/lib/supabase/admin");
      expect(src).not.toContain("@supabase/supabase-js");
    },
  );

  it.each(routeFiles.map((f) => [relative(process.cwd(), f), f]))(
    "%s declares any body schema as .strict()",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      if (src.includes("z.object(")) {
        expect(src).toContain(".strict()");
      }
    },
  );

  it("the MCP endpoint authenticates through withMcpAuth + verifyIntegrationBearer", () => {
    const src = readFileSync(MCP_ROUTE, "utf8");
    expect(src).toContain("withMcpAuth(");
    expect(src).toContain("verifyIntegrationBearer");
    expect(src).toContain("required: true");
  });

  it("the MCP tools share the REST service layer — no parallel data path", () => {
    const src = readFileSync(MCP_ROUTE, "utf8");
    expect(src).toContain('from "@/lib/integrations/service"');
    expect(src).not.toContain("@/lib/supabase/server");
    expect(src).not.toContain("@/lib/supabase/admin");
    expect(src).not.toContain("@supabase/supabase-js");
  });
});
