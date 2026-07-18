import type { ReactNode } from "react";

/**
 * Layout for the public proposal sign-off surface.
 *
 * The sign page is a formal, client-facing DOCUMENT — not the dense dashboard
 * UI it inherits its type scale from (dashboard body text is ~13px, right for
 * a data-dense app, too small for a proposal a client reads and signs). Every
 * sign-page element uses the rem-based semantic type tokens, and layout
 * dimensions are px per CLAUDE.md, so bumping the ROOT font-size here (in %, so the visitor's own
 * browser default-font-size preference still compounds — WCAG 1.4.4) scales
 * the whole document's TYPE up uniformly while the 720px reading column stays
 * put — exactly "make the text bigger, not the box."
 *
 * Scoped to the `(sign)` route group: this `<style>` only exists in the DOM
 * while a `/sign` route is mounted. `(sign)` and `(dashboard)` are sibling
 * route groups that never render together, so the override reverts the moment
 * you leave `/sign` — the dashboard keeps its own scale. The `html[data-text-
 * size]` selector ties the theme store's own font-size rules on specificity
 * and wins on source order (this tag renders after the head stylesheet), so it
 * holds even for a visitor who has used Shyre and carries a stored text-size
 * preference; the bare `html` selector covers the logged-out signer whose
 * `<html>` has no `data-text-size` attribute yet.
 */
export default function SignLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: "html,html[data-text-size]{font-size:125%}",
        }}
      />
      {children}
    </>
  );
}
