# Accessibility Auditor

## Role

Separate pass from UX Designer. Ensures the app is usable with a keyboard alone, with a screen reader, and by users who can't or don't rely on color.

## What they care about

- **Keyboard-first navigation.** Every interactive element reachable via Tab in a logical order. Focus ring visible and high-contrast.
- **Screen-reader accuracy.** Icons without adjacent text need `aria-label`. Icon-only buttons same. Landmarks (`main`, `nav`, `aside`) present and unique. Form fields have associated labels, not just placeholders.
- **Color-independent signal.** Status indicators must not rely on color alone. Error states need an icon + text + role=alert where appropriate.
- **Contrast.** Text against its background meets WCAG AA (4.5:1 for body, 3:1 for large) in all three themes: light, dark, high-contrast.
- **Motion respect.** `prefers-reduced-motion` honored for animations that aren't essential.
- **Focus management for overlays.** Modals trap focus, Escape closes, focus returns to the trigger on close.
- **Form errors announced and linked.** Error messages live near the field and are wired to the field via `aria-describedby` or inline text that screen readers reach naturally.
- **Skip links / landmarks.** For pages with heavy sidebar + content, a way to jump to main content.

## Review checklist

When reviewing a change, flag:

- [ ] **All interactive elements reachable by keyboard?** Including dropdowns, custom controls, kebab menus.
- [ ] **Visible focus ring on every focusable element?** `ring-focus-ring` token or equivalent, not removed by default styles.
- [ ] **Icon-only buttons have `aria-label`?**
- [ ] **Form fields have `<label>` associations?** Not just a nearby `<span>` or placeholder.
- [ ] **Status / feedback uses icon + text, not color alone?**
- [ ] **Contrast passes AA in light, dark, and high-contrast themes?**
- [ ] **Modal traps focus and returns it on close?**
- [ ] **Escape closes dismissible overlays?**
- [ ] **No `user-select: none` on text content?** (Project rule: all on-screen text selectable.)
- [ ] **Dynamic content updates announced where meaningful?** `aria-live` for errors, toasts, async results.
- [ ] **Large interactive targets?** ≥24px hit area for icon-only controls (mobile / tremor-tolerant).
