import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import pkg from "./package.json" with { type: "json" };

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  env: {
    // Expose the package version to the client so the sidebar footer can
    // render `Shyre v<version>` without a runtime read of package.json
    // (client bundles can't require it cleanly).
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // @theshyre/* packages ship TypeScript sources (no build step). Turbopack
  // transpiles them like app code.
  transpilePackages: ["@theshyre/theme", "@theshyre/ui"],
  async redirects() {
    return [
      { source: "/clients", destination: "/customers", permanent: true },
      { source: "/clients/:id", destination: "/customers/:id", permanent: true },
      { source: "/timer", destination: "/time-entries", permanent: true },
      // Sysadmin pages moved /admin/* → /system/* (Tier 2 of the
      // admin-IA cleanup).
      { source: "/admin/errors", destination: "/system/errors", permanent: true },
      { source: "/admin/users", destination: "/system/users", permanent: true },
      { source: "/admin/teams", destination: "/system/teams", permanent: true },
      { source: "/admin/sample-data", destination: "/system/sample-data", permanent: true },
      { source: "/admin/test-error", destination: "/system/test-error", permanent: true },
      // /admin (the Settings hub) was renamed to /settings (Tier 3).
      // The previous `/settings → /profile` redirect was retired —
      // /settings is now the user-level config hub. Anyone landing
      // at /admin gets the new hub via this redirect.
      { source: "/admin", destination: "/settings", permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
