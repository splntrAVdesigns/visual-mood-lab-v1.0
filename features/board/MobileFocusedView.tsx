'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, CameraIcon, CloseIcon, CodeIcon, DownloadIcon, FullscreenIcon, IconButton, ResetIcon, Toast, Tooltip } from '@/components/ui';
import {
  selectSelectedAsset,
  useBoardStore,
  useInspectorStore,
  usePlaybackStore,
} from '@/stores';
import { groupedControls, isVisible, isDisabledByState } from '@/renderers/control-schema';
import { ControlRow } from '@/features/inspector/ControlRow';
import { RollBar } from '@/features/inspector/RollBar';
import { GroupLockButton } from '@/features/inspector/RollLocks';
import roll from '@/features/inspector/rollBar.module.css';
import { ModulationPanel } from '@/features/inspector/ModulationPanel';
import { SoundPanel } from '@/features/inspector/SoundPanel';
import { VfxPanel } from '@/features/inspector/VfxPanel';
import { getCompatiblePresets } from '@/lib/sound/presets';
import { RendererStage } from './RendererStage';
import { CodePanel } from './CodePanel';
import { CapturePanel } from './CapturePanel';
import { RecordButton } from './RecordButton';
import { closeAsset } from './openAsset';
import {
  createSnapshot,
  deleteSnapshot,
  downloadBlob,
  downloadSnapshotImage,
  storeSnapshotCapture,
} from '@/lib/persist/client';
import { getPool } from '@/lib/render/pool';
import { CAPTURE_DEFAULT_DURATION_SEC, type CaptureFormat } from '@/lib/capture/types';
import s from '../features.module.css';

type Tab = 'controls' | 'vfx' | 'modulate' | 'sound' | 'capture';

/**
 * The focused view on a narrow screen.
 *
 * The desktop version puts the graphic in the middle and the inspector in a
 * fixed drawer pinned to the right edge — two independently positioned
 * overlays that happen to sit beside each other. That model has nowhere to
 * go below ~820px: the drawer would cover the very thing being adjusted.
 *
 * So this is a genuinely different composition rather than the same one
 * squeezed. One column, full height. The canvas is pinned to the top and
 * never scrolls away — you can always see what a control is doing while you
 * drag it, which is the entire point of the app. Everything below it is one
 * scroll region with the parameter list and, behind a tab, the modulation
 * routing. Tabs rather than stacking both: a shader with twenty parameters
 * plus routing for each would be an endless scroll, and switching is
 * cheaper than hunting.
 */
export function MobileFocusedView() {
  const open = useInspectorStore((st) => st.open);
  const schema = useInspectorStore((st) => st.schema);
  const params = useInspectorStore((st) => st.params);
  const dirty = useInspectorStore((st) => st.dirty);
  const showAdvanced = useInspectorStore((st) => st.showAdvanced);
  const setParam = useInspectorStore((st) => st.setParam);
  const resetParam = useInspectorStore((st) => st.resetParam);
  const resetAll = useInspectorStore((st) => st.resetAll);
  const toggleAdvanced = useInspectorStore((st) => st.toggleAdvanced);

  const asset = useBoardStore(selectSelectedAsset);

  const [tab, setTab] = useState<Tab>('controls');
  const [showCode, setShowCode] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingSnapshot, setDownloadingSnapshot] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [downloadingUpload, setDownloadingUpload] = useState(false);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('mp4');
  const [captureDuration, setCaptureDuration] = useState(CAPTURE_DEFAULT_DURATION_SEC);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab('controls');
    setShowCode(false);
    setPseudoFullscreen(false);
    setSavedNote(null);
    // Reset scroll when switching assets — carrying the previous asset's
    // scroll position into a different control list is disorienting.
    sheetRef.current?.scrollTo({ top: 0 });
    // `open` is in the deps too, not just asset?.itemId — this component
    // returns null rather than unmounting when closed (see below), so
    // reopening the SAME asset would otherwise leave pseudoFullscreen (and
    // the tab/scroll state) stuck exactly where it was left last time.
  }, [asset?.itemId, open]);

  // Freeze the board behind, same as desktop: nothing off-screen should be
  // burning a renderer slot while a focused asset needs it.
  useEffect(() => {
    if (!open) return;
    usePlaybackStore.getState().setBoardFrozen(true);
    return () => {
      usePlaybackStore.getState().setBoardFrozen(false);
      usePlaybackStore.getState().bumpEpoch();
    };
  }, [open]);

  // Lock the page behind the sheet. Without this, scrolling past the end of
  // the control list scrolls the board underneath — the classic scroll-chain
  // problem, and especially disorienting when the thing behind is a grid.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !asset) return null;

  const hasSource = Boolean(asset.source);
  // Also gated on isVisible(c, params) — same fix and same reasoning as
  // FocusedAssetOverlay's identical list; see that file's comment. Without
  // it, a control hidden behind another mode's showIf could still be
  // offered (and auto-assigned) as a modulation target while invisible.
  const modulatable = (schema?.controls ?? []).filter(
    (c) => c.modulatable === true && (c.kind === 'slider' || c.kind === 'stepper') && isVisible(c, params),
  );
  const canModulate = !asset.isSnapshot && modulatable.length > 0;
  // See FocusedAssetOverlay's identical change for the full reasoning —
  // Sound now also covers Tier 2 assets (modulatable, no synth preset),
  // since that's exactly what an uploaded Track is for (Phase 4.9).
  const canSound = !asset.isSnapshot && (getCompatiblePresets(schema).length > 0 || canModulate);
  // Phase 4.96 — see FocusedAssetOverlay's identical canVfx for the full
  // reasoning: scoped to shader tiles only until MediaRenderer has an
  // output canvas to composite onto.
  const canVfx = !asset.isSnapshot && asset.type === 'shader';
  // Same gate, same reason as FocusedAssetOverlay's canCapture — see
  // lib/capture/engine.ts's top doc for why p5 sketch tiles can't record
  // yet (sandboxed cross-origin canvas isn't a valid capture source).
  const canCapture = !asset.isSnapshot && asset.type === 'shader';
  const groups = schema ? groupedControls(schema) : [];
  const hasAdvanced = (schema?.controls.some((c) => c.advanced) ?? false) && !showAdvanced;

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

  // See FocusedAssetOverlay's identical function for the full reasoning —
  // this is the mobile twin of the same fix (per-snapshot re-download,
  // since Save-and-download only ever fires once, at creation time).
  const downloadSnapshot = async () => {
    if (!asset.isSnapshot || downloadingSnapshot) return;
    setDownloadingSnapshot(true);
    setSavedNote(null);
    const ok = await downloadSnapshotImage(asset.posterUrl, `${asset.id}-${asset.itemId.slice(0, 8)}.png`);
    setDownloadingSnapshot(false);
    setSavedNote(ok ? null : 'Download failed');
  };

  // Mirrors FocusedAssetOverlay's identical isDeletableUpload/downloadUpload
  // pair — see that file's doc for the full reasoning. Mobile never had a
  // delete affordance for uploaded/captured media either (a pre-existing
  // gap, not touched here); this only adds the download half that was
  // actually asked for, keeping this pass narrowly scoped.
  const isDeletableUpload =
    !asset.isSnapshot && (asset.type === 'image' || asset.type === 'svg' || asset.type === 'video');

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

  // Mirrors FocusedAssetOverlay's identical removeUpload — this was the
  // actual gap the earlier download-only pass flagged and deliberately
  // left open. Same confirm, same endpoint, same cleanup.
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
      className={s.mobileFocus}
      data-fullscreen={pseudoFullscreen || undefined}
      role="dialog"
      aria-modal="true"
      data-focused-view="true"
      aria-label={asset.title}
    >
      <header className={s.mobileFocusHeader}>
        <span className={s.mobileFocusTitle}>{asset.title}</span>
        <span className={s.mobileFocusSpacer} />

        {hasSource && (
          <IconButton
            label="Code"
            icon={<CodeIcon />}
            active={showCode}
            onClick={() => setShowCode((v) => !v)}
          />
        )}

        {canCapture && (
          <>
            <Tooltip content="Set export format and duration">
              <Button
                variant="ghost"
                className={s.vcaptureCompact}
                active={tab === 'capture'}
                onClick={() => setTab((t) => (t === 'capture' ? 'controls' : 'capture'))}
              >
                VC
              </Button>
            </Tooltip>
            <RecordButton
              asset={asset}
              canCapture={canCapture}
              format={captureFormat}
              durationSec={captureDuration}
              variant="icon"
            />
          </>
        )}

        {!asset.isSnapshot && (
          <Tooltip content={saving ? 'Saving…' : 'Save snapshot'}>
            <IconButton label="Save snapshot" icon={<CameraIcon />} onClick={saveSnapshot} disabled={saving} />
          </Tooltip>
        )}
        {asset.isSnapshot && (
          <Tooltip content={downloadingSnapshot ? 'Downloading…' : 'Download'}>
            <IconButton
              label="Download"
              icon={<DownloadIcon />}
              onClick={downloadSnapshot}
              disabled={downloadingSnapshot}
            />
          </Tooltip>
        )}
        {isDeletableUpload && (
          <Tooltip content={downloadingUpload ? 'Downloading…' : 'Download this file'}>
            <IconButton
              label="Download"
              icon={<DownloadIcon />}
              onClick={() => void downloadUpload()}
              disabled={downloadingUpload}
            />
          </Tooltip>
        )}

        <Tooltip content="Restore this asset's library defaults">
          <IconButton label="Restore defaults" icon={<ResetIcon />} onClick={resetAll} />
        </Tooltip>
        <Tooltip content={pseudoFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <IconButton
            label="Toggle fullscreen"
            icon={<FullscreenIcon on={pseudoFullscreen} />}
            onClick={() => setPseudoFullscreen((v) => !v)}
          />
        </Tooltip>
        <IconButton label="Close" icon={<CloseIcon />} onClick={() => closeAsset()} />
      </header>

      {/* Pinned: never scrolls away, so a control's effect is always visible
          while it is being dragged. */}
      <div className={s.mobileStage}>
        <RendererStage asset={asset} focused />
      </div>

      {/* Snapshot delete and upload/recording delete share this row —
          both are destructive and both deliberately stay out of the icon
          header for the same reason (.mobileDangerRow's own CSS comment):
          a destructive action as one more small icon among six others is
          one mis-tap away from an accidental delete. Mutually exclusive in
          practice (a snapshot is never also a deletable upload), so only
          one button ever renders here. Everything else that used to live
          in the now-retired .mobileActions row moved into the header
          instead of here. */}
      {asset.isSnapshot && (
        <div className={s.mobileDangerRow}>
          <Button variant="danger" onClick={removeSnapshot}>
            Delete snapshot
          </Button>
        </div>
      )}
      {isDeletableUpload && (
        <div className={s.mobileDangerRow}>
          <Button variant="danger" onClick={() => void removeUpload()}>
            Delete
          </Button>
        </div>
      )}

      <Toast message={savedNote} onDismiss={() => setSavedNote(null)} durationMs={2600} />

      {(canModulate || canSound || canVfx) && (
        <div className={s.mobileTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'controls'}
            className={s.mobileTab}
            data-active={tab === 'controls' ? 'true' : undefined}
            onClick={() => setTab('controls')}
          >
            Parameters
          </button>
          {canVfx && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'vfx'}
              className={s.mobileTab}
              data-active={tab === 'vfx' ? 'true' : undefined}
              onClick={() => setTab('vfx')}
            >
              VFX
            </button>
          )}
          {canModulate && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'modulate'}
              className={s.mobileTab}
              data-active={tab === 'modulate' ? 'true' : undefined}
              onClick={() => setTab('modulate')}
            >
              Modulate
            </button>
          )}
          {canSound && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'sound'}
              className={s.mobileTab}
              data-active={tab === 'sound' ? 'true' : undefined}
              onClick={() => setTab('sound')}
            >
              Sounds
            </button>
          )}
        </div>
      )}

      <div className={s.mobileSheet} ref={sheetRef}>
        {tab === 'modulate' && canModulate ? (
          <ModulationPanel controls={modulatable} itemId={asset.itemId} onClose={() => setTab('controls')} embedded />
        ) : tab === 'vfx' && canVfx ? (
          <VfxPanel itemId={asset.itemId} onClose={() => setTab('controls')} embedded />
        ) : tab === 'sound' && canSound && schema ? (
          <SoundPanel schema={schema} itemId={asset.itemId} onClose={() => setTab('controls')} embedded />
        ) : tab === 'capture' && canCapture ? (
          <CapturePanel
            format={captureFormat}
            durationSec={captureDuration}
            onFormatChange={setCaptureFormat}
            onDurationChange={setCaptureDuration}
            onClose={() => setTab('controls')}
            embedded
          />
        ) : (
          <>
            <RollBar assetType={asset.type} variant="sheet" />
            {groups.map(({ group, controls }) => {
              const rows = controls
                .filter((c) => isVisible(c, params))
                .filter((c) => showAdvanced || !c.advanced);
              if (rows.length === 0) return null;

              return (
                <section key={group.id} className={s.mobileGroup} data-lockgroup="true">
                  {/* Skipped when there's only one group total — the
                      "Parameters" tab immediately above already says
                      this, and repeating it here just eats vertical
                      space on a screen that's already tight. A schema
                      with multiple real groups still gets a heading per
                      group, since those actually need distinguishing
                      from each other — EXCEPT "Global" specifically,
                      which never told the user anything (every control
                      is implicitly global unless some other group says
                      otherwise) and just sat there as boilerplate above
                      the first control. Dropped unconditionally; every
                      other group label is untouched. */}
                  {groups.length > 1 && group.label.trim().toLowerCase() !== 'global' && (
                    <div className={roll.groupHeadRow}>
                      <h2 className={s.mobileGroupLabel}>{group.label}</h2>
                      <GroupLockButton label={group.label} controls={rows} className={roll.groupLockSheet} />
                    </div>
                  )}
                  {rows.map((c) => (
                    <ControlRow
                      key={c.id}
                      control={c}
                      value={params[c.id] ?? null}
                      dirty={dirty.has(c.id)}
                      onChange={(v) => setParam(c.id, v)}
                      onReset={() => resetParam(c.id)}
                      forceDisabled={isDisabledByState(c, params)}
                    />
                  ))}
                </section>
              );
            })}

            {hasAdvanced && (
              <Button variant="outline" block onClick={toggleAdvanced}>
                Show advanced
              </Button>
            )}

            <p className={s.notice}>
              <span className={s.noticeStrong}>Autosaved.</span> Changes write to this asset&rsquo;s
              library entry and survive reloads. Restore returns it to the original defaults.
            </p>
          </>
        )}
      </div>

      {showCode && hasSource && <CodePanel asset={asset} onClose={() => setShowCode(false)} />}
    </div>
  );
}
