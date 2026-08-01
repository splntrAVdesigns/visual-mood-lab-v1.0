'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the app should use its mobile layout.
 *
 * Driven by viewport width and pointer type, not user-agent sniffing. A
 * narrow window on a desktop gets the same treatment as a phone, which is
 * correct — the layout is responding to available space and input method,
 * not guessing what hardware someone owns. This is the same reasoning
 * behind how the renderer budget is chosen in playbackStore.
 *
 * The breakpoint is 820px rather than a phone-sized number because that is
 * where the desktop focused view genuinely stops working: a 1:1 graphic
 * beside a 360px inspector drawer needs roughly that much room before the
 * graphic starts being squeezed into uselessness.
 *
 * Returns false during SSR and the first client render, then corrects on
 * mount. Guessing mobile on the server would produce a hydration mismatch,
 * since the server has no viewport to measure.
 */
const MOBILE_QUERY = '(max-width: 820px), (pointer: coarse) and (max-width: 1024px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mq = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
