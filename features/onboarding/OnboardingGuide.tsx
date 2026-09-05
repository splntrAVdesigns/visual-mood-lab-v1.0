'use client';

import { useEffect, useState } from 'react';
import { useOnboardingStore } from './onboardingStore';
import { OnboardingCardShell } from './OnboardingCardShell';
import { OnboardingSheetShell } from './OnboardingSheetShell';
import { TOTAL_STEPS } from './content';

import { Step1Welcome } from './steps/Step1Welcome';
import { Step2Board } from './steps/Step2Board';
import { Step3Toolbar } from './steps/Step3Toolbar';
import { Step4Inspector } from './steps/Step4Inspector';
import { Step5Modulation } from './steps/Step5Modulation';
import { Step6SoundVfx } from './steps/Step6SoundVfx';
import { Step7Features } from './steps/Step7Features';
import { Step8Closing } from './steps/Step8Closing';

import { Step1WelcomeMobile } from './steps/Step1WelcomeMobile';
import { Step2BoardMobile } from './steps/Step2BoardMobile';
import { Step3ToolbarMobile } from './steps/Step3ToolbarMobile';
import { Step4InspectorMobile } from './steps/Step4InspectorMobile';
import { Step5ModulationMobile } from './steps/Step5ModulationMobile';
import { Step6SoundVfxMobile } from './steps/Step6SoundVfxMobile';
import { Step7FeaturesMobile } from './steps/Step7FeaturesMobile';
import { Step8ClosingMobile } from './steps/Step8ClosingMobile';

/**
 * Reports whether the current viewport matches the mobile breakpoint,
 * updating live on resize. Deliberately only used to gate *side effects*
 * (see isActiveViewport below), never to decide what to render — render
 * output must stay identical between server and client, but an effect
 * that only runs after mount carries no hydration risk no matter what it
 * reads.
 */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

const DESKTOP_STEPS: Record<number, React.ComponentType> = {
  1: Step1Welcome,
  2: Step2Board,
  3: Step3Toolbar,
  4: Step4Inspector,
  5: Step5Modulation,
  6: Step6SoundVfx,
  7: Step7Features,
  8: Step8Closing,
};

const MOBILE_STEPS: Record<number, React.ComponentType> = {
  1: Step1WelcomeMobile,
  2: Step2BoardMobile,
  3: Step3ToolbarMobile,
  4: Step4InspectorMobile,
  5: Step5ModulationMobile,
  6: Step6SoundVfxMobile,
  7: Step7FeaturesMobile,
  8: Step8ClosingMobile,
};

/**
 * Mount once, high in the tree (see AppChrome). Reads all its own state
 * from useOnboardingStore — no props needed. Renders both a desktop card
 * and a mobile sheet at all times; onboarding.module.css hides whichever
 * doesn't match the current breakpoint. This mirrors FocusedAssetOverlay /
 * MobileFocusedView rather than picking a variant in JS, so there's no
 * viewport-detection hydration mismatch for the *rendered output*.
 *
 * The one thing that genuinely can't be duplicated is dismissal side
 * effects — see isActiveViewport below and the fix note in
 * OnboardingCardShell.tsx. Only the shell matching the live viewport gets
 * `isActiveViewport=true`, so only one of the two ever actually runs
 * useDismissable's scroll-lock/focus-trap/Escape handling at a time.
 */
export function OnboardingGuide() {
  const isOpen = useOnboardingStore((st) => st.isOpen);
  const step = useOnboardingStore((st) => st.step);
  const close = useOnboardingStore((st) => st.close);
  const back = useOnboardingStore((st) => st.back);
  const next = useOnboardingStore((st) => st.next);
  const skip = useOnboardingStore((st) => st.skip);

  const isLastStep = step === TOTAL_STEPS;
  const isMobileViewport = useIsMobileViewport();
  const DesktopStep = DESKTOP_STEPS[step] ?? Step1Welcome;
  const MobileStep = MOBILE_STEPS[step] ?? Step1WelcomeMobile;

  return (
    <>
      <OnboardingCardShell
        open={isOpen}
        isActiveViewport={!isMobileViewport}
        step={step}
        onClose={close}
        onBack={back}
        onNext={next}
        onSkip={skip}
        isLastStep={isLastStep}
      >
        <DesktopStep />
      </OnboardingCardShell>

      <OnboardingSheetShell
        open={isOpen}
        isActiveViewport={isMobileViewport}
        step={step}
        onClose={close}
        onBack={back}
        onNext={next}
        onSkip={skip}
        isLastStep={isLastStep}
      >
        <MobileStep />
      </OnboardingSheetShell>
    </>
  );
}
