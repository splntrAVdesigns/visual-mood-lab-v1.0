'use client';

import { useEffect } from 'react';
import { useInspectorStore } from '@/stores';
import { isRollableAssetType, performMutate, performRedo, performRoll, performUndo } from './rollActions';

/** True when the keystroke is meant for a text field (or the code editor) rather than for us. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    // Sliders / checkboxes / buttons-as-inputs aren't text entry.
    const type = (el as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || !!el.closest('.cm-editor, [role="textbox"]');
}

/**
 * Is a dialog showing ON TOP of the tile (Settings, the onboarding guide, …)?
 *
 * Two traps this avoids, both found by testing in a real browser:
 *  - the focused tile's own view is `aria-modal` too, hence the explicit
 *    `data-focused-view` exclusion;
 *  - the onboarding guide's card and sheet are ALWAYS mounted (hidden by a
 *    `display: none` ancestor), so "an aria-modal element exists" is true for
 *    every user at every moment. Only a dialog that is actually laid out on
 *    screen counts — hence the layout-rect check rather than a bare query.
 */
function blockingDialogOpen(): boolean {
  for (const el of document.querySelectorAll('[aria-modal="true"]:not([data-focused-view])')) {
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}

/**
 * R = Roll, M = Mutate, ⌘/Ctrl+Z = Undo, ⇧⌘/Ctrl+Z (or Ctrl+Y) = Redo.
 *
 * Mounted ONCE, from AppShell — not per Roll bar. The desktop drawer and the
 * mobile sheet each render a Roll bar, so a listener inside the bar could fire
 * twice for a single keypress.
 *
 * Active only while an inspector is open on a rollable tile, never inside a
 * text field / code editor (Undo there must stay the browser's own), and never
 * behind a dialog that sits on top of the tile. Keystrokes with focus INSIDE a sketch iframe don't
 * reach the page — the sandbox forwards only F and Escape — so the buttons are
 * the way in from there.
 */
export function useRollShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey) return;

      const inspector = useInspectorStore.getState();
      if (!inspector.open || !inspector.schema) return;
      // From the inspector store, not the board store: a draft that isn't on the board still counts.
      if (!inspector.assetType || !isRollableAssetType(inspector.assetType)) return;
      if (isTypingTarget(e.target)) return;
      if (blockingDialogOpen()) return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) performRedo();
          else performUndo();
        } else if (key === 'y' && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          performRedo();
        }
        return;
      }
      if (e.shiftKey) return;

      if (key === 'r') {
        e.preventDefault();
        performRoll();
      } else if (key === 'm') {
        e.preventDefault();
        performMutate();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
