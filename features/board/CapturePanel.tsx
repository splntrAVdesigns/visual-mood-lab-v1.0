'use client';

import { ChevronDownIcon, ChevronRightIcon, CloseIcon, Field, IconButton, Slider } from '@/components/ui';
import {
  CAPTURE_MAX_DURATION_SEC,
  CAPTURE_MIN_DURATION_SEC,
  type CaptureFormat,
} from '@/lib/capture/types';
import { useState } from 'react';
import s from '../features.module.css';

interface CapturePanelProps {
  format: CaptureFormat;
  durationSec: number;
  onFormatChange: (format: CaptureFormat) => void;
  onDurationChange: (sec: number) => void;
  onClose: () => void;
  /** Same purpose as SoundPanel/VfxPanel/ModulationPanel's embedded prop —
      render inline in the mobile sheet's scroll region rather than as a
      fixed sidecar. */
  embedded?: boolean;
}

const FORMAT_OPTIONS: { value: CaptureFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
];

/**
 * VCapture — export options only. This panel never starts a recording;
 * it sets the format and duration a separate Record button (RecordButton.tsx)
 * reads when pressed. Structurally the fourth sibling of Sound/VFX/
 * Modulate — same sidecar/embedded duality, same `.modPanel` shell — see
 * VfxPanel.tsx for the pattern this follows.
 *
 * Placement note: this renders inside the LEFT sidecarStack alongside
 * Sound/VFX/Modulate, not to the tile's right. The right edge of the
 * focused-view scrim sits directly against the fixed Inspector drawer
 * (z-index 50, outside this overlay) with no reserved space of its own —
 * see FocusedAssetOverlay.tsx's own comment on why its sidecar already
 * moved from right to left for exactly this reason. Reusing that same
 * slot (rather than fighting a wall this codebase already hit once) is
 * what keeps this "canvas never shifts" — .sidecarSpacer's existing
 * width-matching mechanism covers this panel for free.
 */
export function CapturePanel({
  format,
  durationSec,
  onFormatChange,
  onDurationChange,
  onClose,
  embedded = false,
}: CapturePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const body = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      <div className={s.modPanelRow}>
        <div className={s.modPanelBody}>
          <Field label="Format">
            <div
              className={s.rateStrip}
              role="group"
              aria-label="Export format"
              style={{ gridTemplateColumns: `repeat(${FORMAT_OPTIONS.length}, 1fr)` }}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={s.rateStripKey}
                  aria-pressed={format === opt.value}
                  aria-label={opt.label}
                  data-selected={format === opt.value ? 'true' : undefined}
                  onClick={() => onFormatChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <p className={s.notice}>
            MP4 plays everywhere, including straight out of your phone&rsquo;s photo library. WebM is
            a smaller file if you&rsquo;re staying on desktop.
          </p>

          <Field label="Duration" value={`${durationSec}s`}>
            <Slider
              label="Duration"
              value={durationSec}
              min={CAPTURE_MIN_DURATION_SEC}
              max={CAPTURE_MAX_DURATION_SEC}
              step={1}
              onChange={onDurationChange}
            />
          </Field>
          <p className={s.notice}>
            Recording starts and stops with the Record button — this only sets what it will use.
            Clips loop cleanly when left to finish on their own.
          </p>

          <p className={s.notice}>
            Need sound?
            <br />
            Use your device&rsquo;s screen capture feature.
          </p>
        </div>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <aside
      className={s.modPanel}
      data-collapsed={collapsed ? 'true' : undefined}
      onClick={(e) => e.stopPropagation()}
      aria-label="Video export"
    >
      <header className={s.codeHeader}>
        <IconButton
          label={collapsed ? 'Expand video export' : 'Collapse video export'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className={s.codeTitle}>VCapture</span>
        <span className={s.codeMeta}>{format.toUpperCase()} · {durationSec}s</span>
        <IconButton label="Close video export" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {body}
    </aside>
  );
}
