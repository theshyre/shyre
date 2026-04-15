# Appearance

Control how Shyre looks and sizes itself for your eyes. Both settings live on **Profile → Preferences** and persist to your account, so they follow you across devices.

## Where it lives

Sidebar → your avatar / name → **Profile** → **Preferences** section.

## Theme

Five options:

| Theme            | Notes |
|------------------|-------|
| **System**       | Follows your OS light/dark setting automatically. |
| **Light**        | Default light palette. Blue accent. |
| **Dark**         | Slate-blue dark palette, reduced contrast for long sessions. |
| **High contrast**| WCAG AAA-friendly; pure black-on-white with a deep blue accent. |
| **Warm**         | Reduced blue light, warm stone/amber palette. Easier on the eyes in the evening. |

Clicking a theme applies it instantly and saves it to your account — no separate "Save" step. The choice is mirrored to localStorage for anti-flash on next page load.

## Text size

Three sizes — Compact, Regular (default), Large — mapped to root font sizes of 14px, 16px, 18px. Every piece of text in Shyre uses `rem` units, so switching size scales the whole UI uniformly instead of touching a hundred places individually.

Pick Compact if you run Shyre in a sidebar next to your editor. Pick Large if you want readability from across the desk or have a 4K display scaled down.

Like theme, text size saves immediately and follows you across devices.

## What scales, what doesn't

- **Scales**: body text, labels, buttons, table cells, inline edits, the running timer readout, section headings.
- **Doesn't scale**: icons (kept at pixel-fixed sizes for crispness), avatars, CSV export output, printed invoices (those have their own layout).

## Quick access in the sidebar

Theme and text size also live in the sidebar footer so you can flip either without a detour through Profile:

- **Text size**: three `A` buttons in increasing size. The active one is highlighted.
- **Theme**: the palette icon opens a popover with all five options and a check next to the active one. Escape closes it.

Your app version (`Shyre v0.1.0`-style) is shown at the bottom of the sidebar, next to sign out. If you're reporting a bug, quote that string — it's baked in at build time so it pins the exact deploy you're seeing.

## Related

- Keyboard shortcuts: [shortcuts](keyboard-shortcuts.md)
- Profile & business identity: [business identity](business-identity.md)
