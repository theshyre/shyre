import { describe, it, expect } from "vitest";
import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enClients from "./locales/en/clients.json";
import enDashboard from "./locales/en/dashboard.json";
import esCommon from "./locales/es/common.json";
import esAuth from "./locales/es/auth.json";
import esClients from "./locales/es/clients.json";
import esDashboard from "./locales/es/dashboard.json";

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

describe("locale file consistency", () => {
  it("common: en and es have the same keys", () => {
    const enKeys = getKeyPaths(enCommon);
    const esKeys = getKeyPaths(esCommon);
    expect(enKeys).toEqual(esKeys);
  });

  it("auth: en and es have the same keys", () => {
    const enKeys = getKeyPaths(enAuth);
    const esKeys = getKeyPaths(esAuth);
    expect(enKeys).toEqual(esKeys);
  });

  it("clients: en and es have the same keys", () => {
    const enKeys = getKeyPaths(enClients);
    const esKeys = getKeyPaths(esClients);
    expect(enKeys).toEqual(esKeys);
  });

  it("dashboard: en and es have the same keys", () => {
    const enKeys = getKeyPaths(enDashboard);
    const esKeys = getKeyPaths(esDashboard);
    expect(enKeys).toEqual(esKeys);
  });

  it("no empty string values in en locale", () => {
    const allEn = { ...enCommon, ...enAuth, ...enClients, ...enDashboard };
    const values = getKeyPaths(allEn);
    for (const key of values) {
      const parts = key.split(".");
      let val: unknown = allEn;
      for (const part of parts) {
        val = (val as Record<string, unknown>)[part];
      }
      expect(val, `en key "${key}" should not be empty`).not.toBe("");
    }
  });

  it("no empty string values in es locale", () => {
    const allEs = { ...esCommon, ...esAuth, ...esClients, ...esDashboard };
    const values = getKeyPaths(allEs);
    for (const key of values) {
      const parts = key.split(".");
      let val: unknown = allEs;
      for (const part of parts) {
        val = (val as Record<string, unknown>)[part];
      }
      expect(val, `es key "${key}" should not be empty`).not.toBe("");
    }
  });
});
