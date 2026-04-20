import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow `_`-prefixed args/vars to be deliberately unused. Convention: an
  // argument named `_fd`, `_unused`, etc. is kept for signature parity (e.g.,
  // test mocks of server actions) without polluting the lint report.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Avatar renders many small (≤36px) images per page. Routing every instance
  // through next/image's optimizer adds request overhead without meaningful
  // LCP/bandwidth benefit at this size. Intentional exception.
  {
    files: ["src/components/Avatar.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // Native HTML `title=` is unstyled, touch-hostile, ~700 ms delay, not
  // keyboard-accessible, and inconsistent across browsers. Use `<Tooltip>`
  // from `@/components/Tooltip` instead — see CLAUDE.md → "Tooltips —
  // MANDATORY". Applies only to lowercase (DOM) JSX elements, so
  // React-component props named `title` are unaffected. Legitimate
  // `title` uses on `<iframe>` / `<dialog>` / metadata elements are not
  // expected in Shyre today; add a targeted disable if they arise.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
          message:
            "Use <Tooltip> from @/components/Tooltip instead of the native HTML title= attribute. See CLAUDE.md → 'Tooltips — MANDATORY'.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage reports (already in .gitignore).
    "coverage/**",
  ]),
]);

export default eslintConfig;
