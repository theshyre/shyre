# Live updates & day rollover

Shyre keeps a loaded dashboard fresh without a manual refresh. Two things stay
live: the current **date**, and **background changes** made by teammates.

## Day rollover

When the local day changes past midnight while a page stays open, the "today"
markers move on their own — the **Today** pill, the "Today:" title in Day view,
and the highlighted column in Week view. You don't have to reload.

- It follows **your** local time (your timezone setting, or your browser's zone),
  so a teammate in another zone rolling into a new day never shifts your view.
- It only re-marks today. If you've navigated to a specific day or week, you
  **stay there** — rollover changes the decoration, not your place.
- If you're mid-edit in a cell when the day turns over, the marker moves but the
  background refresh waits until you finish typing, so nothing you're editing is
  disturbed.
- Screen readers hear a polite "the date has changed" announcement.

Under the hood a small provider checks the clock every minute and the moment you
return to a backgrounded tab, so it catches up even after the laptop sleeps.

## Background changes ("N new updates")

When a teammate logs time, edits an entry, or an invoice is paid, a small
**"N new updates · Refresh"** pill appears at the bottom of the screen. Click it
to pull the changes in.

It's deliberately **your choice** to apply — updates never reflow the page or
overwrite what you're working on until you click. A burst of activity (like a
bulk import) is coalesced so the count stays sensible rather than spiking into
the hundreds.

Live updates are scoped to **your teams** only, and the signal that drives them
carries no data — just a "something changed" ping. The refresh itself re-fetches
through the normal permission checks, so you only ever see rows you're allowed to
see. (Design + security rationale: **SAL-035** in the security audit log.)
