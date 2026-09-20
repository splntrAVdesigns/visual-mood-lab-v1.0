'use client';

import { IconButton, LockIcon, UnlockIcon, cx } from '@/components/ui';
import type { Control } from '@/renderers/control-schema';
import { isRollableControl } from '@/lib/roll/policy';
import { useInspectorStore, useRollStore } from '@/stores';
import s from './rollBar.module.css';

/**
 * A padlock beside a control's label: a locked control is skipped by Roll and
 * Mutate (manual edits still work). Shown only for controls Roll could ever
 * touch — a padlock on a trigger, a texture, an advanced knob or the strobe
 * rate would promise a protection that isn't needed or isn't the point.
 * Faint until the row is hovered or the button focused; always visible once
 * locked, and always visible on touch screens (there is no hover there).
 */
export function LockButton({ control }: { control: Control }) {
  const assetId = useInspectorStore((st) => st.assetId);
  const includeToggles = useRollStore((st) => st.includeToggles);
  const isLocked = useRollStore((st) => st.locked.has(control.id));
  const toggleLock = useRollStore((st) => st.toggleLock);

  if (!isRollableControl(control, assetId, { includeToggles })) return null;

  return (
    <IconButton
      className={s.lock}
      label={isLocked ? `Unlock ${control.label}` : `Lock ${control.label} so Roll and Mutate leave it alone`}
      icon={isLocked ? <LockIcon /> : <UnlockIcon />}
      aria-pressed={isLocked}
      data-locked={isLocked ? 'true' : undefined}
      onClick={() => toggleLock(control.id)}
      style={{ height: 16, width: 16 }}
    />
  );
}

/** Locks (or, when every rollable control in the group is already locked, unlocks) a whole section. */
export function GroupLockButton({ label, controls, className }: { label: string; controls: readonly Control[]; className?: string }) {
  const assetId = useInspectorStore((st) => st.assetId);
  const includeToggles = useRollStore((st) => st.includeToggles);
  const locked = useRollStore((st) => st.locked);
  const setLocks = useRollStore((st) => st.setLocks);

  const ids = controls.filter((c) => isRollableControl(c, assetId, { includeToggles })).map((c) => c.id);
  if (ids.length === 0) return null;
  const allLocked = ids.every((id) => locked.has(id));

  return (
    <IconButton
      className={cx(s.lock, s.groupLockButton, className)}
      label={allLocked ? `Unlock all of ${label}` : `Lock all of ${label}`}
      icon={allLocked ? <LockIcon /> : <UnlockIcon />}
      aria-pressed={allLocked}
      data-locked={allLocked ? 'true' : undefined}
      onClick={() => setLocks(ids, !allLocked)}
      style={{ height: 16, width: 16 }}
    />
  );
}
