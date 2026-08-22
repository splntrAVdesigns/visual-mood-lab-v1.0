'use client';

import { useState } from 'react';
import { Button, ChevronDownIcon, ChevronRightIcon, CloseIcon, Field, IconButton, Select, Slider, Toggle } from '@/components/ui';
import { getPool } from '@/lib/render/pool';
import { unlockAudio } from '@/lib/sound/context';
import { getCompatiblePresets } from '@/lib/sound/presets';
import { WAVE_SHAPE_CONTROL_ID, lfoShapeToWaveShapeValue } from '@/lib/sound/types';
import { SoundMeter } from './SoundMeter';
import { TrackSection } from './TrackSection';
import { NoteRack } from './controls/NoteRack';
import { useTrackLoaded } from '@/lib/hooks/useTrackState';
import type { ControlSchema, LfoShape, MusicalScale, SoundState } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

interface SoundPanelProps {
  schema: ControlSchema;
  itemId: string;
  onClose: () => void;
  /** Same purpose as ModulationPanel's embedded prop — render inline in an
      existing scroll region (mobile's Sounds tab) rather than as a fixed
      sidecar. */
  embedded?: boolean;
}

const SCALE_OPTIONS: Array<{ value: MusicalScale; label: string }> = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'pentatonic', label: 'Pentatonic' },
  { value: 'chromatic', label: 'Chromatic' },
];

const LFO_SHAPE_OPTIONS: Array<{ value: LfoShape; label: string }> = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'sawtooth', label: 'Sawtooth' },
];

/**
 * Every control a tile's sound preset exposes, in one place — Sound
 * on/off, which preset, key, scale, octave, volume, and a retrigger
 * action. Structurally the twin of ModulationPanel: same embedded/sidecar
 * duality, same CSS classes, for the same reason ModulationPanel gives —
 * this is asset-level configuration, not a per-control popover, so one
 * panel covering the whole tile is the right shape either way.
 */
export function SoundPanel({ schema, itemId, onClose, embedded = false }: SoundPanelProps) {
  const sound = useInspectorStore((st) => st.sound);
  const setSoundState = useInspectorStore((st) => st.setSoundState);
  const setParam = useInspectorStore((st) => st.setParam);
  const [collapsed, setCollapsed] = useState(false);

  const presets = getCompatiblePresets(schema);
  // Same filter FocusedAssetOverlay/MobileFocusedView use to compute
  // canModulate — Track upload doesn't need its own asset-eligibility
  // rule, it needs the SAME one Modulate already uses, since a track's
  // only purpose here is feeding that panel's audio.* sources. Tier 1
  // (has a preset) and Tier 2 (modulatable but no preset) both clear this;
  // an asset with neither gets neither section below.
  const hasModulatableControls = schema.controls.some(
    (c) => c.modulatable === true && (c.kind === 'slider' || c.kind === 'stepper'),
  );
  // Phase 4.9.1: Track and the synth preset are mutually exclusive — see
  // TrackSection.tsx's onFileChange, which force-disables sound.enabled
  // the moment a track loads. This flag is what makes the preset section
  // below collapse to a single disabled toggle row + notice instead of
  // rendering the full preset UI (dropdown, notes grid, scale, wave,
  // octave, its own volume slider, retrigger) alongside Track's own —
  // that full-height stacking was the actual "panel too tall" problem,
  // not spacing, so this collapses it rather than just tightening gaps.
  const trackLoaded = useTrackLoaded(itemId);
  const activePresetId = sound.presetId ?? presets[0]?.id ?? null;
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];
  const hasLfo = activePreset?.bindings.some((b) => b.target === 'lfoRate' || b.target === 'lfoDepth') ?? false;
  // Wave/Waveform Shape sync — see lib/sound/types.ts's
  // WAVE_SHAPE_CONTROL_ID doc. Only meaningful when the asset actually
  // has a control by that name (Static Choir does; most tiles don't).
  const hasWaveShapeControl = schema.controls.some((c) => c.id === WAVE_SHAPE_CONTROL_ID && c.kind === 'select');
  // What selecting more than one note MEANS genuinely differs by engine,
  // so the hint is engine-specific rather than one vague line covering
  // both. Sample-backed pads get their own, since they're the one case
  // where extra notes don't stack at all.
  const notesHint = activePreset?.sampleUrl
    ? `This preset is a recorded loop (root ${activePreset.sampleRootNote ?? '?'}) and plays the first selected note only. Small shifts from the root are pitch changes; larger ones will also noticeably speed the loop up or down.`
    : activePreset?.engine === 'pad'
      ? 'Selected notes sound together as a chord.'
      : activePreset?.engine === 'arp'
        ? 'Plucks draw from every selected note\u2019s scale \u2014 more notes, wider range.'
        : undefined;

  const update = (patch: Partial<SoundState>) => setSoundState({ ...sound, ...patch });

  // Both used to be disabled for whichever engine/trigger-model combo
  // couldn't act on them literally — but every current preset fell into
  // that bucket for Swing (all five Field Lines presets are event-mode,
  // all five Acid Melt presets are pad engine), which meant the toggle
  // could never be turned on by anything in the app. A control nothing
  // can ever activate reads as broken regardless of how correct the
  // reasoning behind disabling it was. Both now have a real, always-on
  // implementation for every engine instead — see ArpEngine.pluck()'s
  // accent-based swing and PadEngine's detune-drift humanize / tremolo-
  // pulse swing — so neither needs to be disabled at all anymore.
  const isArp = activePreset?.engine === 'arp';
  const isAbstract = activePreset?.engine === 'abstract';
  const isEventMode = activePreset?.triggerMode === 'event';
  const humanizeHint = isArp
    ? 'Adds subtle timing, pitch, and velocity variation so notes don\u2019t feel machine-quantized.'
    : isAbstract
      ? 'Slow, subtle drift on the filter so the texture doesn\u2019t sit perfectly static.'
      : 'Slow, subtle pitch drift so the tone doesn\u2019t sit perfectly static.';
  const swingHint = isArp
    ? isEventMode
      ? 'Every other pluck lands a touch softer, for a swung feel driven by your own rhythm.'
      : 'Delays every other note slightly for a swung rhythmic feel.'
    : 'Every other breath of the tremolo pulses a little deeper, for a lopsided feel.';

  const presetSection = trackLoaded ? (
    presets.length > 0 ? (
      <>
        {/* Sound/Humanize/Swing render disabled rather than being hidden —
            same reasoning as the Wave field elsewhere in this file: showing
            that these exist (just inactive) is more honest than making them
            disappear, which would read as "this asset lost its sound
            preset" rather than "a track is temporarily standing in for it".
            Meter is the one exception: it's a readout, not a control, and
            Phase 4.9.1 wired it to show the track's own level while a track
            is loaded (see SoundMeter.tsx) — greying it out would hide the
            one piece of information that's actually live right now. */}
        <div className={s.soundToggleRow}>
          <Field label="Sound">
            <Toggle label="Sound" checked={sound.enabled} disabled onChange={() => {}} />
          </Field>

          <Field label="Humanize">
            <Toggle label="Humanize" checked={sound.humanize} disabled onChange={() => {}} />
          </Field>

          <Field label="Swing">
            <Toggle label="Swing" checked={sound.swing} disabled onChange={() => {}} />
          </Field>

          <Field label="Meter">
            <SoundMeter itemId={itemId} />
          </Field>
        </div>
        <p className={s.notice}>Presets disabled while a track is loaded — remove it above to use the built-in sound again.</p>
      </>
    ) : (
      // Tier 2 (no compatible preset at all — hasModulatableControls is
      // what got this asset into the panel in the first place, per the
      // presets.length === 0 branch below). Nothing to disable and no
      // "built-in sound" to point back to, so just the live Meter, on
      // its own rather than inside the four-across toggle row shape that
      // implies siblings that don't exist here.
      <div className={s.soundToggleRow}>
        <Field label="Meter">
          <SoundMeter itemId={itemId} />
        </Field>
      </div>
    )
  ) : presets.length === 0 ? (
    // Only the fully-empty case (no preset AND nothing modulatable, i.e.
    // TrackSection didn't render either) gets this notice — a Tier 2
    // asset with modulatable controls but no preset has Track to offer
    // instead, and showing this text above it would read as a
    // contradiction of what's sitting right there.
    !hasModulatableControls && <p className={s.notice}>No sound preset is available for this asset yet.</p>
  ) : (
    <>
      <div className={s.soundToggleRow}>
        <Field label="Sound">
          <Toggle
            label="Sound"
            checked={sound.enabled}
            onChange={(enabled) => {
              if (enabled) void unlockAudio().catch(() => {});
              update({ enabled, presetId: activePresetId });
            }}
          />
        </Field>

        <Field label="Humanize">
          <span title={humanizeHint}>
            <Toggle
              label="Humanize"
              checked={sound.humanize}
              onChange={(humanize) => update({ humanize })}
            />
          </span>
        </Field>

        <Field label="Swing">
          <span title={swingHint}>
            <Toggle
              label="Swing"
              checked={sound.swing}
              onChange={(swing) => update({ swing })}
            />
          </span>
        </Field>

        <Field label="Meter">
          <SoundMeter itemId={itemId} />
        </Field>
      </div>

      <Field label="Preset">
        <Select
          label="Sound preset"
          value={activePresetId ?? ''}
          options={presets.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(v) => {
            const next = presets.find((p) => p.id === v);
            const nextLfoShape = next?.defaultLfoShape ?? sound.lfoShape;
            // Also apply the preset's own declared scale/octave/notes,
            // not just its LFO shape. This was the actual cause of
            // "every Field Lines preset sounds the same": each one
            // declares a genuinely different scale AND octave, but
            // switching presets never applied either — every preset
            // played in whatever scale/octave was last picked by hand
            // instead of its own intended starting point. Every
            // control below still lets the user override any of this
            // afterward, same as lfoShape already does.
            update({
              presetId: v,
              scale: next?.scale ?? sound.scale,
              octave: next?.defaultOctave ?? sound.octave,
              notes: next?.defaultNotes ?? sound.notes,
              lfoShape: nextLfoShape,
              // A preset can open with Humanize/Swing already part of
              // its character (several of Chorus of Eyes' presets do,
              // deliberately, for its oddball brief) rather than
              // requiring the user to discover and enable them
              // separately. Undefined means "no opinion" — falls back
              // to whatever's already set, same as everything above.
              humanize: next?.defaultHumanize ?? sound.humanize,
              swing: next?.defaultSwing ?? sound.swing,
            });
            // A preset switch that changes lfoShape (Choir Hollow's
            // defaultLfoShape, say) should carry the Waveform Shape
            // control along with it too — same sync as the Wave
            // dropdown's own onChange, just triggered by preset
            // selection instead of a direct edit.
            if (hasWaveShapeControl && nextLfoShape !== sound.lfoShape) {
              setParam(WAVE_SHAPE_CONTROL_ID, lfoShapeToWaveShapeValue(nextLfoShape));
            }
          }}
        />
      </Field>

      {/* Abstract engine (Wound Thread) has no pitch concept at all —
          nothing in AbstractEngine ever reads notes or scale, so
          showing controls that visibly do nothing would just be
          confusing. Hidden rather than disabled/greyed: unlike the
          Static Choir inert-slider case, there's no "might matter
          later" state here — an abstract preset never uses these. */}
      {!isAbstract && (
        <>
          <Field label="Notes" hint={notesHint}>
            <NoteRack value={sound.notes} onChange={(notes) => update({ notes })} />
          </Field>

          <Field label="Scale">
            <Select
              label="Scale"
              value={sound.scale}
              options={SCALE_OPTIONS}
              onChange={(v) => update({ scale: v as MusicalScale })}
            />
          </Field>
        </>
      )}

      {hasLfo && (
        <Field label="Wave" hint="Shape of the sound's own pulse — try a few against the default sine.">
          <Select
            label="LFO wave shape"
            value={sound.lfoShape}
            options={LFO_SHAPE_OPTIONS}
            onChange={(v) => {
              const lfoShape = v as LfoShape;
              update({ lfoShape });
              // Push the other direction too, while this tile has a
              // matching visual control — see the sync doc above.
              // Unconditional (not gated on sound.enabled): the two
              // controls should always mirror each other, not just
              // once Sound happens to already be on, mirroring
              // InspectorDrawer's identical reasoning for the reverse
              // direction.
              if (hasWaveShapeControl) {
                setParam(WAVE_SHAPE_CONTROL_ID, lfoShapeToWaveShapeValue(lfoShape));
              }
            }}
          />
        </Field>
      )}

      {!isAbstract && (
        <Field label="Octave" value={String(sound.octave)}>
          <Slider
            label="Octave"
            value={sound.octave}
            min={-2}
            max={2}
            step={1}
            onChange={(v) => update({ octave: Math.round(v) })}
          />
        </Field>
      )}

      <Field label="Volume">
        <Slider
          label="Volume"
          value={sound.volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => update({ volume: v })}
        />
      </Field>

      <div className={s.modPanelRowFoot}>
        <Button
          variant="outline"
          block
          disabled={!sound.enabled || sound.notes.length === 0}
          onClick={() => getPool().retriggerSound(itemId)}
        >
          Retrigger
        </Button>
      </div>
    </>
  );

  const body = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      {hasModulatableControls && (
        <TrackSection itemId={itemId} schema={schema} />
      )}
      {presetSection}
    </div>
  );

  if (embedded) return body;

  return (
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(e) => e.stopPropagation()} aria-label="Sound">
      <header className={s.codeHeader}>
        <IconButton
          label={collapsed ? 'Expand sound' : 'Collapse sound'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className={s.codeTitle}>Sound</span>
        <IconButton label="Close sound" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {body}
    </aside>
  );
}
