'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, CloseIcon, CodeIcon, IconButton } from '@/components/ui';
import { selectSelectedAsset, useBoardStore, useInspectorStore, usePlaybackStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { RendererStage } from './RendererStage';
import { CodePanel } from './CodePanel';
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
  const closeInspector = useInspectorStore((st) => st.closeInspector);
  const asset = useBoardStore(selectSelectedAsset);
  const select = useBoardStore((st) => st.select);

  const [showCode, setShowCode] = useState(false);

  // Reset the code panel whenever a different asset is focused, so opening a
  // new card never inherits the previous one's panel state.
  useEffect(() => {
    setShowCode(false);
  }, [asset?.id]);

  // Whenever this view stops being open — for any reason: the X here, the
  // inspector's own X, Escape, clicking the scrim — reclaim the renderer for
  // the grid thumbnail it was borrowed from. Tying this to a cleanup rather
  // than to a specific button's onClick means every closing path is covered
  // by construction, not by remembering to call it in four different places.
  useEffect(() => {
    if (!open) return;
    return () => {
      usePlaybackStore.getState().bumpEpoch();
    };
  }, [open]);

  if (!open || !asset) return null;

  const hasSource = Boolean(asset.source);

  const onClose = () => {
    closeInspector();
    select(null);
  };

  return (
    <div className={s.focusScrim} data-code={showCode ? "true" : undefined} onClick={onClose}>
      <div
        className={s.focusPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={asset.title}
      >
        <header className={s.focusHeader}>
          <span className={s.focusTitle}>{asset.title}</span>
          <Badge>{ASSET_TYPE_BADGE[asset.type]}</Badge>
          {hasSource && (
            <Button
              variant="ghost"
              active={showCode}
              onClick={() => setShowCode((v) => !v)}
            >
              <CodeIcon />
              Code
            </Button>
          )}
          <IconButton
            label="Close"
            icon={<CloseIcon />}
            onClick={onClose}
            className={s.focusClose}
          />
        </header>

        <div className={s.focusStage}>
          <RendererStage asset={asset} focused />
        </div>
      </div>

      {showCode && hasSource && (
        <CodePanel asset={asset} onClose={() => setShowCode(false)} />
      )}
    </div>
  );
}
