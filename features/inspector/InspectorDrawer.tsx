'use client';

import { useCallback, useState } from 'react';
import {
  Badge,
  Button,
  ChevronRightIcon,
  Drawer,
  IconButton,
  ResetIcon,
  Tooltip,
} from '@/components/ui';
import { groupedControls, isVisible } from '@/renderers/control-schema';
import { selectSelectedAsset, useBoardStore, useInspectorStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { ControlRow } from './ControlRow';
import s from '../features.module.css';

export function InspectorDrawer() {
  const open = useInspectorStore((st) => st.open);
  const close = useInspectorStore((st) => st.closeInspector);
  const schema = useInspectorStore((st) => st.schema);
  const params = useInspectorStore((st) => st.params);
  const dirty = useInspectorStore((st) => st.dirty);
  const setParam = useInspectorStore((st) => st.setParam);
  const resetParam = useInspectorStore((st) => st.resetParam);
  const resetAll = useInspectorStore((st) => st.resetAll);
  const showAdvanced = useInspectorStore((st) => st.showAdvanced);
  const toggleAdvanced = useInspectorStore((st) => st.toggleAdvanced);

  const asset = useBoardStore(selectSelectedAsset);
  const select = useBoardStore((st) => st.select);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Memoized so its identity survives the re-renders that happen on every
  // keystroke in a text control (params changing re-renders this whole
  // component). Drawer's useDismissable effect lists onClose as a
  // dependency for its Escape-key handler, so an unstable reference here
  // was re-firing that effect — and its focus-steal-on-open logic — every
  // time a character was typed. See Drawer.tsx's useDismissable comment
  // for the fuller root-cause writeup; that effect is now also guarded
  // against this, but fixing it here too means the bug can't come back
  // just because Drawer's guard was bypassed some other way.
  const onClose = useCallback(() => {
    close();
    select(null);
  }, [close, select]);

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const groups = schema ? groupedControls(schema) : [];
  const hasAdvanced = schema?.controls.some((c) => c.advanced) ?? false;

  return (
    <Drawer
      open={open}
      side="right"
      title="Inspector"
      onClose={onClose}
      modal={false}
      actions={
        <Tooltip content="Restore this asset's library defaults" align="end">
          <IconButton label="Restore defaults" icon={<ResetIcon />} onClick={resetAll} />
        </Tooltip>
      }
      footer={
        hasAdvanced ? (
          <Button variant="outline" block onClick={toggleAdvanced} active={showAdvanced}>
            {showAdvanced ? 'Hide advanced' : 'Show advanced'}
          </Button>
        ) : undefined
      }
    >
      {!schema && (
        <p className={s.inspectorEmpty}>Select a card to inspect its parameters.</p>
      )}

      {schema && (
        <>
          {asset && (
            <div className={s.inspectorMeta}>
              <span className={s.inspectorMetaTitle}>{asset.title}</span>
              <Badge>{ASSET_TYPE_BADGE[asset.type]}</Badge>
            </div>
          )}

          {groups.map(({ group, controls }) => {
            const isCollapsed = collapsed.has(group.id) || (group.collapsed && !collapsed.has(`!${group.id}`));

            const rows = controls
              .filter((c) => isVisible(c, params))
              .filter((c) => showAdvanced || !c.advanced);

            if (rows.length === 0) return null;

            return (
              <section key={group.id} className={s.group}>
                <button
                  type="button"
                  className={s.groupHead}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(group.collapsed ? `!${group.id}` : group.id)}
                >
                  <ChevronRightIcon className={s.groupChevron} />
                  {group.label}
                  <span className={s.groupRule} />
                </button>

                {!isCollapsed &&
                  rows.map((c) => (
                    <ControlRow
                      key={c.id}
                      control={c}
                      value={params[c.id] ?? null}
                      dirty={dirty.has(c.id)}
                      onChange={(v) => setParam(c.id, v)}
                      onReset={() => resetParam(c.id)}
                    />
                  ))}
              </section>
            );
          })}

          <p className={s.notice}>
            <span className={s.noticeStrong}>Autosaved.</span> Every change here writes to this
            asset's library entry and survives reloads. Use the restore icon above to return this
            asset to its original library defaults at any time.
          </p>
        </>
      )}
    </Drawer>
  );
}
