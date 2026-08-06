'use client';

import { useEffect, useRef, useState } from 'react';

/** Pause required before hovering counts as intent to preview. */
const HOVER_INTENT_MS = 350;
import { getPool } from '@/lib/render/pool';
import { captureAndStorePoster, isPlaceholderPoster } from '@/lib/persist/client';
import { usePlaybackStore } from '@/stores';
import type { Asset, CardState } from '@/types/asset';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import s from '../features.module.css';

interface RendererStageProps {
  asset: Asset;
  /** 'focused' keeps the renderer at full quality and immune to eviction. */
  focused?: boolean;
}

/**
 * The card stage.
 *
 * Poster by default. Entering the viewport promotes to a live preview;
 * leaving demotes back to the poster and frees the renderer. The poster stays
 * mounted underneath the whole time, so demotion is instant and there is
 * never a blank frame.
 */
export function RendererStage({ asset, focused = false }: RendererStageProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<CardState>('poster');
  const [error, setError] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | undefined>(asset.posterUrl);

  const paused = usePlaybackStore((st) => st.paused);
  const reducedMotion = usePlaybackStore((st) => st.reducedMotion);
  const quality = usePlaybackStore((st) => st.quality);
  const epoch = usePlaybackStore((st) => st.epoch);
  const boardFrozen = usePlaybackStore((st) => st.boardFrozen);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const pool = getPool();
    const unsubscribe = pool.subscribe((id, next, err) => {
      if (id !== asset.itemId) return;
      setState(next);
      setError(err);
    });

    // Never start a renderer when motion is unwanted or everything is parked.
    // Frozen board (an asset is enlarged) or reduced motion: no grid card
    // animates. All budget goes to the focused asset.
    if (reducedMotion || (boardFrozen && !focused)) {
      pool.demote(asset.itemId, host);
      setState('poster');
      return () => unsubscribe();
    }

    let cancelled = false;
    let captureTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (cancelled) return;

          if (entry.isIntersecting && (focused || hovered)) {
            setState(focused ? 'focused' : 'preview');
            void pool.promote(asset, host, focused ? 'focused' : 'preview').then(() => {
              if (cancelled) return;
              // Replace the generated placeholder with a real frame. Delayed
              // so the capture shows the asset in motion rather than its
              // first, often blank, frame.
              if (!isPlaceholderPoster(asset.posterUrl)) return;
              captureTimer = setTimeout(() => {
                const renderer = pool.get(asset.itemId);
                if (!renderer || cancelled) return;
                // Poster storage stays keyed by the real asset id — the
                // poster belongs to the shader/sketch source and is shared
                // across every snapshot of it, not per-card.
                void captureAndStorePoster(asset.id, renderer).then((url) => {
                  if (url && !cancelled) setPoster(url);
                });
              }, 2500);
            });
          } else if (!focused) {
            pool.demote(asset.itemId, host);
            setState('poster');
          }
        }
      },
      // Start loading slightly before the card is on screen so scrolling does
      // not reveal a wall of posters mid-promotion.
      { rootMargin: '120px', threshold: 0.01 },
    );

    observer.observe(host);

    return () => {
      cancelled = true;
      if (captureTimer) clearTimeout(captureTimer);
      observer.disconnect();
      unsubscribe();
      pool.demote(asset.itemId, host);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asset.itemId
    // is deliberately used instead of `asset`; see the comment below.
  }, [asset.itemId, focused, reducedMotion, quality, epoch, hovered, boardFrozen]);
  // Deps deliberately do NOT include the whole `asset` object — only
  // asset.itemId, a primitive. This effect's job is mounting/detaching a
  // renderer for a given card; it doesn't need the latest params or mod to
  // do that, because live edits already reach the renderer through a
  // completely separate path (inspectorStore's setParam calls
  // renderer.setParam() directly). Depending on the whole object meant
  // ANY change to the asset — including a debounced params/mod sync from
  // the board store, which always produces a new object reference — was
  // tearing this renderer down and re-promoting it, visible as a flash
  // every time an edit settled. asset.itemId is exactly the one thing that
  // genuinely means "a different card" (opening a different asset,
  // closing this one), which is the only case that should ever remount.
  // The effect body still reads the current `asset` via closure when it
  // does run — that's always fresh from whichever render scheduled it, and
  // this effect not re-running when only params change is precisely the
  // point, not a staleness bug.

  useEffect(() => {
    getPool().setPaused(paused || reducedMotion);
  }, [paused, reducedMotion]);

  const live = state !== 'poster' && !error;

  return (
    <span
      className={s.cardStage}
      onPointerEnter={(e) => {
        if (focused || e.pointerType !== 'mouse') return;
        // Intent delay: flying the cursor across the board should not light
        // up every tile it crosses. Only a deliberate pause starts a render.
        hoverTimer.current = setTimeout(() => setHovered(true), HOVER_INTENT_MS);
      }}
      onPointerLeave={() => {
        if (focused) return;
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setHovered(false);
      }}
    >
      {poster ? (
        <img
          className={s.cardPoster}
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          data-dimmed={live ? 'true' : undefined}
        />
      ) : (
        <span className={s.cardPlaceholder}>
          <span className={s.cardPlaceholderMark}>{ASSET_TYPE_BADGE[asset.type]}</span>
        </span>
      )}

      <span ref={hostRef} className={s.cardCanvas} data-live={live ? 'true' : undefined} />

      {state !== 'poster' && !error && <span className={s.cardLiveDot} aria-hidden="true" />}

      {error && (
        <span className={s.cardError} title={error}>
          {error.split('\n')[0].slice(0, 80)}
        </span>
      )}
    </span>
  );
}
