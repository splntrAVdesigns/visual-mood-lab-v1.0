// lib/roll/history.ts
//
// The undo stack for batch operations (Roll, Mutate, Restore defaults).
//
// Pure functions over an immutable `{ past, future }` so it slots straight into
// a Zustand store. Scope is deliberately narrow: ONLY whole-state batch
// operations are recorded. Recording every slider drag would flood a 20-deep
// stack in a second and needs coalescing to be useful — a separate feature.
//
// Entries are stored as clones (plain JSON: ParamState holds numbers, strings,
// booleans, small arrays and {r,g,b,a} objects) so nothing that later mutates
// the live state can reach back into history. JSON rather than structuredClone
// because older Safari (pre-15.4) doesn't have the latter.

import type { ParamState } from '@/renderers/control-schema';

export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  params: ParamState;
  /** Control ids showing the "modified" dot. */
  dirty: string[];
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

export function cloneEntry(entry: HistoryEntry): HistoryEntry {
  return { params: JSON.parse(JSON.stringify(entry.params)) as ParamState, dirty: [...entry.dirty] };
}

/** Record the state as it was BEFORE a batch operation. Clears redo. */
export function recordHistory(h: History, before: HistoryEntry, limit: number = HISTORY_LIMIT): History {
  const past = [...h.past, cloneEntry(before)];
  while (past.length > limit) past.shift();
  return { past, future: [] };
}

/** Step back. `current` is pushed onto redo. Null when there is nothing to undo. */
export function undoHistory(h: History, current: HistoryEntry): { history: History; entry: HistoryEntry } | null {
  if (h.past.length === 0) return null;
  const entry = h.past[h.past.length - 1];
  return {
    entry: cloneEntry(entry),
    history: { past: h.past.slice(0, -1), future: [...h.future, cloneEntry(current)] },
  };
}

/** Step forward. `current` is pushed back onto undo. Null when there is nothing to redo. */
export function redoHistory(h: History, current: HistoryEntry): { history: History; entry: HistoryEntry } | null {
  if (h.future.length === 0) return null;
  const entry = h.future[h.future.length - 1];
  return {
    entry: cloneEntry(entry),
    history: { past: [...h.past, cloneEntry(current)], future: h.future.slice(0, -1) },
  };
}
