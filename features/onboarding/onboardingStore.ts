import { create } from 'zustand';
import { TOTAL_STEPS } from './content';

const HAS_OPENED_KEY = 'vml:onboarding-has-opened';
const LAST_STEP_KEY = 'vml:onboarding-last-step';

function readHasOpened(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HAS_OPENED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readLastStep(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(LAST_STEP_KEY);
    const n = raw ? Number(raw) : 1;
    return Number.isFinite(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1;
  } catch {
    return 1;
  }
}

function writeHasOpened(): void {
  try {
    window.localStorage.setItem(HAS_OPENED_KEY, 'true');
  } catch {
    // Private browsing / storage disabled — preference just won't persist.
  }
}

function writeLastStep(step: number): void {
  try {
    window.localStorage.setItem(LAST_STEP_KEY, String(step));
  } catch {
    // Same as above — non-fatal.
  }
}

interface OnboardingState {
  isOpen: boolean;
  step: number;
  /**
   * Whether the guide has ever been opened on this device. Read once on
   * mount (see useOnboardingAutoOpen below is intentionally NOT included
   * here — this store does not auto-open itself; a caller decides that,
   * same separation AppChrome already keeps between state and policy for
   * settingsOpen/accountOpen). Kept in the store (not a bare hook) so both
   * the header CTA's pulse and the drawer item can read it without each
   * re-deriving their own localStorage read.
   */
  hasOpened: boolean;

  open: (atStep?: number) => void;
  close: () => void;
  next: () => void;
  back: () => void;
  goToStep: (step: number) => void;
  skip: () => void;
}

/*
 * Plain create(), no persist middleware — matches every other store in
 * this codebase (inspectorStore, boardStore, playbackStore all hand-roll
 * their own persistence at the point of mutation rather than reaching for
 * zustand/middleware). hasOpened/step are hydrated from localStorage
 * lazily inside open()/next()/etc., not at module init, so this store is
 * safe to import on the server without a hydration mismatch — it starts
 * closed with step 1 on both server and client, same guard shape as
 * useTooltipsEnabled's "start false on both, sync after mount."
 */
export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  isOpen: false,
  step: 1,
  hasOpened: false,

  open: (atStep) => {
    const resume = atStep ?? readLastStep();
    writeHasOpened();
    set({ isOpen: true, step: resume, hasOpened: true });
  },

  close: () => {
    writeLastStep(get().step);
    set({ isOpen: false });
  },

  next: () => {
    const step = Math.min(get().step + 1, TOTAL_STEPS);
    writeLastStep(step);
    set({ step });
  },

  back: () => {
    const step = Math.max(get().step - 1, 1);
    writeLastStep(step);
    set({ step });
  },

  goToStep: (step) => {
    const clamped = Math.max(1, Math.min(step, TOTAL_STEPS));
    writeLastStep(clamped);
    set({ step: clamped });
  },

  skip: () => {
    writeLastStep(TOTAL_STEPS);
    set({ isOpen: false });
  },
}));

/**
 * Call once on mount (e.g. from AppChrome) to sync `hasOpened` from
 * storage without forcing the guide open. Separate from the store's own
 * initial state so importing the store elsewhere never has a side effect.
 */
export function useOnboardingHasOpenedSync(): void {
  if (typeof window === 'undefined') return;
  const stored = readHasOpened();
  if (stored !== useOnboardingStore.getState().hasOpened) {
    useOnboardingStore.setState({ hasOpened: stored });
  }
}
