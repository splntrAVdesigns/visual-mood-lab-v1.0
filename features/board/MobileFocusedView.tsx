'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, CloseIcon, CodeIcon, FullscreenIcon, IconButton, Tooltip } from '@/components/ui';
import {
  selectSelectedAsset,
  useBoardStore,
  useInspectorStore,
  usePlaybackStore,
} from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { groupedControls, isVisible, isDisabledByState } from '@/renderers/control-schema';
import { ControlRow } from '@/features/inspector/ControlRow';
import { ModulationPanel } from '@/features/inspector/ModulationPanel';
import { SoundPanel } from '@/features/inspector/SoundPanel';
import { getCompatiblePresets } from '@/lib/sound/presets';
import { RendererStage } from './RendererStage';
import { CodePanel } from './CodePanel';
import { closeAsset } from './openAsset';
import {
  createSnapshot,
  deleteSnapshot,
  downloadBlob,
  downloadSnapshotImage,
  storeSnapshotCapture,
} from '@/lib/persist/client';
import { getPool } from '@/lib/render/pool';
import s from '../features.module.css';

type Tab = 'controls' | 'modulate' | 'sound';

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

  useEffect(() => {
    if (!savedNote) return;
    const t = setTimeout(() => setSavedNote(null), 2600);
    return () => clearTimeout(t);
  }, [savedNote]);

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

  return (
    <div
      className={s.mobileFocus}
      data-fullscreen={pseudoFullscreen || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={asset.title}
    >
      <header className={s.mobileFocusHeader}>
        <span className={s.mobileFocusTitle}>{asset.title}</span>
        <Badge>{asset.isSnapshot ? 'SNAP' : ASSET_TYPE_BADGE[asset.type]}</Badge>
        <span className={s.mobileFocusSpacer} />
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

      <div className={s.mobileActions}>
        {!asset.isSnapshot && (
          <Button variant="ghost" onClick={saveSnapshot} disabled={saving}>
            {saving ? 'Saving…' : 'Snapshot'}
          </Button>
        )}
        {hasSource && (
          <Button variant="ghost" active={showCode} onClick={() => setShowCode((v) => !v)}>
            <CodeIcon />
            Code
          </Button>
        )}
        {asset.isSnapshot && (
          <Button variant="ghost" onClick={downloadSnapshot} disabled={downloadingSnapshot}>
            {downloadingSnapshot ? 'Downloading…' : 'Download'}
          </Button>
        )}
        {asset.isSnapshot && (
          <Button variant="danger" onClick={removeSnapshot}>
            Delete
          </Button>
        )}
        <span className={s.mobileFocusSpacer} />
        {savedNote && <span className={s.savedNote}>{savedNote}</span>}
        <Button variant="ghost" onClick={resetAll}>
          Restore
        </Button>
      </div>

      {(canModulate || canSound) && (
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
        ) : tab === 'sound' && canSound && schema ? (
          <SoundPanel schema={schema} itemId={asset.itemId} onClose={() => setTab('controls')} embedded />
        ) : (
          <>
            {groups.map(({ group, controls }) => {
              const rows = controls
                .filter((c) => isVisible(c, params))
                .filter((c) => showAdvanced || !c.advanced);
              if (rows.length === 0) return null;

              return (
                <section key={group.id} className={s.mobileGroup}>
                  {/* Skipped when there's only one group total — the
                      "Parameters" tab immediately above already says
                      this, and repeating it here just eats vertical
                      space on a screen that's already tight. A schema
                      with multiple real groups still gets a heading per
                      group, since those actually need distinguishing
                      from each other. */}
                  {groups.length > 1 && <h2 className={s.mobileGroupLabel}>{group.label}</h2>}
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
