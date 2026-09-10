/**
 * Opens (or focuses, if already open) the companion window — see
 * relay.ts's file comment for the whole "why not Document PiP" story.
 * window.open() with a fixed target name ('huddle-companion') reuses the
 * same browser window/tab across repeated clicks instead of piling up
 * duplicates.
 *
 * Sizing/centering copied from CrewBoard's Layout.jsx fix (2026-08-04):
 * window.open() with no left/top in its features string leaves placement
 * entirely up to the browser, which for most browsers means "top-left
 * corner of the screen" — not a natural spot for a companion window.
 * availWidth/availHeight (not width/height) avoid overlapping the OS
 * taskbar/dock; availLeft/availTop account for a secondary monitor
 * positioned left of/above the primary one (Chrome/Firefox both support
 * these; falls back to 0 where they don't, same as if this weren't here).
 */
export function openCompanionWindow(): void {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('companion', '1');

  // availLeft/availTop aren't in TS's own Screen type (Chrome/Firefox-only,
  // unstandardized — same as CrewBoard's source for this sizing logic).
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const availWidth = screen.availWidth || screen.width;
  const availHeight = screen.availHeight || screen.height;
  const availLeft = screen.availLeft || 0;
  const availTop = screen.availTop || 0;
  const width = Math.round(availWidth / 2);
  const height = Math.round(availHeight / 2);
  const left = Math.round(availLeft + (availWidth - width) / 2);
  const top = Math.round(availTop + (availHeight - height) / 2);

  window.open(url.toString(), 'huddle-companion', `width=${width},height=${height},left=${left},top=${top}`);
}
