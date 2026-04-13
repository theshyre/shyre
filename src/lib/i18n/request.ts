import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  const locale = "en";

  const [common, auth, clients, dashboard] = await Promise.all([
    import(`./locales/${locale}/common.json`),
    import(`./locales/${locale}/auth.json`),
    import(`./locales/${locale}/clients.json`),
    import(`./locales/${locale}/dashboard.json`),
  ]);

  return {
    locale,
    messages: {
      common: common.default,
      auth: auth.default,
      clients: clients.default,
      dashboard: dashboard.default,
    },
  };
});
