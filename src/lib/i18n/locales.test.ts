import { describe, it, expect } from "vitest";
import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enClients from "./locales/en/customers.json";
import enDashboard from "./locales/en/dashboard.json";
import enProjects from "./locales/en/projects.json";
import enTime from "./locales/en/time.json";
import enSettings from "./locales/en/settings.json";
import enInvoices from "./locales/en/invoices.json";
import enReports from "./locales/en/reports.json";
import esCommon from "./locales/es/common.json";
import esAuth from "./locales/es/auth.json";
import esClients from "./locales/es/customers.json";
import esDashboard from "./locales/es/dashboard.json";
import esProjects from "./locales/es/projects.json";
import esTime from "./locales/es/time.json";
import esSettings from "./locales/es/settings.json";
import esInvoices from "./locales/es/invoices.json";
import esReports from "./locales/es/reports.json";

function getKeyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...getKeyPaths(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const namespaces = [
  { name: "common", en: enCommon, es: esCommon },
  { name: "auth", en: enAuth, es: esAuth },
  { name: "customers", en: enClients, es: esClients },
  { name: "dashboard", en: enDashboard, es: esDashboard },
  { name: "projects", en: enProjects, es: esProjects },
  { name: "time", en: enTime, es: esTime },
  { name: "settings", en: enSettings, es: esSettings },
  { name: "invoices", en: enInvoices, es: esInvoices },
  { name: "reports", en: enReports, es: esReports },
] as const;

describe("locale file consistency", () => {
  for (const ns of namespaces) {
    it(`${ns.name}: en and es have the same keys`, () => {
      const enKeys = getKeyPaths(ns.en);
      const esKeys = getKeyPaths(ns.es);
      expect(enKeys).toEqual(esKeys);
    });
  }

  it("no empty string values in en locale", () => {
    for (const ns of namespaces) {
      const keys = getKeyPaths(ns.en);
      for (const key of keys) {
        const parts = key.split(".");
        let val: unknown = ns.en;
        for (const part of parts) {
          val = (val as Record<string, unknown>)[part];
        }
        expect(val, `en.${ns.name}.${key} should not be empty`).not.toBe("");
      }
    }
  });

  it("no empty string values in es locale", () => {
    for (const ns of namespaces) {
      const keys = getKeyPaths(ns.es);
      for (const key of keys) {
        const parts = key.split(".");
        let val: unknown = ns.es;
        for (const part of parts) {
          val = (val as Record<string, unknown>)[part];
        }
        expect(val, `es.${ns.name}.${key} should not be empty`).not.toBe("");
      }
    }
  });
});
