'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONTROL_SURFACE_CHANGE_EVENT,
  bindingsForTarget,
  createEmptyControlSurfaceDocument,
  loadControlSurfaceDocument,
  type ControlSurfaceDocument,
  type TargetRef,
} from '@/lib/control-surface';

export interface ControllerTargetState {
  active: boolean;
  hasDirect: boolean;
  hasModulation: boolean;
  hasAction: boolean;
  hasMidi: boolean;
  hasGamepad: boolean;
  bindingCount: number;
  shortLabel: string | null;
}

export function useControllerDocument(): ControlSurfaceDocument {
  const [document, setDocument] = useState<ControlSurfaceDocument>(() =>
    typeof window === 'undefined'
      ? createEmptyControlSurfaceDocument()
      : loadControlSurfaceDocument().document,
  );

  useEffect(() => {
    const refresh = () => setDocument(loadControlSurfaceDocument().document);
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === 'vml.control-surface.v1') refresh();
    };
    window.addEventListener(CONTROL_SURFACE_CHANGE_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    refresh();
    return () => {
      window.removeEventListener(CONTROL_SURFACE_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return document;
}

export function useControllerTargetState(
  itemId: string | null,
  controlId: string,
  effectInstanceId?: string,
): ControllerTargetState {
  const document = useControllerDocument();
  return useMemo(
    () => controllerTargetState(document, itemId, controlId, effectInstanceId),
    [document, itemId, controlId, effectInstanceId],
  );
}

export function controllerTargetState(
  document: ControlSurfaceDocument,
  itemId: string | null,
  controlId: string,
  effectInstanceId?: string,
): ControllerTargetState {
  if (!itemId) return emptyState();

  // Build the discriminated TargetRef branches explicitly. Using a separate
  // `domain` variable does not narrow the optional effectInstanceId for
  // TypeScript, so the previous conditional produced
  // `effectInstanceId: string | undefined` for an EffectTargetRef and failed
  // the production type check even though the runtime branch was correct.
  let focused: TargetRef;
  let pinned: TargetRef;

  if (effectInstanceId) {
    focused = {
      scope: 'focused',
      domain: 'effect',
      effectInstanceId,
      controlId,
    };
    pinned = {
      scope: 'pinned',
      cardId: itemId,
      domain: 'effect',
      effectInstanceId,
      controlId,
    };
  } else {
    focused = {
      scope: 'focused',
      domain: 'parameter',
      controlId,
    };
    pinned = {
      scope: 'pinned',
      cardId: itemId,
      domain: 'parameter',
      controlId,
    };
  }

  const rows = [...bindingsForTarget(document, focused), ...bindingsForTarget(document, pinned)]
    .filter(({ binding }) => binding.enabled !== false);
  const seen = new Set<string>();
  const unique = rows.filter(({ binding }) => {
    if (seen.has(binding.id)) return false;
    seen.add(binding.id);
    return true;
  });

  if (unique.length === 0) return emptyState();

  const hasMidi = unique.some(({ profile }) => profile.transport === 'midi');
  const hasGamepad = unique.some(({ profile }) => profile.transport === 'gamepad');
  const hasDirect = unique.some(({ binding }) => binding.path === 'direct');
  const hasModulation = unique.some(({ binding }) => binding.path === 'modulation');
  const hasAction = unique.some(({ binding }) => binding.path === 'action');

  const transports = [hasMidi ? 'MIDI' : null, hasGamepad ? 'GAMEPAD' : null].filter(Boolean).join(' + ');
  const paths = [hasDirect ? 'DIRECT' : null, hasModulation ? 'MOD' : null, hasAction ? 'ACTION' : null]
    .filter(Boolean)
    .join(' + ');

  return {
    active: true,
    hasDirect,
    hasModulation,
    hasAction,
    hasMidi,
    hasGamepad,
    bindingCount: unique.length,
    shortLabel: paths ? `${transports} · ${paths}` : transports,
  };
}

function emptyState(): ControllerTargetState {
  return {
    active: false,
    hasDirect: false,
    hasModulation: false,
    hasAction: false,
    hasMidi: false,
    hasGamepad: false,
    bindingCount: 0,
    shortLabel: null,
  };
}
