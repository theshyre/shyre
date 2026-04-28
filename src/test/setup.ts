import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// `server-only` throws if imported into a non-server bundle. Vitest
// runs in jsdom and would blow up on every import, so we stub it
// once globally. Server-only modules are still tested through their
// public API; the marker is just an enforcement aid for Next.js
// bundler boundaries, not behavior.
vi.mock("server-only", () => ({}));

// Mock window.matchMedia for jsdom
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
