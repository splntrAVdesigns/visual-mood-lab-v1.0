'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, CloseIcon } from '@/components/ui';
import { selectSnapshots, useBoardStore } from '@/stores';
import { deleteSnapshot } from '@/lib/persist/client';
import type { Asset } from '@/types/asset';
import s from '../features.module.css';

interface SnapshotsProps {
  onOpen: (asset: Asset) => void;
}

/**
 * Saved parameter variations, in their own section.
 *
 * Kept out of the main grid on purpose: a snapshot is a personal derivative
 * of a library asset, and letting them prepend into "All assets" meant every
 * save shoved the library around and buried what you were browsing.
 */
export function Snapshots({ onOpen }: SnapshotsProps) {
  const snapshots = useBoardStore(useShallow(selectSnapshots));
  const removeAsset = useBoardStore((st) => st.removeAsset);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (snapshots.length === 0) return null;

  const remove = async (asset: Asset, e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(asset.itemId);
    const ok = await deleteSnapshot(asset.itemId);
    setBusy(null);
    if (ok) removeAsset(asset.itemId);
  };

  /**
   * Downloads every snapshot's captured frame. Sequential rather than
   * parallel — browsers throttle or silently drop simultaneous downloads,
   * and a stalled export that loses half the collection is worse than one
   * that takes an extra second.
   */
  const exportAll = async () => {
    if (exporting) return;
    setExporting(true);

    for (const snap of snapshots) {
      if (!snap.posterUrl) continue;
      try {
        const res = await fetch(snap.posterUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${snap.id}-${snap.itemId.slice(0, 8)}.png`;
        a.click();
        URL.revokeObjectURL(url);
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        /* one failed file should not abort the rest of the collection */
      }
    }

    setExporting(false);
  };

  return (
    <section className={s.snapshotSection} aria-label="Snapshots">
      <div className={s.snapshotBar}>
        <span className={s.snapshotLabel}>Snapshots</span>
        <span className={s.boardMeta}>{snapshots.length}</span>
        <span className={s.boardBarSpacer} />
        <Button variant="outline" onClick={exportAll} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export collection'}
        </Button>
      </div>

      <div className={s.snapshotStrip}>
        {snapshots.map((snap) => (
          <div key={snap.itemId} className={s.snapshotCard}>
            <button
              type="button"
              className={s.snapshotOpen}
              onClick={() => onOpen(snap)}
              title={`Open ${snap.title} snapshot`}
            >
              {snap.posterUrl ? (
                <img className={s.snapshotPoster} src={snap.posterUrl} alt="" loading="lazy" />
              ) : (
                <span className={s.snapshotPending}>capturing…</span>
              )}
              <span className={s.snapshotTitle}>{snap.title}</span>
            </button>

            <button
              type="button"
              className={s.snapshotDelete}
              aria-label={`Delete ${snap.title} snapshot`}
              title="Delete snapshot"
              disabled={busy === snap.itemId}
              onClick={(e) => remove(snap, e)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
