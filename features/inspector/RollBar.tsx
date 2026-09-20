'use client';

import { useMemo, useState } from 'react';
import { Button, ChevronRightIcon, DiceIcon, IconButton, RedoIcon, Slider, Toggle, UndoIcon } from '@/components/ui';
import { isRollableControl } from '@/lib/roll/policy';
import { useInspectorStore, useRollStore } from '@/stores';
import { isRollableAssetType, performMutate, performRedo, performRoll, performUndo } from './rollActions';
import s from './rollBar.module.css';

/**
 * Roll = a new look. Mutate = a nudge from the current one, by the strength set
 * in the disclosure. Undo / Redo cover whole-state operations (Roll, Mutate,
 * Restore defaults). Renders nothing for tiles that have no rollable controls
 * and for uploaded media (whose "params" are transform controls, not a look).
 *
 * The keyboard shortcuts live in useRollShortcuts (mounted once from AppShell)
 * rather than here: the desktop drawer and the mobile sheet each render a bar,
 * and a listener per bar would fire twice for one keypress.
 */
export function RollBar({ assetType, variant = 'drawer' }: { assetType: string; variant?: 'drawer' | 'sheet' }) {
  const schema = useInspectorStore((st) => st.schema);
  const assetId = useInspectorStore((st) => st.assetId);
  const canUndo = useInspectorStore((st) => st.history.past.length > 0);
  const canRedo = useInspectorStore((st) => st.history.future.length > 0);

  const strength = useRollStore((st) => st.strength);
  const includeToggles = useRollStore((st) => st.includeToggles);
  const locked = useRollStore((st) => st.locked);
  const message = useRollStore((st) => st.message);
  const setStrength = useRollStore((st) => st.setStrength);
  const setIncludeToggles = useRollStore((st) => st.setIncludeToggles);
  const setLocks = useRollStore((st) => st.setLocks);
  const clearLocks = useRollStore((st) => st.clearLocks);

  const [open, setOpen] = useState(false);

  const rollableIds = useMemo(
    () => (schema ? schema.controls.filter((c) => isRollableControl(c, assetId, { includeToggles })).map((c) => c.id) : []),
    [schema, assetId, includeToggles],
  );

  if (!isRollableAssetType(assetType) || rollableIds.length === 0) return null;

  const lockedCount = rollableIds.filter((id) => locked.has(id)).length;

  return (
    // display: contents — the wrapper generates no box, so the sticky row below
    // sticks against the SCROLLING body (its real containing block) instead of
    // being bounded by this wrapper. A sticky child can only stick while its
    // parent box is on screen; a normal wrapper would un-stick it after one screenful.
    <div className={variant === 'sheet' ? `${s.bar} ${s.barSheet}` : s.bar}>
      <div className={s.stickyRow} data-roll-bar="true">
        <div className={s.row}>
          <Button variant="outline" onClick={performRoll} title="Roll — a new look (R)">
            <DiceIcon /> Roll
          </Button>
          <span className={s.split}>
            <Button variant="outline" onClick={performMutate} title="Mutate — nudge the current look (M)">
              Mutate
            </Button>
            <IconButton
              variant="outline"
              label={open ? 'Hide Mutate options' : 'Mutate options'}
              aria-expanded={open}
              icon={<ChevronRightIcon className={s.caret} data-open={open ? 'true' : undefined} />}
              onClick={() => setOpen((v) => !v)}
            />
          </span>
          <span className={s.spacer} />
          <IconButton label="Undo (⌘Z)" icon={<UndoIcon />} onClick={performUndo} disabled={!canUndo} />
          <IconButton label="Redo (⇧⌘Z)" icon={<RedoIcon />} onClick={performRedo} disabled={!canRedo} />
        </div>
      </div>

      {open && (
        <div className={s.panel} data-roll-panel="true">
          <div className={s.panelRow}>
            <span className={s.panelLabel}>Strength</span>
            <div className={s.panelSlider}>
              <Slider label="Mutate strength" value={strength} min={5} max={100} step={5} onChange={setStrength} />
            </div>
            <span className={s.panelValue}>{strength}%</span>
          </div>
          <div className={s.panelRow}>
            <span className={s.panelLabel}>Include toggles in Roll</span>
            <span className={s.spacer} />
            <Toggle checked={includeToggles} label="Include toggles in Roll" onChange={setIncludeToggles} />
          </div>
          <div className={s.panelRow}>
            <span className={s.panelLabel}>
              {lockedCount} of {rollableIds.length} locked
            </span>
            <span className={s.spacer} />
            <Button variant="ghost" onClick={() => setLocks(rollableIds, true)} disabled={lockedCount === rollableIds.length}>
              Lock all
            </Button>
            <Button variant="ghost" onClick={clearLocks} disabled={lockedCount === 0}>
              Unlock all
            </Button>
          </div>
        </div>
      )}

      {/* Always rendered so the layout doesn't jump when feedback appears. */}
      <div className={s.status} role="status" aria-live="polite" data-roll-status="true">
        {message}
      </div>
    </div>
  );
}
