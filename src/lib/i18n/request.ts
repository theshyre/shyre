import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  const locale = "en";

  const [
    common,
    auth,
    clients,
    dashboard,
    projects,
    time,
    settings,
    invoices,
    reports,
    errors,
    sharing,
    categories,
    templates,
  ] = await Promise.all([
    import(`./locales/${locale}/common.json`),
    import(`./locales/${locale}/auth.json`),
    import(`./locales/${locale}/clients.json`),
    import(`./locales/${locale}/dashboard.json`),
    import(`./locales/${locale}/projects.json`),
    import(`./locales/${locale}/time.json`),
    import(`./locales/${locale}/settings.json`),
    import(`./locales/${locale}/invoices.json`),
    import(`./locales/${locale}/reports.json`),
    import(`./locales/${locale}/errors.json`),
    import(`./locales/${locale}/sharing.json`),
    import(`./locales/${locale}/categories.json`),
    import(`./locales/${locale}/templates.json`),
  ]);

  return {
    locale,
    messages: {
      common: common.default,
      auth: auth.default,
      clients: clients.default,
      dashboard: dashboard.default,
      projects: projects.default,
      time: time.default,
      settings: settings.default,
      invoices: invoices.default,
      reports: reports.default,
      errors: errors.default,
      sharing: sharing.default,
      categories: categories.default,
      templates: templates.default,
    },
  };
});
