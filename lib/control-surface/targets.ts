import type { TargetRef } from './types';

/** Focused follows the board selection; Pinned is explicit; Global is reserved. */
export function resolveTargetCardId(target: TargetRef, focusedCardId: string | null): string | null {
  if (target.scope === 'focused') return focusedCardId;
  if (target.scope === 'pinned') return target.cardId?.trim() || null;
  return null;
}

export function validateTargetRef(target: TargetRef): string | null {
  if (target.scope === 'pinned' && !target.cardId?.trim()) {
    return 'Pinned targets require cardId.';
  }

  switch (target.domain) {
    case 'parameter':
      return target.controlId.trim() ? null : 'Parameter target requires controlId.';
    case 'effect':
      if (!target.effectInstanceId.trim()) return 'Effect target requires effectInstanceId.';
      return target.controlId.trim() ? null : 'Effect target requires controlId.';
    case 'action':
      return target.actionId.trim() ? null : 'Action target requires actionId.';
  }
}

/** Stable persisted identity (scope included). */
export function targetKey(target: TargetRef): string {
  const scope = target.scope === 'pinned' ? `pinned:${target.cardId ?? ''}` : target.scope;
  switch (target.domain) {
    case 'parameter':
      return `${scope}:parameter:${target.controlId}`;
    case 'effect':
      return `${scope}:effect:${target.effectInstanceId}:${target.controlId}`;
    case 'action':
      return `${scope}:action:${target.actionId}:${target.controlId ?? ''}`;
  }
}

/** Runtime identity after a Focused target has resolved to a concrete card. */
export function resolvedTargetKey(target: TargetRef, cardId: string): string {
  switch (target.domain) {
    case 'parameter':
      return `${cardId}:parameter:${target.controlId}`;
    case 'effect':
      return `${cardId}:effect:${target.effectInstanceId}:${target.controlId}`;
    case 'action':
      return `${cardId}:action:${target.actionId}:${target.controlId ?? ''}`;
  }
}
