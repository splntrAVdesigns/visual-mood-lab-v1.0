'use client';

import { useRef, type ReactNode } from 'react';
import { CloseIcon, useDismissable } from '@/components/ui';
import { TOTAL_STEPS, STEP_EYEBROWS } from './content';
import s from './onboarding.module.css';

interface OnboardingCardShellProps {
  open: boolean;
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
 * Note on double-mount: both this shell and OnboardingSheetShell call
 * useDismissable with the same `open` state, and both are always mounted
 * (see OnboardingGuide's doc comment for why). This is safe, not just
 * expedient: the CSS-hidden shell's panel has no `offsetParent`, so
 * useDismissable's own focus-steal and tab-trap logic silently no-op
 * against it (browsers don't move focus into display:none subtrees, and
 * the tab-trap filters on offsetParent !== null). The Escape handler and
 * body-scroll-lock in the hidden shell are redundant with the visible
 * one's but harmless — same onClose either way, same overflow value
 * either way.
 */
export function OnboardingCardShell({
  open,
  step,
  onClose,
  onBack,
  onNext,
  onSkip,
  isLastStep,
  children,
}: OnboardingCardShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, panelRef, true);

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
