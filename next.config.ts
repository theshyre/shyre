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
  // @theshyre/theme ships TypeScript sources (no build step). Turbopack
  // transpiles it like app code.
  transpilePackages: ["@theshyre/theme"],
  async redirects() {
    return [
      { source: "/clients", destination: "/customers", permanent: true },
      { source: "/clients/:id", destination: "/customers/:id", permanent: true },
      { source: "/settings", destination: "/profile", permanent: true },
      { source: "/settings/categories", destination: "/categories", permanent: true },
      { source: "/settings/import", destination: "/import", permanent: true },
      { source: "/settings/templates", destination: "/templates", permanent: true },
      { source: "/settings/security-groups", destination: "/security-groups", permanent: true },
      { source: "/timer", destination: "/time-entries", permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
