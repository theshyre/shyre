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
  //
  // Also bans raw Tailwind text-size classes (`text-xs`, `text-sm`,
  // `text-base`, `text-lg`, `text-xl`, `text-2xl`, etc.) and arbitrary
  // px values (`text-[14px]`). Use the semantic typography scale —
  // `text-label` / `text-caption` / `text-body` / `text-body-lg` /
  // `text-title` / `text-page-title` / `text-hero` — which scales with
  // the user's text-size preference (root font-size). The raw classes
  // are absolute px and don't. See `docs/reference/design-system.md`
  // → "Typography".
  //
  // The pattern matches inside any string literal that looks like a
  // JSX className. We use `Literal[value=/.../]` so it covers both
  // `className="text-sm"` and `clsx("text-sm", ...)` call sites.
  // TemplateLiteral patterns (`` className={`text-sm ${x}`} ``) need
  // a separate matcher; covered by a second rule entry below.
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
        {
          selector:
            "Literal[value=/\\b(text-xs|text-sm|text-base|text-lg|text-xl|text-2xl|text-3xl|text-4xl|text-5xl|text-6xl|text-\\[\\d+(\\.\\d+)?(px|rem|em)\\])\\b/]",
          message:
            "Use the semantic typography scale instead of raw text-xs/sm/base/lg/xl/2xl or text-[Npx]. Pick from text-label / text-caption / text-body / text-body-lg / text-title / text-page-title / text-hero. See docs/reference/design-system.md → 'Typography'.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(text-xs|text-sm|text-base|text-lg|text-xl|text-2xl|text-3xl|text-4xl|text-5xl|text-6xl|text-\\[\\d+(\\.\\d+)?(px|rem|em)\\])\\b/]",
          message:
            "Use the semantic typography scale instead of raw text-xs/sm/base/lg/xl/2xl or text-[Npx]. Pick from text-label / text-caption / text-body / text-body-lg / text-title / text-page-title / text-hero. See docs/reference/design-system.md → 'Typography'.",
        },
      ],
    },
  },
  // The typography no-restricted-syntax rule above bans the literal
  // strings `text-sm`, `text-xs`, etc. anywhere in source — including
  // this very config, which has to MENTION those tokens to ban them.
  // Exempt the config file from the rule on itself.
  {
    files: ["eslint.config.mjs"],
    rules: { "no-restricted-syntax": "off" },
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
