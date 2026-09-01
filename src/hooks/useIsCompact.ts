import { useEffect, useState } from 'react';

/**
 * True when the widget's own viewport is small enough that it's almost
 * certainly rendering inside Element's floating PiP window rather than the
 * normal docked panel/room view. There's no direct signal for this from
 * the Widget API — confirmed by testing (no PiP/floating capability or
 * event exists) — so this is a size heuristic instead: Element's PiP was
 * measured at 330×304 CSS px live (mx_PictureInPictureDragger), so
 * anything under 400px in either dimension is treated as compact.
 *
 * Reactive to resize — Element resizes the iframe when the widget is
 * pinned/unpinned or the browser window changes, not just on initial load.
 */
const COMPACT_THRESHOLD = 400;

function computeIsCompact(): boolean {
  return window.innerWidth < COMPACT_THRESHOLD || window.innerHeight < COMPACT_THRESHOLD;
}

export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(computeIsCompact);

  useEffect(() => {
    const onResize = () => setCompact(computeIsCompact());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return compact;
}
