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
import { groupedControls, isVisible, isDisabledByState, type ParamValue } from '@/renderers/control-schema';
import { selectSelectedAsset, useBoardStore, useInspectorStore } from '@/stores';
import { ASSET_TYPE_BADGE } from '@/types/asset';
import { WAVE_SHAPE_CONTROL_ID, waveShapeValueToLfoShape } from '@/lib/sound/types';
import { ControlRow } from './ControlRow';
import { RollBar } from './RollBar';
import { GroupLockButton } from './RollLocks';
import roll from './rollBar.module.css';
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
 * Waveform Layers/Layer Spread used to be here too, restricted to mock
 * mode only — every render style now respects them live as well
 * (duplicating the real trace across offset copies, same idea as the
 * mock generator's phase-varied layers, just without the phase
 * variation since there's only one real signal), so they're gone from
 * this set entirely rather than staying as a special case. What's left
 * is exactly the mock-only artifact still standing: the scanline roll
 * bands (every color/width/motion control belongs to that one feature,
 * scanlineColor included).
 *
 * Lives here rather than in lib/sound/ because this is inspector-layer
 * presentation knowledge about one specific tile's schema, not something
 * the sound engine itself needs to know — same reasoning as the
 * architecture doc's "the moment a shared component knows domain
 * knowledge, it moves to the feature that owns it."
 */
const STATIC_CHOIR_MOCK_ONLY_CONTROL_IDS = new Set([
  'scanlines',
  'scanlineColor',
  'scanlineWidth',
  'scanlineMotion',
  // Both only ever affect the procedural mock generator's own math
  // (waveValue()'s shape, and the lfoA/lfoB values LFO Rate drives) —
  // live mode reads real audio samples directly and has never used
  // either, so both were previously silently inert once Sound was on
  // instead of visibly graying out like their mock-only siblings above.
  'waveShape',
  'lfoRate',
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
          <RollBar />

          {groups.map(({ group, controls }) => {
            const isCollapsed = collapsed.has(group.id) || (group.collapsed && !collapsed.has(`!${group.id}`));

            const rows = controls
              .filter((c) => isVisible(c, params))
              .filter((c) => showAdvanced || !c.advanced);

            if (rows.length === 0) return null;

            return (
              <section key={group.id} className={s.group} data-lockgroup="true">
                <div className={roll.groupHeadRow}>
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
                <GroupLockButton label={group.label} controls={rows} />
                </div>

                {!isCollapsed &&
                  rows.map((c) => {
                    // True for Static Choir's remaining mock-only
                    // controls while Sound is on — see the constant's
                    // doc above.
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
                          forceDisabled={isDisabledByState(c, params)}
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
