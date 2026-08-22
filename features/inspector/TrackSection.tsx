'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Button,
  CloseIcon,
  Field,
  IconButton,
  PauseIcon,
  PlayIcon,
  Slider,
  Toggle,
  UploadIcon,
  VolumeIcon,
} from '@/components/ui';
import {
  MAX_TRACK_BYTES,
  getTrackCurrentTime,
  loadTrack,
  pauseTrack,
  playTrack,
  seekTrack,
  setTrackLoop,
  setTrackMutedPlayback,
  setTrackVolume,
  unloadTrack,
} from '@/lib/sound/track';
import { useTrackMeta } from '@/lib/hooks/useTrackState';
import type { ControlSchema } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

interface TrackSectionProps {
  itemId: string;
  schema: ControlSchema;
}

const ACCEPT = 'audio/*';

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Upload-your-own-audio, live inside the Sound panel — Phase 4.9.
 *
 * Shown whenever the open asset has at least one modulatable control,
 * independent of whether it also has a synth preset (see SoundPanel's
 * `hasModulatableControls` gate) — a tile with nothing else to do with
 * audio can still be driven entirely by an uploaded track.
 *
 * Session-only: nothing here is uploaded anywhere. The track lives in
 * memory for lib/sound/track.ts's lifetime, tied to this card, and is
 * gone on reload — see that file's doc for why that's a deliberate v1
 * scope decision rather than a missing persistence step.
 */
export function TrackSection({ itemId, schema }: TrackSectionProps) {
  const meta = useTrackMeta(itemId);
  const mod = useInspectorStore((st) => st.mod);
  const setModulation = useInspectorStore((st) => st.setModulation);
  const sound = useInspectorStore((st) => st.sound);
  const setSoundState = useInspectorStore((st) => st.setSoundState);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);

  // Re-arm the "swap for audio" nudge whenever the track is removed, so a
  // second upload on the same tile offers it again rather than staying
  // dismissed for the card's whole session.
  useEffect(() => {
    if (!meta) setNudgeDismissed(false);
  }, [meta]);

  // Scrub position updates every frame while a track exists, playing or
  // not — a seek-while-paused needs to move the displayed position too,
  // and reading getTrackCurrentTime() directly (rather than trying to
  // thread it through the discrete-event store) is the same convention
  // SoundMeter.tsx already uses for the synth engine's level dots.
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setDisplayTime(getTrackCurrentTime(itemId));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [itemId, meta]);

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again later
    if (!file) return;
    setError(null);
    setLoading(true);
    const result = await loadTrack(itemId, file, sound.enabled);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Track and the synth preset are mutually exclusive as of Phase
    // 4.9.1 — a loaded track takes over the tile's one audio output and
    // the one Volume control (see SoundPanel.tsx's trackLoaded gate).
    // Force-stopping here, not just hiding the preset controls, is the
    // part that actually matters: an earlier version only greyed the UI
    // out, which left the synth engine audibly running underneath a
    // panel that no longer showed any way to control it. loadTrack()
    // already captured the pre-upload value (sound.enabled, above) so
    // "Remove track" below can hand it back exactly as it was.
    if (sound.enabled) setSoundState({ ...sound, enabled: false });
  };

  // The one control this section can't render disabled: any real-audio
  // decode has to originate from the file input's own onChange, so the
  // gesture chain (tap -> pick -> decode -> unlockAudio) never breaks —
  // see loadTrack()'s doc in lib/sound/track.ts for why that matters on
  // iOS specifically.
  const pickFile = () => inputRef.current?.click();

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className={s.visuallyHidden}
      onChange={(e) => void onFileChange(e)}
    />
  );

  if (!meta) {
    return (
      <div className={s.trackEmpty}>
        {hiddenInput}
        <Button variant="outline" block onClick={pickFile} disabled={loading}>
          <UploadIcon />
          {loading ? 'Decoding\u2026' : 'Upload Audio'}
        </Button>
        <span className={s.trackHint}>
          MP3, WAV, or similar — up to {Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB. Kept for this
          session only; not saved.
        </span>
        {error && <span className={s.trackError}>{error}</span>}
      </div>
    );
  }

  // At most one suggestion, and only a genuinely idle-LFO control —
  // see the "sharpen the concept" note this shipped from: offering a
  // one-click swap the moment a track lands on a tile that already has
  // an LFO routed somewhere, rather than requiring a trip to Modulate.
  const lfoControl = schema.controls.find(
    (c) =>
      c.modulatable === true &&
      (c.kind === 'slider' || c.kind === 'stepper') &&
      mod[c.id]?.source.startsWith('lfo.'),
  );

  const shownTime = scrubbing ?? displayTime;

  return (
    <div className={s.trackSection}>
      {hiddenInput}

      <div className={s.trackMeta}>
        <span className={s.trackTitle}>{meta.title}</span>
        <span className={s.trackDuration}>
          {formatDuration(shownTime)} / {formatDuration(meta.durationSeconds)}
        </span>
      </div>

      <div className={s.trackTransport}>
        <IconButton
          label={meta.playing ? 'Pause track' : 'Play track'}
          icon={meta.playing ? <PauseIcon /> : <PlayIcon />}
          variant="outline"
          onClick={() => (meta.playing ? pauseTrack(itemId) : playTrack(itemId))}
        />
        <Slider
          label="Track position"
          value={shownTime}
          min={0}
          max={Math.max(meta.durationSeconds, 0.01)}
          step={0.01}
          onChange={(v) => setScrubbing(v)}
          onCommit={(v) => {
            seekTrack(itemId, v);
            setScrubbing(null);
          }}
        />
      </div>

      {lfoControl && !nudgeDismissed && (
        <div className={s.trackNudge}>
          <span>Swap {lfoControl.label}’s LFO for this track’s bass?</span>
          <div className={s.trackNudgeActions}>
            <Button
              variant="accent"
              onClick={() => {
                const current = mod[lfoControl.id];
                if (current) setModulation(lfoControl.id, { ...current, source: 'audio.bass' });
                setNudgeDismissed(true);
              }}
            >
              Swap
            </Button>
            <IconButton label="Dismiss suggestion" icon={<CloseIcon />} onClick={() => setNudgeDismissed(true)} />
          </div>
        </div>
      )}

      <div className={s.soundToggleRow}>
        <Field label="Loop">
          <Toggle label="Loop track" checked={meta.loop} onChange={(loop) => setTrackLoop(itemId, loop)} />
        </Field>

        <Field label="Mute">
          <span title="Keeps driving Modulate silently, without audible playback.">
            <Toggle
              label="Mute track playback"
              checked={meta.mutedPlayback}
              onChange={(muted) => setTrackMutedPlayback(itemId, muted)}
            />
          </span>
        </Field>
      </div>

      <Field label="Volume" valueNode={<VolumeIcon muted={meta.mutedPlayback} />}>
        <Slider
          label="Track volume"
          value={meta.volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => setTrackVolume(itemId, v)}
        />
      </Field>

      <div className={s.trackButtonRow}>
        <Button
          variant="outline"
          className={s.trackHalfButton}
          onClick={pickFile}
          disabled={loading}
        >
          {loading ? 'Decoding\u2026' : 'Replace'}
        </Button>
        <Button
          variant="danger"
          className={s.trackHalfButton}
          onClick={() => {
            // See onFileChange's doc above — unloadTrack() hands back
            // whatever sound.enabled was the moment this track was
            // loaded, so removing it restores the synth preset exactly
            // as the person had it, rather than leaving Sound stuck off
            // or guessing at re-enabling it unconditionally.
            const wasEnabled = unloadTrack(itemId);
            if (wasEnabled) setSoundState({ ...sound, enabled: true });
          }}
        >
          Remove
        </Button>
      </div>
      {error && <span className={s.trackError}>{error}</span>}
    </div>
  );
}
