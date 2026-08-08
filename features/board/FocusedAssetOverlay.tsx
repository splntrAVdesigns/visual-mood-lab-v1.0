'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  CloseIcon,
  CodeIcon,
  FullscreenIcon,
  IconButton,
  Tooltip,
} from '@/components/ui';
import { selectSelectedAsset, useBoardStore, useInspectorStore, usePlaybackStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { RendererStage } from './RendererStage';
import { CodePanel } from './CodePanel';
import { ModulationPanel } from '../inspector/ModulationPanel';
import { closeAsset, openAssetById } from './openAsset';
import {
  createSnapshot,
  deleteSnapshot,
  downloadBlob,
  storeSnapshotCapture,
} from '@/lib/persist/client';
import { getPool } from '@/lib/render/pool';
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
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setShowCode(false);
    setShowMod(false);
    setSavedNote(null);
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
  const modulatableControls = (schema?.controls ?? []).filter(
    (c) => c.modulatable === true && (c.kind === 'slider' || c.kind === 'stepper'),
  );
  const canModulate = !asset.isSnapshot && modulatableControls.length > 0;

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

  return (
    <div
      className={s.focusScrim}
      data-code={showCode ? 'true' : undefined}
      data-mod={showMod ? 'true' : undefined}
      onClick={closeOverlay}
    >
      {showMod && canModulate && (
        <ModulationPanel controls={modulatableControls} onClose={() => setShowMod(false)} />
      )}

      <div
        ref={panelRef}
        className={s.focusPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
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
                  }}
                >
                  <CodeIcon />
                  Code
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

              {!asset.isSnapshot && (
                <Tooltip content="Save these settings as a snapshot and export a PNG">
                  <Button variant="ghost" onClick={saveSnapshot} disabled={saving}>
                    {saving ? 'Saving…' : 'Save snapshot'}
                  </Button>
                </Tooltip>
              )}

              {savedNote && <span className={s.savedNote}>{savedNote}</span>}

              {asset.isSnapshot && (
                <Button variant="danger" onClick={removeSnapshot}>
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

      {showCode && hasSource && <CodePanel asset={asset} onClose={() => setShowCode(false)} />}
    </div>
  );
}

