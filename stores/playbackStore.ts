import { create } from 'zustand';
import type { CardState } from '@/types/asset';
import { setMasterVolume as setAudioMasterVolume } from '@/lib/sound/context';

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
 *
 * Now device-aware. The risk register listed "quality tiers; posters-only
 * mode below a device-capability threshold" as the mitigation for weaker
 * GPUs, but only the quality tiers were ever built — the budget itself was
 * a flat 3 regardless of what it was running on. A phone holding three
 * concurrent WebGL/p5 contexts is a materially different proposition from a
 * desktop doing the same, both for frame rate and for battery.
 *
 * Deliberately measured off capability signals rather than user-agent
 * sniffing: `pointer: coarse` says touch-primary, and hardwareConcurrency
 * says how much CPU is actually available. Both are honest about what the
 * device can do; a UA string is a guess about what it is.
 */
function detectRendererBudget(): number {
  // SSR and any environment without matchMedia get the desktop default —
  // this value is only ever consumed client-side, and guessing low on the
  // server would make the first client render disagree with the second.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 3;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;

  if (coarse && cores <= 4) return 1;
  if (coarse || cores <= 4) return 2;
  return 3;
}

export const MAX_LIVE_RENDERERS = detectRendererBudget();

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
  /** Tile sound presets (Phase 4.8). Governs the single shared master
      GainNode every tile's audio subgraph connects into — see
      lib/sound/context.ts's getMasterGain(). */
  masterVolume: number;
  muted: boolean;
  /**
   * Bumped whenever a focused view closes. Cards subscribe to this so the
   * grid thumbnail a focused overlay borrowed a renderer from re-checks
   * itself and reclaims a live preview, instead of sitting on a stale
   * poster until it happens to scroll off-screen and back.
   */
  epoch: number;
  /**
   * True while an asset is enlarged. Grid cards stop animating entirely so
   * all GPU budget and all visual attention go to the focused asset.
   */
  boardFrozen: boolean;

  /** assetId -> current card state. The pool is derived from this. */
  cardStates: Map<string, CardState>;

  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setGlobalSpeed: (speed: number) => void;
  setQuality: (quality: QualityTier) => void;
  setReducedMotion: (reduced: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
  toggleMuted: () => void;
  bumpEpoch: () => void;
  setBoardFrozen: (frozen: boolean) => void;

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
  masterVolume: 0.8,
  muted: false,
  epoch: 0,
  boardFrozen: false,
  cardStates: new Map(),

  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setGlobalSpeed: (globalSpeed) => set({ globalSpeed }),
  setQuality: (quality) => set({ quality }),
  setReducedMotion: (reducedMotion) =>
    set({ reducedMotion, paused: reducedMotion ? true : get().paused }),
  setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
  setMasterVolume: (masterVolume) => {
    set({ masterVolume });
    setAudioMasterVolume(get().muted ? 0 : masterVolume);
  },
  toggleMuted: () =>
    set((s) => {
      const muted = !s.muted;
      setAudioMasterVolume(muted ? 0 : s.masterVolume);
      return { muted };
    }),
  bumpEpoch: () => set((s) => ({ epoch: s.epoch + 1 })),
  setBoardFrozen: (boardFrozen) => set({ boardFrozen }),

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
