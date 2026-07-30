import { create } from 'zustand';
import type { CardState } from '@/types/asset';

/**
 * Global playback state. In Phase 2 the renderer pool reads from here, and a
 * single requestAnimationFrame loop drives every live renderer — never one
 * loop per card.
 */

export type QualityTier = 'auto' | 'preview' | 'full';

/**
 * Hard ceiling on simultaneously animating cards.
 *
 * Lowered from 6 to 3: six live renderers meant six independent workloads
 * (three of which could be p5 iframes running their own animation loops)
 * competing for one GPU, so every card ran badly rather than a few running
 * well. Three is the point where each one stays smooth.
 */
export const MAX_LIVE_RENDERERS = 3;

interface PlaybackState {
  /** Master transport. When true, nothing animates anywhere. */
  paused: boolean;
  /** Global speed multiplier applied on top of per-asset speed. */
  globalSpeed: number;
  quality: QualityTier;
  /** True when the OS asks for reduced motion. Set once on mount. */
  reducedMotion: boolean;
  /** Audio input feeding the modulation bus. Phase 4. */
  audioEnabled: boolean;
  /**
   * Bumped whenever a focused view closes. Cards subscribe to this so the
   * grid thumbnail a focused overlay borrowed a renderer from re-checks
   * itself and reclaims a live preview, instead of sitting on a stale
   * poster until it happens to scroll off-screen and back.
   */
  epoch: number;

  /** assetId -> current card state. The pool is derived from this. */
  cardStates: Map<string, CardState>;

  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setGlobalSpeed: (speed: number) => void;
  setQuality: (quality: QualityTier) => void;
  setReducedMotion: (reduced: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  bumpEpoch: () => void;

  promote: (assetId: string, state: CardState) => void;
  demote: (assetId: string) => void;
  liveCount: () => number;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  paused: false,
  globalSpeed: 1,
  quality: 'auto',
  reducedMotion: false,
  audioEnabled: false,
  epoch: 0,
  cardStates: new Map(),

  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setGlobalSpeed: (globalSpeed) => set({ globalSpeed }),
  setQuality: (quality) => set({ quality }),
  setReducedMotion: (reducedMotion) =>
    set({ reducedMotion, paused: reducedMotion ? true : get().paused }),
  setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
  bumpEpoch: () => set((s) => ({ epoch: s.epoch + 1 })),

  /**
   * Promote a card. Enforces the live-renderer ceiling by evicting the
   * least-recently-promoted preview card. A focused card is never evicted.
   */
  promote: (assetId, state) =>
    set((s) => {
      const next = new Map(s.cardStates);
      next.delete(assetId);
      next.set(assetId, state);

      if (state !== 'poster') {
        const live = [...next.entries()].filter(([, v]) => v !== 'poster');
        let overBudget = live.length - MAX_LIVE_RENDERERS;

        // Map preserves insertion order, so the head is the oldest promotion.
        for (const [id, v] of live) {
          if (overBudget <= 0) break;
          if (id === assetId || v === 'focused') continue;
          next.set(id, 'poster');
          overBudget--;
        }
      }

      return { cardStates: next };
    }),

  demote: (assetId) =>
    set((s) => {
      const next = new Map(s.cardStates);
      next.set(assetId, 'poster');
      return { cardStates: next };
    }),

  liveCount: () => {
    let n = 0;
    for (const v of get().cardStates.values()) if (v !== 'poster') n++;
    return n;
  },
}));

export function cardStateOf(s: PlaybackState, assetId: string): CardState {
  return s.cardStates.get(assetId) ?? 'poster';
}
