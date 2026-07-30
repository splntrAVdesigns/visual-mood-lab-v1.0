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
  }, [asset, focused, reducedMotion, quality, epoch, hovered, boardFrozen]);
  // Deps intentionally include the whole `asset` object — asset.itemId
  // changing (opening a different card) must always re-run this effect.
  // epoch changes force this effect to re-run, which recreates the
  // IntersectionObserver and re-checks current visibility. That is what lets
  // a grid card reclaim its live renderer after a focused overlay — which
  // borrows the same renderer for the same asset — closes.

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
