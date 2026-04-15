import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
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
