'use client';

import { useRef, type MouseEvent, type PointerEvent } from 'react';
import {
  EMPTY_PRESS,
  decideDismiss,
  recordPress,
  recordRelease,
  type PressState,
} from '@/lib/ui/backdrop-dismiss';

interface Options {
  /**
   * Whether `target` counts as "the backdrop" for a press/release/click.
   * Default: the backdrop element itself. Override when the backdrop has
   * transparent non-content children that should also count (the focused
   * view's sidecar stack and spacer).
   */
  isBackdrop?: (target: Element | null, backdrop: Element) => boolean;
  /** When false the returned click handler does nothing (e.g. a modeless mode). */
  enabled?: boolean;
}

/**
 * Spread onto a modal's backdrop element. Dismisses on a backdrop click ONLY
 * when the press and the release both landed on the backdrop — so a press
 * that starts inside the panel and ends over the backdrop (text selection,
 * dragging out of an input) no longer closes it. See lib/ui/backdrop-dismiss.
 *
 * Pointer handlers use the CAPTURE phase so they see every press and release
 * beneath the backdrop even when descendants call stopPropagation.
 */
export function useBackdropDismiss(onDismiss: () => void, options: Options = {}) {
  const { isBackdrop = (target, backdrop) => target === backdrop, enabled = true } = options;
  const state = useRef<PressState>(EMPTY_PRESS);

  return {
    onPointerDownCapture: (e: PointerEvent<HTMLElement>) => {
      state.current = recordPress(isBackdrop(e.target as Element | null, e.currentTarget));
    },
    onPointerUpCapture: (e: PointerEvent<HTMLElement>) => {
      state.current = recordRelease(state.current, isBackdrop(e.target as Element | null, e.currentTarget));
    },
    // An interrupted gesture (touch scroll takeover, etc.) is not a click.
    onPointerCancelCapture: () => {
      state.current = EMPTY_PRESS;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const decision = decideDismiss(state.current, isBackdrop(e.target as Element | null, e.currentTarget));
      state.current = decision.next;
      if (enabled && decision.dismiss) onDismiss();
    },
  };
}
