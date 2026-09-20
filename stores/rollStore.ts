import { create } from 'zustand';

/**
 * Roll / Mutate preferences and per-asset locks.
 *
 * DEVICE-LOCAL by design (localStorage), not synced to the account: a lock is a
 * working habit rather than part of a tile's look, and syncing it would need a
 * schema migration and a new validated API field. Everything read back from
 * storage is treated as untrusted — malformed data is ignored, never thrown on
 * (private-mode Safari and blocked storage both make localStorage throw).
 *
 * Locks are keyed by ASSET id, so a tile and its snapshots share them.
 */

export const DEFAULT_STRENGTH = 25; // percent
export const MIN_STRENGTH = 5;
export const MAX_STRENGTH = 100;

const PREFS_KEY = 'vml:roll:prefs';
const locksKey = (assetId: string) => `vml:roll:locks:${assetId}`;
const MAX_LOCKS = 512;

interface Prefs {
  strength: number;
  includeToggles: boolean;
}

function readJson(key: string): unknown {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — locks then simply last for this session */
  }
}

function clampStrength(n: number): number {
  return Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, Math.round(n)));
}

export function parsePrefs(raw: unknown): Prefs {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    strength: typeof o.strength === 'number' && Number.isFinite(o.strength) ? clampStrength(o.strength) : DEFAULT_STRENGTH,
    includeToggles: o.includeToggles === true,
  };
}

export function parseLocks(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128).slice(0, MAX_LOCKS));
}

interface RollState {
  assetId: string | null;
  locked: ReadonlySet<string>;
  /** 5..100, percent. Mutate's strength. */
  strength: number;
  includeToggles: boolean;

  loadFor: (assetId: string | null) => void;
  toggleLock: (controlId: string) => void;
  /** Lock (or unlock) several controls at once — the section-level lock. */
  setLocks: (controlIds: readonly string[], locked: boolean) => void;
  clearLocks: () => void;
  setStrength: (percent: number) => void;
  setIncludeToggles: (on: boolean) => void;

  /** One-line feedback for the last action ("Rolled 12 controls"); clears itself. */
  message: string | null;
  announce: (message: string) => void;
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;
const MESSAGE_MS = 3200;

export const useRollStore = create<RollState>()((set, get) => {
  const persistLocks = (assetId: string | null, locked: ReadonlySet<string>) => {
    if (assetId) writeJson(locksKey(assetId), [...locked]);
  };

  return {
    assetId: null,
    locked: new Set(),
    strength: DEFAULT_STRENGTH,
    includeToggles: false,
    message: null,

    announce: (message) => {
      if (messageTimer) clearTimeout(messageTimer);
      set({ message });
      messageTimer = setTimeout(() => set({ message: null }), MESSAGE_MS);
    },

    loadFor: (assetId) => {
      const prefs = parsePrefs(readJson(PREFS_KEY));
      set({ assetId, locked: assetId ? parseLocks(readJson(locksKey(assetId))) : new Set(), ...prefs });
    },

    toggleLock: (controlId) => {
      const { assetId, locked } = get();
      const next = new Set(locked);
      if (!next.delete(controlId)) next.add(controlId);
      set({ locked: next });
      persistLocks(assetId, next);
    },

    setLocks: (controlIds, lock) => {
      const { assetId, locked } = get();
      const next = new Set(locked);
      for (const id of controlIds) {
        if (lock) next.add(id);
        else next.delete(id);
      }
      set({ locked: next });
      persistLocks(assetId, next);
    },

    clearLocks: () => {
      const { assetId } = get();
      set({ locked: new Set() });
      persistLocks(assetId, new Set());
    },

    setStrength: (percent) => {
      const strength = clampStrength(percent);
      set({ strength });
      writeJson(PREFS_KEY, { strength, includeToggles: get().includeToggles });
    },

    setIncludeToggles: (on) => {
      set({ includeToggles: on });
      writeJson(PREFS_KEY, { strength: get().strength, includeToggles: on });
    },
  };
});
