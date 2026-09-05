'use client';

import { useRef, type ReactNode } from 'react';
import { CloseIcon, useDismissable } from '@/components/ui';
import { TOTAL_STEPS, STEP_EYEBROWS } from './content';
import s from './onboarding.module.css';

interface OnboardingCardShellProps {
  open: boolean;
  /** True only when the viewport currently matches this shell (desktop
      here, mobile in OnboardingSheetShell) — see the fix note below. */
  isActiveViewport: boolean;
  step: number;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  /** Last step renders "Start exploring" instead of "Next →". */
  isLastStep: boolean;
  children: ReactNode;
}

/**
 * Fixed bug, worth keeping the history: this comment originally argued
 * the double-mount (this shell + OnboardingSheetShell, both always
 * rendered, CSS hides one) was safe for useDismissable's body-scroll-lock
 * too, on the theory that both effects lock/unlock the same value so it
 * doesn't matter that both run. That reasoning was wrong. In practice:
 * whichever shell's effect runs SECOND captures `document.body.style.
 * overflow` as already `'hidden'` (the first shell's effect just set it),
 * not the true original value. On close, the first shell's cleanup
 * correctly restores the real original — but the second shell's cleanup
 * then runs and sets it back to `'hidden'` again, since that's the
 * (wrong) "previous" value *it* captured. Net effect: scroll stays locked
 * after closing the guide. This reproduced reliably on mobile (confirmed
 * against real device testing) because the board there relies on native
 * body/window scroll, so a stuck `overflow:hidden` is immediately
 * visible; it was very likely present on desktop too, just harder to
 * notice.
 *
 * Fix: only the shell matching the live viewport (`isActiveViewport`,
 * computed once in OnboardingGuide via a `matchMedia` effect — safe
 * because it only gates a side effect, never render output) passes a real
 * `open` value into useDismissable. The other always passes `false`, so
 * its useDismissable is a no-op — no lock, no focus-trap, no Escape
 * handler — regardless of the guide's true open state. `data-open` below
 * still reflects the real `open` prop unconditionally, since that's what
 * drives this shell's own CSS visibility and must stay correct at both
 * viewport sizes.
 */
export function OnboardingCardShell({
  open,
  isActiveViewport,
  step,
  onClose,
  onBack,
  onNext,
  onSkip,
  isLastStep,
  children,
}: OnboardingCardShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissable(open && isActiveViewport, onClose, panelRef, true);

  return (
    <div
      className={s.scrim}
      data-open={open ? 'true' : 'false'}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding guide — step ${step} of ${TOTAL_STEPS}`}
      >
        <div className={s.topbar}>
          <div className={s.eyebrow}>
            STEP <b>{step}</b> / {TOTAL_STEPS} &nbsp;&middot;&nbsp; {STEP_EYEBROWS[step]}
          </div>
          <button type="button" className={s.closeBtn} aria-label="Close guide" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={s.content}>{children}</div>

        <div className={s.progress}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`${s.dot} ${n === step ? s.dotActive : ''}`} />
          ))}
        </div>

        <div className={s.footer}>
          {!isLastStep ? (
            <button type="button" className={s.skipLink} onClick={onSkip}>
              Skip guide
            </button>
          ) : (
            <span />
          )}
          <div className={s.navGroup}>
            {step > 1 && (
              <button type="button" className={s.backBtn} onClick={onBack}>
                Back
              </button>
            )}
            <span className={s.stepCount}>
              {step} / {TOTAL_STEPS}
            </span>
            {isLastStep ? (
              <button type="button" className={s.doneBtn} onClick={onClose}>
                Start exploring
              </button>
            ) : (
              <button type="button" className={s.nextBtn} onClick={onNext}>
                Next <span aria-hidden="true">&rarr;</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
