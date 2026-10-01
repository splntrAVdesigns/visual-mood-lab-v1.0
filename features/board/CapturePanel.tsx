'use client';

import { ChevronDownIcon, ChevronRightIcon, CloseIcon, Field, IconButton, Slider } from '@/components/ui';
import {
  CAPTURE_MAX_DURATION_SEC,
  CAPTURE_MIN_DURATION_SEC,
  type CaptureFormat, type CaptureLoopMode,
} from '@/lib/capture/types';
import { PanelModeButton } from '@/features/panels/PanelModeButton';
import { usePanelCollapsed } from '@/features/panels/usePanelCollapsed';
import s from '../features.module.css';

interface CapturePanelProps {
  format: CaptureFormat;
  durationSec: number;
  onFormatChange: (format: CaptureFormat) => void;
  onDurationChange: (sec: number) => void;
  onClose: () => void;
  loopMode: CaptureLoopMode;
  overlapMs: number;
  onLoopModeChange: (value: CaptureLoopMode) => void;
  onOverlapChange: (value: number) => void;
  busy: boolean;
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
  loopMode, overlapMs, onLoopModeChange, onOverlapChange, busy,
  embedded = false,
}: CapturePanelProps) {
  const [collapsed, toggleCollapsed] = usePanelCollapsed('capture');

  const body = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      <div className={s.modPanelRow}>
        <fieldset disabled={busy} className={s.modPanelBody} style={{ border: 0, margin: 0, minWidth: 0 }}>
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
            MP4 is recommended for sharing. WebM is available when supported by your browser.
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
          <Field label="Loop export">
            <div className={s.rateStrip} role="group" aria-label="Loop export" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {(['off', 'smooth'] as const).map((mode) => (
                <button key={mode} type="button" className={s.rateStripKey}
                  style={{ minHeight: 44 }} aria-pressed={loopMode === mode}
                  data-selected={loopMode === mode ? 'true' : undefined}
                  onClick={() => onLoopModeChange(mode)}>{mode === 'off' ? 'Off' : 'Smooth'}</button>
              ))}
            </div>
          </Field>
          {loopMode === 'smooth' && <Field label="Transition" value={`${(overlapMs / 1000).toFixed(1)}s`}>
            <Slider label="Loop transition duration" value={overlapMs} min={100} max={800} step={100} onChange={onOverlapChange} />
          </Field>}
          <p className={s.notice}>
            {loopMode === 'smooth'
              ? `Records ${(durationSec + Math.round(overlapMs * 30 / 1000) / 30).toFixed(1)}s for a ${durationSec}s clip, then processes a blended join. The untreated source is kept. Some motion may still show a transition.`
              : 'Records untreated frames. Loop playback can be toggled separately on the saved video.'}
          </p>
          <p className={s.notice}>{busy ? 'Capture settings are locked while recording and saving.' : 'Use Record to start. Stopping early saves untreated footage.'}</p>

          <p className={s.notice}>
            Need sound?
            <br />
            Use your device&rsquo;s screen capture feature.
          </p>
        </fieldset>
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
      <header className={s.codeHeader} data-panel-handle="">
        <IconButton
          label={collapsed ? 'Expand video export' : 'Collapse video export'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={(e) => toggleCollapsed({ additive: e.shiftKey })}
        />
        <span className={s.codeTitle}>VCapture</span>
        <span className={s.codeMeta}>{format.toUpperCase()} · {durationSec}s</span>
        <PanelModeButton id="capture" />
        <IconButton label="Close video export" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {body}
    </aside>
  );
}
