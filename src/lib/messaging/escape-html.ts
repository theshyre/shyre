/**
 * Minimal HTML entity escaping for user-controlled strings interpolated into
 * email bodies. Email clients render injected markup (links, images, layout
 * breaks) even though they sandbox scripts — and our sends ride a VERIFIED
 * team domain, so injected content inherits real credibility. Escape every
 * user-authored value before it enters `bodyHtml`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
