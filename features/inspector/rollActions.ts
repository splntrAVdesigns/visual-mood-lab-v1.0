import { useInspectorStore } from '@/stores/inspectorStore';
import type { RollSummary } from '@/stores/inspectorStore';
import { useRollStore } from '@/stores/rollStore';

/**
 * The four actions the Roll bar and the keyboard shortcuts share. One module so
 * a button press and a keypress can never drift apart in behaviour or wording.
 */

/** Tiles Roll applies to: the ones whose look is made of tile parameters. */
export function isRollableAssetType(type: string): boolean {
  return type === 'shader' || type === 'p5';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(verb: string, s: RollSummary | null, noun: 'Roll' | 'Mutate'): string | null {
  if (!s) return null;
  if (s.changed > 0) return `${verb} ${plural(s.changed, 'control')}`;
  if (s.eligible === 0) {
    return s.locked > 0 ? 'Everything that could change is locked' : 'Nothing on this tile can be rolled';
  }
  return noun === 'Mutate' ? 'Mutate changed nothing at this strength' : 'That roll changed nothing — try again';
}

export function performRoll(): void {
  const msg = describe('Rolled', useInspectorStore.getState().rollParams(), 'Roll');
  if (msg) useRollStore.getState().announce(msg);
}

export function performMutate(): void {
  const strength = useRollStore.getState().strength / 100;
  const msg = describe('Mutated', useInspectorStore.getState().mutateParams(strength), 'Mutate');
  if (msg) useRollStore.getState().announce(msg);
}

export function performUndo(): void {
  if (useInspectorStore.getState().undoParams()) useRollStore.getState().announce('Undone');
}

export function performRedo(): void {
  if (useInspectorStore.getState().redoParams()) useRollStore.getState().announce('Redone');
}
