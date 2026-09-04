'use client';

import { useRef, type ReactNode } from 'react';
import { CloseIcon, useDismissable } from '@/components/ui';
import { TOTAL_STEPS, STEP_EYEBROWS } from './content';
import s from './onboarding.module.css';

interface OnboardingSheetShellProps {
  open: boolean;
  step: number;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  isLastStep: boolean;
  children: ReactNode;
}

export function OnboardingSheetShell({
  open,
  step,
  onClose,
  onBack,
  onNext,
  onSkip,
  isLastStep,
  children,
}: OnboardingSheetShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, panelRef, true);

  return (
    <div className={s.mobileRoot} data-open={open ? 'true' : 'false'}>
      <div
        ref={panelRef}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding guide — step ${step} of ${TOTAL_STEPS}`}
      >
        <div className={s.sheetTopbar}>
          <div className={s.eyebrow}>
            STEP <b>{step}</b> / {TOTAL_STEPS} &nbsp;&middot;&nbsp; {STEP_EYEBROWS[step]}
          </div>
          <button
            type="button"
            className={s.sheetCloseBtn}
            aria-label="Close guide"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={s.sheetBody}>{children}</div>

        <div className={s.sheetSpacer} />

        <div className={s.sheetProgress}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`${s.dot} ${n === step ? s.dotActive : ''}`} />
          ))}
        </div>

        <div className={s.sheetFooter}>
          <div className={s.btnRow}>
            {step > 1 && (
              <button type="button" className={s.sheetBackBtn} onClick={onBack}>
                Back
              </button>
            )}
            {isLastStep ? (
              <button type="button" className={s.sheetDoneBtn} onClick={onClose}>
                Start exploring
              </button>
            ) : (
              <button type="button" className={s.sheetNextBtn} onClick={onNext}>
                Next <span aria-hidden="true">&rarr;</span>
              </button>
            )}
          </div>
          {!isLastStep && (
            <div className={s.footerRow2}>
              <button type="button" className={s.skipLink} onClick={onSkip}>
                Skip guide
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
