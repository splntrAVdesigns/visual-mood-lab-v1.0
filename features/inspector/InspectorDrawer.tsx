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
import { groupedControls, isVisible, type ParamValue } from '@/renderers/control-schema';
import { selectSelectedAsset, useBoardStore, useInspectorStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { WAVE_SHAPE_CONTROL_ID, waveShapeValueToLfoShape } from '@/lib/sound/types';
import { ControlRow } from './ControlRow';
import s from '../features.module.css';

/**
 * Controls that only affect Static Choir's own procedural mock generator
 * — inert once Sound is on and driving the real waveform trace instead
 * (see p5.renderer.ts's audioWaveform bridge and the sketch's own
 * getAudioWaveform() branch). Deliberately scoped by exact control id,
 * not a generic "everything on a sound-enabled tile locks" rule.
 *
 * Static Intensity, Glitch Frequency, Motion Blur, and Phosphor Glow all
 * apply to BOTH draw paths (grain/burst/trail/glow work identically on
 * the real trace or the generated one), so none of them ever go inert.
 * What's left here is exactly the mock-only artifacts: the multi-layer
 * stack and the scanline roll bands, neither of which has a live-mode
 * equivalent.
 *
 * Lives here rather than in lib/sound/ because this is inspector-layer
 * presentation knowledge about one specific tile's schema, not something
 * the sound engine itself needs to know — same reasoning as the
 * architecture doc's "the moment a shared component knows domain
 * knowledge, it moves to the feature that owns it."
 */
const STATIC_CHOIR_MOCK_ONLY_CONTROL_IDS = new Set([
  'layers',
  'layerSpread',
  'scanlines',
  'scanlineWidth',
  'scanlineMotion',
]);

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
  // Sound-side half of the Wave/Waveform Shape sync — see
  // lib/sound/types.ts's WAVE_SHAPE_CONTROL_ID doc. Read here (not just in
  // SoundPanel) because a change to the VISUAL 'waveShape' control, which
  // this drawer owns, needs to push the other direction into SoundState
  // too while Sound is on.
  const sound = useInspectorStore((st) => st.sound);
  const setSoundState = useInspectorStore((st) => st.setSoundState);

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

  // Wraps the plain setParam(id, value) write path with the Wave/Waveform
  // Shape sync — see lib/sound/types.ts's WAVE_SHAPE_CONTROL_ID doc. Only
  // ever does anything extra for a control literally named 'waveShape';
  // every other control's onChange behaves exactly as it always did.
  // Syncs unconditionally, not just while Sound is enabled — mirrors
  // SoundPanel's Wave dropdown doing the same in the other direction, so
  // the two controls are ALWAYS mirrors of each other rather than only
  // agreeing once Sound happens to already be on.
  const handleParamChange = useCallback(
    (controlId: string, value: ParamValue) => {
      setParam(controlId, value);
      if (controlId === WAVE_SHAPE_CONTROL_ID) {
        const mapped = waveShapeValueToLfoShape(value);
        if (mapped && mapped !== sound.lfoShape) {
          setSoundState({ ...sound, lfoShape: mapped });
        }
      }
    },
    [setParam, sound, setSoundState],
  );

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
                  rows.map((c) => {
                    // Only ever true for Static Choir's own known
                    // mock-only control ids, and only while Sound is on
                    // — see the constant's doc above.
                    const inert = sound.enabled && STATIC_CHOIR_MOCK_ONLY_CONTROL_IDS.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={inert ? s.controlRowInert : undefined}
                        data-inert={inert ? 'true' : undefined}
                        title={inert ? 'Sound is driving this waveform directly — this control has no effect right now.' : undefined}
                      >
                        <ControlRow
                          control={c}
                          value={params[c.id] ?? null}
                          dirty={dirty.has(c.id)}
                          onChange={(v) => handleParamChange(c.id, v)}
                          onReset={() => resetParam(c.id)}
                        />
                      </div>
                    );
                  })}
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
