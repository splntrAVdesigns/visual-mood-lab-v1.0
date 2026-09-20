'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  CloseIcon,
  CodeIcon,
  DownloadIcon,
  FullscreenIcon,
  IconButton,
  Tooltip,
  VCaptureIcon,
} from '@/components/ui';
import { selectSelectedAsset, useBoardStore, useInspectorStore, usePlaybackStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { RendererStage } from './RendererStage';
import { CodePanel } from './CodePanel';
import { CapturePanel } from './CapturePanel';
import { RecordButton } from './RecordButton';
import { HeaderOverflowMenu, type OverflowMenuItem } from './HeaderOverflowMenu';
import { ModulationPanel } from '../inspector/ModulationPanel';
import { SoundPanel } from '../inspector/SoundPanel';
import { VfxPanel } from '../inspector/VfxPanel';
import { getCompatiblePresets } from '@/lib/sound/presets';
import { closeAsset, openAssetById } from './openAsset';
import {
  createSnapshot,
  deleteSnapshot,
  downloadBlob,
  downloadSnapshotImage,
  storeSnapshotCapture,
} from '@/lib/persist/client';
import { getPool } from '@/lib/render/pool';
import { isVisible } from '@/renderers/control-schema';
import { CAPTURE_DEFAULT_DURATION_SEC, type CaptureFormat } from '@/lib/capture/types';
import s from '../features.module.css';

/**
 * The enlarge-on-click view: a centered panel over a dimmed board, showing
 * the selected asset at full quality alongside the inspector.
 *
 * Visibility is derived from the same `open` flag the inspector drawer uses
 * — clicking a card, pressing Escape, or closing the drawer all affect both
 * at once, so they can never fall out of sync with each other.
 */
export function FocusedAssetOverlay() {
  const open = useInspectorStore((st) => st.open);
  const params = useInspectorStore((st) => st.params);
  const schema = useInspectorStore((st) => st.schema);
  const asset = useBoardStore(selectSelectedAsset);
  const panelRef = useRef<HTMLDivElement>(null);

  const [showCode, setShowCode] = useState(false);
  const [showMod, setShowMod] = useState(false);
  const [showSound, setShowSound] = useState(false);
  const [showVfx, setShowVfx] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  // Lifted here rather than into CapturePanel itself: RecordButton needs
  // to read whatever was last chosen the moment it's pressed, even if the
  // VCapture panel isn't open at that exact moment (set once, close the
  // panel, record later). Persists per asset only for the current
  // session — not saved server-side, unlike params/mod/sound/effects,
  // since a format/duration choice isn't part of the tile's look.
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('mp4');
  const [captureDuration, setCaptureDuration] = useState(CAPTURE_DEFAULT_DURATION_SEC);
  const [saving, setSaving] = useState(false);
  const [downloadingSnapshot, setDownloadingSnapshot] = useState(false);
  const [downloadingUpload, setDownloadingUpload] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setShowCode(false);
    setShowMod(false);
    setShowSound(false);
    setShowVfx(false);
    setShowCapture(false);
    setSavedNote(null);
    // Carries over otherwise: this component instance persists across
    // different assets (it isn't remounted per-open), so a previous
    // asset's fullscreen state — including a stuck `true` left behind by
    // a failed transition — would otherwise leak into the next asset,
    // hiding its header actions until fullscreen was toggled once to
    // force a resync via the fullscreenchange listener below.
    setIsFullscreen(false);
  }, [asset?.itemId]);

  useEffect(() => {
    if (!savedNote) return;
    const t = setTimeout(() => setSavedNote(null), 2600);
    return () => clearTimeout(t);
  }, [savedNote]);

  // Whenever this view stops being open — for any reason: the X here, the
  // inspector's own X, Escape, clicking the scrim — reclaim the renderer for
  // the grid thumbnail it was borrowed from. Tying this to a cleanup rather
  // than to a specific button's onClick means every closing path is covered
  // by construction, not by remembering to call it in four different places.
  useEffect(() => {
    if (!open) return;
    usePlaybackStore.getState().setBoardFrozen(true);
    return () => {
      usePlaybackStore.getState().setBoardFrozen(false);
      usePlaybackStore.getState().bumpEpoch();
    };
  }, [open]);

  // 'F' toggles fullscreen on the panel itself while an asset is open.
  /**
   * Requesting fullscreen while a sidecar panel is open means two layout
   * shifts land in the same tick: the panel closing (focusPanel springing
   * back to full width) and the browser's own fullscreen reflow. Closing
   * the sidecar first and waiting a frame lets the first settle before the
   * second starts, which reads as one clean transition instead of a
   * compounded jolt. It doesn't eliminate the native fullscreen reflow
   * itself — that's the browser's, not CSS-controllable — but it removes
   * the part that was actually ours to fix.
   */
  const enterFullscreen = () => {
    setShowCode(false);
    setShowMod(false);
    setShowSound(false);
    setShowVfx(false);
    setShowCapture(false);
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      el.requestFullscreen()
        .then(() => {
          // A rejected/settled promise is the normal signal, but the
          // observed failure mode here is worse: fullscreen genuinely
          // engages at the browser level (this resolves) while the WEBGL
          // canvas inside dies from the transition's resize storm. That
          // leaves nothing wrong for fullscreenchange to report — the
          // browser IS fullscreen — so isFullscreen syncing only off that
          // event is correct here; nothing extra to do on success beyond
          // making sure keyboard input still reaches this panel and not a
          // sandboxed iframe that may have stolen focus by interaction.
          el.focus({ preventScroll: true });
        })
        .catch(() => {
          // The request was rejected outright (blocked, interrupted by a
          // second call, etc.) — nothing engaged, so don't leave the UI
          // believing otherwise. Without this, a failed request left
          // isFullscreen stuck true with no matching fullscreenchange ever
          // coming to correct it, hiding every header action permanently.
          setIsFullscreen(false);
        });
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen();
      else enterFullscreen();
    };
    document.addEventListener('keydown', onKeyDown);

    const onChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      // Code and Modulate are DOM siblings of the fullscreened panel, so the
      // Fullscreen API already hides them visually — true fullscreen only
      // renders the requested element and its descendants, and neither
      // panel lives inside focusPanel. This additionally clears their open
      // state (belt-and-suspenders alongside enterFullscreen already doing
      // it) so exiting fullscreen never leaves them lingering open either.
      if (active) {
        setShowCode(false);
        setShowMod(false);
        setShowSound(false);
        setShowVfx(false);
        setShowCapture(false);
      } else {
        panelRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('fullscreenchange', onChange);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [open]);

  if (!open || !asset) return null;

  const hasSource = Boolean(asset.source);
  // Also gated on isVisible(c, params): a control hidden behind another
  // mode's showIf (e.g. HUD Array's Delta-only speeds while Radial is
  // active) is not something modulation should ever be able to target —
  // routing to it is invisible-by-construction until the mode changes,
  // which is exactly the "Alpha/Delta aren't audio-reactive" bug. Mirrors
  // the identical isVisible filter InspectorDrawer's Controls tab already
  // applies; this list just forgot to apply it too.
  const modulatableControls = (schema?.controls ?? []).filter(
    (c) => c.modulatable === true && (c.kind === 'slider' || c.kind === 'stepper') && isVisible(c, params),
  );
  const canModulate = !asset.isSnapshot && modulatableControls.length > 0;
  // Snapshots stay excluded from Sound for the same reason they're excluded
  // from Modulate: a snapshot is meant to be a settled, permanent look, and
  // ongoing reactive sound is the same kind of "still drifting" behavior as
  // ongoing modulation would be.
  //
  // As of Phase 4.9, Sound is no longer preset-only: an asset with nothing
  // but modulatable controls (canModulate, no compatible preset) still gets
  // the button, because that's exactly the asset an uploaded Track is for —
  // SoundPanel's own hasModulatableControls check decides which section(s)
  // it actually renders once open.
  const canSound = !asset.isSnapshot && (getCompatiblePresets(schema).length > 0 || canModulate);
  // Phase 4.96 — scoped to shader tiles only for now. Snapshots and
  // image/svg/video all render through MediaRenderer today (see
  // lib/render/pool.ts's promote(): `createRenderer(asset.isSnapshot ?
  // 'image' : asset.type, ...)`), which has no output canvas to draw a
  // composited result back onto — the same blocker documented in the
  // Phase 4.96 integration notes for uploads generally, not something
  // special-cased against snapshots specifically. Widen this the moment
  // MediaRenderer grows one; nothing else in the rack needs to change.
  const canVfx = !asset.isSnapshot && asset.type === 'shader';
  // Same gate as canVfx, same reason — see lib/capture/engine.ts's top doc.
  // A shader tile's canvas is a proven capture source; a p5 sketch's
  // sandboxed cross-origin iframe canvas is not a valid capture source at
  // all until the sandbox streams frames out over postMessage (separate,
  // not-yet-built work). Widen this the moment that lands; nothing else
  // here needs to change.
  const canCapture = !asset.isSnapshot && asset.type === 'shader';

  const closeOverlay = () => {
    // Exiting fullscreen from the X takes two steps if left to the browser
    // — leave fullscreen, THEN close, or the tab is stuck in a fullscreen
    // context showing nothing once the panel unmounts.
    if (document.fullscreenElement) void document.exitFullscreen();
    closeAsset();
  };

  /**
   * Save the current parameters as a new snapshot card AND bounce a PNG of
   * the current frame. Does not navigate — saving is a side effect of what
   * you're doing, not a reason to stop doing it.
   */
  const saveSnapshot = async () => {
    if (saving) return;
    setSaving(true);
    setSavedNote(null);

    const created = await createSnapshot(asset.id, params);
    if (!created) {
      setSaving(false);
      setSavedNote('Save failed');
      return;
    }

    const renderer = getPool().get(asset.itemId);
    let card = created;

    if (renderer) {
      const { posterUrl, blob } = await storeSnapshotCapture(created.itemId, renderer);
      if (posterUrl) card = { ...created, posterUrl };
      if (blob) downloadBlob(blob, `${asset.id}-${created.itemId.slice(0, 8)}.png`);
    }

    useBoardStore.getState().addAsset(card);
    setSaving(false);
    setSavedNote('Saved to Snapshots');
  };

  const removeSnapshot = async () => {
    if (!asset.isSnapshot) return;
    const ok = await deleteSnapshot(asset.itemId);
    if (!ok) return;
    useBoardStore.getState().removeAsset(asset.itemId);
    closeAsset();
  };

  /**
   * Re-download a previously-saved snapshot's image. saveSnapshot() above
   * only ever fires a download at the moment of creation — reopening a
   * snapshot later, with the Save-and-download button gone (see the
   * !asset.isSnapshot guard on it below), left no way to get the file
   * again short of deleting and recreating it. The image was never
   * missing, just unreachable from here — this re-fetches the same
   * posterUrl storeSnapshotCapture already persisted.
   */
  const downloadSnapshot = async () => {
    if (!asset.isSnapshot || downloadingSnapshot) return;
    setDownloadingSnapshot(true);
    setSavedNote(null);
    const ok = await downloadSnapshotImage(asset.posterUrl, `${asset.id}-${asset.itemId.slice(0, 8)}.png`);
    setDownloadingSnapshot(false);
    setSavedNote(ok ? null : 'Download failed');
  };

  // Uploaded media only. The seed library never ships image/svg/video
  // assets — those types only ever exist as user uploads (see the seed
  // authoring conventions: 10 shaders + 10 sketches, media added by hand)
  // — so gating on type here can't accidentally offer to delete shared
  // library content, without needing a separate ownership flag threaded
  // through just for this button.
  const isDeletableUpload =
    !asset.isSnapshot && (asset.type === 'image' || asset.type === 'svg' || asset.type === 'video');

  /**
   * Menu-item mirror of the same actions the inline header buttons
   * already render — see .focusHeaderOverflowGroup / .focusHeaderMoreTrigger
   * in features.module.css for which tier shows which representation.
   * Built from the exact same handlers (saveSnapshot, downloadSnapshot,
   * the setShow* toggles) rather than new ones, so behavior can never
   * drift between the inline and collapsed forms of the same action.
   *
   * RecordButton and both Delete paths are deliberately NOT in this
   * list — RecordButton owns its own live recording-state visual
   * (icon/pulse) that a static text menu item can't represent, and
   * Delete stays inline-always per product decision (irreplaceable
   * content shouldn't hide behind a menu) — both are rendered outside
   * .focusHeaderOverflowGroup in the JSX below instead.
   */
  const overflowItems: OverflowMenuItem[] = [];
  if (canSound) {
    overflowItems.push({
      id: 'sound',
      label: showSound ? 'Hide Sound' : 'Sound',
      onClick: () => {
        setShowSound((v) => !v);
        setShowCode(false);
      },
    });
  }
  if (canCapture) {
    overflowItems.push({
      id: 'vcapture',
      label: showCapture ? 'Hide VCapture' : 'VCapture',
      onClick: () => {
        setShowCapture((v) => !v);
        setShowCode(false);
      },
    });
  }
  if (!asset.isSnapshot) {
    overflowItems.push({
      id: 'save-snapshot',
      label: saving ? 'Saving…' : 'Save snapshot',
      onClick: () => void saveSnapshot(),
      disabled: saving,
    });
  }
  if (asset.isSnapshot) {
    overflowItems.push({
      id: 'download-snapshot',
      label: downloadingSnapshot ? 'Downloading…' : 'Download',
      onClick: () => void downloadSnapshot(),
      disabled: downloadingSnapshot,
    });
  }

  /**
   * Downloads the raw uploaded/captured file itself — distinct from
   * downloadSnapshot above, which re-fetches a snapshot's rendered PNG
   * poster. Gated on the same isDeletableUpload check that already scopes
   * Delete to image/svg/video, non-snapshot assets: the seed library never
   * ships these types (see isDeletableUpload's own doc), so there's no
   * risk of this offering to download shared library source instead of
   * something the person actually owns.
   */
  const downloadUpload = async () => {
    if (!isDeletableUpload || !asset.srcUrl || downloadingUpload) return;
    setDownloadingUpload(true);
    setSavedNote(null);
    try {
      const res = await fetch(asset.srcUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = asset.srcUrl.split('.').pop()?.split(/[?#]/)[0] || 'bin';
      const safeName = asset.title.replace(/[<>:"/\\|?*]/g, '_');
      downloadBlob(blob, `${safeName}.${ext}`);
    } catch {
      setSavedNote('Download failed');
    } finally {
      setDownloadingUpload(false);
    }
  };

  const removeUpload = async () => {
    if (!isDeletableUpload) return;
    if (!window.confirm(`Delete "${asset.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setSavedNote('Delete failed');
      return;
    }
    useBoardStore.getState().removeAsset(asset.itemId);
    closeAsset();
  };

  return (
    <div
      className={s.focusScrim}
      data-code={showCode ? 'true' : undefined}
      data-mod={showMod ? 'true' : undefined}
      data-sound={showSound ? 'true' : undefined}
      data-vfx={showVfx ? 'true' : undefined}
      data-capture={showCapture ? 'true' : undefined}
      onClick={closeOverlay}
    >
      {/* Real sidecar now renders BEFORE focusPanel in DOM — it appears to
          the tile's LEFT. Moved from the right (where it used to render
          after focusPanel) because the right edge of the scrim sits right
          up against the fixed Inspector drawer outside this overlay
          entirely (z-index 50, see .focusScrim's doc) — there was no
          room left for the sidecar there, which is what cut off Mute and
          the track duration readout. The left side has nothing else
          docked against it, so it's genuinely open space. No flex `order`
          needed: DOM order directly matches visual order in this simple
          a flex row (see .focusScrim), so this swap alone moves it. */}
      {((showMod && canModulate) || (showSound && canSound && schema) || (showVfx && canVfx) || (showCapture && canCapture)) && (
        <div className={s.sidecarStack}>
          {showSound && canSound && schema && (
            <SoundPanel schema={schema} itemId={asset.itemId} onClose={() => setShowSound(false)} />
          )}
          {showVfx && canVfx && (
            <VfxPanel itemId={asset.itemId} onClose={() => setShowVfx(false)} />
          )}
          {showCapture && canCapture && (
            <CapturePanel
              format={captureFormat}
              durationSec={captureDuration}
              onFormatChange={setCaptureFormat}
              onDurationChange={setCaptureDuration}
              onClose={() => setShowCapture(false)}
            />
          )}
          {showMod && canModulate && (
            <ModulationPanel controls={modulatableControls} itemId={asset.itemId} onClose={() => setShowMod(false)} />
          )}
        </div>
      )}

      <div
        ref={panelRef}
        className={s.focusPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        // Marks THIS as the tile being edited (not a dialog on top of it) so the
        // Roll shortcuts can tell the two apart — see useRollShortcuts.
        data-focused-view="true"
        aria-label={asset.title}
        tabIndex={-1}
      >
        <header className={s.focusHeader}>
          <span className={s.focusTitle}>{asset.title}</span>
          <Badge>{asset.isSnapshot ? 'SNAPSHOT' : ASSET_TYPE_BADGE[asset.type]}</Badge>

          {/*
            Fullscreen strips this down to exactly what was asked for: the
            title and badge above (already outside this block) plus the
            fullscreen toggle and close button below — nothing else. Every
            action button here is hidden rather than the DOM being
            restructured, so exiting fullscreen instantly returns the full
            header with no re-render surprises.
          */}
          {!isFullscreen && (
            <>
              {hasSource && (
                <Button
                  variant="ghost"
                  active={showCode}
                  onClick={() => {
                    setShowCode((v) => !v);
                    setShowMod(false);
                    setShowSound(false);
                    setShowVfx(false);
                    setShowCapture(false);
                  }}
                >
                  <CodeIcon />
                  Code
                </Button>
              )}

              {canVfx && (
                <Button
                  variant="ghost"
                  active={showVfx}
                  onClick={() => {
                    setShowVfx((v) => !v);
                    setShowCode(false);
                  }}
                >
                  VFX
                </Button>
              )}

              {canModulate && (
                <Button
                  variant="ghost"
                  active={showMod}
                  onClick={() => {
                    setShowMod((v) => !v);
                    setShowCode(false);
                  }}
                >
                  Modulate
                </Button>
              )}

              {/*
                Header-button-overflow fix (2026-09): everything in this
                group is `display: contents` (participates directly in
                .focusHeader's flex row, unchanged) above 680px of PANEL
                width, and `display: none` at/below it — see
                .focusHeaderOverflowGroup in features.module.css. The
                same actions are also available via the HeaderOverflowMenu
                below at every width, through overflowItems built above;
                only one representation is ever visually shown at once.
              */}
              <div className={s.focusHeaderOverflowGroup}>
                {canSound && (
                  <Button
                    variant="ghost"
                    active={showSound}
                    onClick={() => {
                      setShowSound((v) => !v);
                      setShowCode(false);
                    }}
                  >
                    Sound
                  </Button>
                )}

                {canCapture && (
                  <Tooltip content="Set export format and duration">
                    <Button
                      variant="ghost"
                      active={showCapture}
                      onClick={() => {
                        setShowCapture((v) => !v);
                        setShowCode(false);
                      }}
                    >
                      <VCaptureIcon />
                      VCapture
                    </Button>
                  </Tooltip>
                )}

                {!asset.isSnapshot && (
                  <Tooltip content="Save these settings as a snapshot and export a PNG">
                    <Button variant="ghost" onClick={saveSnapshot} disabled={saving}>
                      {saving ? 'Saving…' : 'Save snapshot'}
                    </Button>
                  </Tooltip>
                )}

                {asset.isSnapshot && (
                  <Tooltip content="Download this snapshot's image again">
                    <Button variant="ghost" onClick={downloadSnapshot} disabled={downloadingSnapshot}>
                      {downloadingSnapshot ? 'Downloading…' : 'Download'}
                    </Button>
                  </Tooltip>
                )}
              </div>

              {/*
                Kept OUTSIDE the collapse group, always visible: a live
                recording's icon/pulse state is exactly the kind of thing
                that shouldn't disappear into a menu, and the app's own
                live-performance direction (Phase 4.97 planning) makes
                that more true here than for almost any other action in
                this header.
              */}
              {canCapture && (
                <RecordButton
                  asset={asset}
                  canCapture={canCapture}
                  format={captureFormat}
                  durationSec={captureDuration}
                />
              )}

              <HeaderOverflowMenu items={overflowItems} />

              {isDeletableUpload && (
                <Tooltip content="Download this file">
                  <IconButton
                    label={downloadingUpload ? 'Downloading…' : 'Download'}
                    icon={<DownloadIcon />}
                    onClick={() => void downloadUpload()}
                    disabled={downloadingUpload}
                  />
                </Tooltip>
              )}

              {savedNote && <span className={s.savedNote}>{savedNote}</span>}

              {asset.isSnapshot && (
                <Button variant="danger" onClick={removeSnapshot}>
                  Delete
                </Button>
              )}

              {isDeletableUpload && (
                <Button variant="danger" onClick={removeUpload}>
                  Delete
                </Button>
              )}
            </>
          )}

          <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} shortcut="F">
            <IconButton
              label="Toggle fullscreen"
              icon={<FullscreenIcon on={isFullscreen} />}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else enterFullscreen();
              }}
            />
          </Tooltip>

          <IconButton label="Close" icon={<CloseIcon />} onClick={closeOverlay} className={s.focusClose} />
        </header>

        <div className={s.focusStage}>
          <RendererStage asset={asset} focused />
        </div>
      </div>

      {/* Invisible, same width as the real sidecar — keeps focusPanel's
          own centered position mathematically identical whether or not
          the sidecar is showing (a tile flanked by two equal-width
          elements, one real, one not, stays centered either way). This
          is what stops the tile from visibly shifting when Sound/
          Modulate opens. Now on the right, mirroring the real sidecar's
          move to the left — same counterweight technique, opposite side.
          See .sidecarSpacer's CSS doc. */}
      {((showMod && canModulate) || (showSound && canSound && schema) || (showVfx && canVfx) || (showCapture && canCapture)) && (
        <div className={s.sidecarSpacer} aria-hidden="true" />
      )}

      {showCode && hasSource && <CodePanel asset={asset} onClose={() => setShowCode(false)} />}
    </div>
  );
}
