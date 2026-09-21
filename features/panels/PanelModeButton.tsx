'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { IconButton, MoveIcon, PanelDockIcon, PanelFloatIcon } from '@/components/ui';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import {
  FLOAT_BUTTON_OFFSET,
  KEY_STEP,
  KEY_STEP_LARGE,
  detachGeometry,
  nudgeGeometry,
  type PanelId,
} from '@/lib/panels/layout';
import { readViewport } from './viewport';
import { useFloatCapable } from './useFloatCapable';

/**
 * The float / dock toggle for a sidecar panel's header — plus, while
 * floating, a Move button that works both ways: drag it like the header, or
 * focus it and use the arrow keys (Shift for bigger steps).
 *
 * Renders nothing when floating isn't available (mobile, coarse pointer,
 * kill switch), so the header is byte-for-byte what it was before Phase 4.98.
 *
 * The toggle is the same element in both states — only its label and icon
 * change — so keyboard focus survives floating and docking.
 */
export function PanelModeButton({ id }: { id: PanelId }) {
  const capable = useFloatCapable();
  const mode = usePanelLayoutStore((st) => st.modes[id]);
  if (!capable) return null;

  const floating = mode === 'float';

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const { float, dock } = usePanelLayoutStore.getState();
    if (floating) {
      dock(id);
      return;
    }
    // Read its on-screen rect from its slot. It detaches anchored by its right
    // edge and shifted left, away from the tile — see detachGeometry.
    const slot = e.currentTarget.closest('[data-panel-id]');
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    float(id, detachGeometry(rect, readViewport(), { offset: FLOAT_BUTTON_OFFSET }));
  };

  const onMoveKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case 'ArrowLeft': dx = -step; break;
      case 'ArrowRight': dx = step; break;
      case 'ArrowUp': dy = -step; break;
      case 'ArrowDown': dy = step; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { geometry, setGeometry } = usePanelLayoutStore.getState();
    const current = geometry[id];
    if (!current) return;
    setGeometry(id, nudgeGeometry(current, dx, dy, readViewport()));
  };

  return (
    <>
      {floating && (
        <IconButton
          label="Move panel (drag, or arrow keys)"
          icon={<MoveIcon />}
          data-panel-drag=""
          onKeyDown={onMoveKey}
        />
      )}
      <IconButton
        label={floating ? 'Dock panel' : 'Float panel — or drag the header'}
        icon={floating ? <PanelDockIcon /> : <PanelFloatIcon />}
        onClick={toggle}
      />
    </>
  );
}
