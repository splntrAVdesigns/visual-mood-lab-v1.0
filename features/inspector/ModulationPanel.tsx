'use client';

import { useState } from 'react';
import { Button, Field, IconButton, Select, Slider, formatValue } from '@/components/ui';
import { CloseIcon, ChevronDownIcon, ChevronRightIcon, ResetIcon } from '@/components/ui';
import { MOD_SOURCES, sourceMeta } from '@/lib/modulation/bus';
import { useTrackLoaded, useMicEnabled } from '@/lib/hooks/useTrackState';
import { RateStrip } from './controls/RateStrip';
import type { Control, Modulation, ModSource } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

interface ModulationPanelProps {
  controls: Control[];
  /** Which card's routings these are — needed as of Phase 4.9 to know
      whether THIS card has a track loaded, since audio.* sources are
      resolved per-card (see lib/modulation/bus.ts's class doc) rather
      than being globally available the moment they're implemented.
      Phase 4.9.2 adds mic.* alongside it, gated the same way per-card
      even though the underlying stream is shared app-wide — see
      lib/sound/mic.ts's top doc. */
  itemId: string;
  onClose: () => void;
  /**
   * Render inline inside an existing scroll region instead of as a fixed
   * sidecar. The mobile focused view already owns one scrolling column and
   * a close affordance of its own, so the sidecar chrome — fixed width,
   * own border, own header close button — would be duplicated furniture.
   */
  embedded?: boolean;
}

const DEFAULT_MOD: Modulation = { source: 'lfo.sine', amount: 0.3, rate: 0.4, smoothing: 0 };

/**
 * Every modulatable control on the open asset, in one place, each with its
 * own routing.
 *
 * Replaces the right-click popover entirely. Right-click on a slider looked
 * correct at every layer I could verify in code — the schema data, the event
 * wiring, the z-index stacking — and I could not pin down why it wasn't
 * reliably reaching people in practice. Rather than keep chasing an
 * unreproducible input-handling gap, this makes modulation a visible button
 * with a persistent panel instead of a hidden gesture, which sidesteps the
 * question of whether right-click behaves consistently across browsers and
 * trackpads at all.
 *
 * Structurally the twin of CodePanel: a sidecar beside the focused view,
 * shrinking it rather than covering it, using the exact same slide-in
 * mechanism — so this cost no new layout code, only a new list.
 */
export function ModulationPanel({ controls, itemId, onClose, embedded = false }: ModulationPanelProps) {
  const mod = useInspectorStore((st) => st.mod);
  const setModulation = useInspectorStore((st) => st.setModulation);
  const trackLoaded = useTrackLoaded(itemId);
  const micEnabled = useMicEnabled(itemId);
  const [expanded, setExpanded] = useState<string | null>(controls[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState(false);

  const routedIds = Object.keys(mod);
  // Same removal path each ModRow's own "Remove" button already uses
  // (setModulation(id, null)), just applied to every routed control on
  // this card in one action instead of one at a time — no separate
  // "clear all" store action needed.
  const resetAll = () => {
    for (const id of routedIds) setModulation(id, null);
  };

  const rows = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
        {controls.length === 0 && (
          <p className={s.notice}>Nothing on this asset can be modulated.</p>
        )}

      {controls.map((control) => (
        <ModRow
          key={control.id}
          control={control}
          active={mod[control.id]}
          trackLoaded={trackLoaded}
          micEnabled={micEnabled}
          expanded={expanded === control.id}
          onToggleExpand={() => setExpanded((e) => (e === control.id ? null : control.id))}
        />
      ))}
    </div>
  );

  if (embedded) return rows;

  return (
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(e) => e.stopPropagation()} aria-label="Modulation">
      <header className={s.codeHeader}>
        <IconButton
          label={collapsed ? 'Expand modulation' : 'Collapse modulation'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className={s.codeTitle}>Modulation</span>
        <span className={s.codeMeta}>
          {routedIds.length} of {controls.length} routed
        </span>
        <IconButton
          label="Remove all modulation"
          icon={<ResetIcon />}
          onClick={resetAll}
          disabled={routedIds.length === 0}
        />
        <IconButton label="Close modulation" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {rows}
    </aside>
  );
}

function ModRow({
  control,
  active,
  trackLoaded,
  micEnabled,
  expanded,
  onToggleExpand,
}: {
  control: Control;
  active: Modulation | undefined;
  /** Whether THIS card has an uploaded track — see ModulationPanelProps'
      itemId doc. Only changes which audio.* options are selectable; every
      other source's availability is unaffected. */
  trackLoaded: boolean;
  /** Whether THIS card has Mic toggled on — see ModulationPanelProps'
      itemId doc. Only changes which mic.* options are selectable, same
      relationship trackLoaded has to audio.* above. */
  micEnabled: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const setModulation = useInspectorStore((st) => st.setModulation);
  const current = active ?? DEFAULT_MOD;
  const meta = sourceMeta(current.source);

  const update = (patch: Partial<Modulation>) => {
    // Writing before an explicit "Assign" click is deliberate here — unlike
    // the old popover, this panel stays open the whole time you're tuning,
    // so there is no separate save step to forget.
    setModulation(control.id, { ...current, ...patch });
  };

  return (
    <div className={s.modPanelRow} data-active={active ? 'true' : undefined}>
      <button type="button" className={s.modPanelRowHead} onClick={onToggleExpand}>
        <span className={s.modPanelDot} data-on={active ? 'true' : undefined} />
        <span className={s.modPanelLabel}>{control.label}</span>
        {active && <span className={s.modPanelSourceTag}>{sourceMeta(active.source)?.label}</span>}
      </button>

      {expanded && (
        <div className={s.modPanelBody}>
          <Field label="Source">
            <Select
              label={`${control.label} modulation source`}
              value={current.source}
              options={MOD_SOURCES.map((o) => ({
                value: o.value,
                label: o.pending
                  ? `${o.label} — soon`
                  : o.requiresTrack && !trackLoaded
                    ? `${o.label} — load a track`
                    : o.requiresMic && !micEnabled
                      ? `${o.label} — enable mic`
                      : o.label,
              }))}
              onChange={(v) => {
                const opt = MOD_SOURCES.find((o) => o.value === (v as ModSource));
                if (
                  opt?.pending ||
                  (opt?.requiresTrack && !trackLoaded) ||
                  (opt?.requiresMic && !micEnabled)
                )
                  return;
                update({ source: v as ModSource });
              }}
            />
          </Field>

          <Field label="Amount" value={formatValue(current.amount, 0.01)}>
            <Slider
              label={`${control.label} modulation amount`}
              value={current.amount}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => update({ amount: v })}
            />
          </Field>

          {/* hasRate is only ever set true (the lfo sources, or time) or left
              undefined (pointer.*, audio.*, midi.cc) — MOD_SOURCES never sets it to
              false explicitly. `!== false` therefore showed Rate for every
              undeclared source too, including Audio, where bus.ts's
              rawSignal() never reads mod.rate at all: a fully interactive
              control that silently did nothing. This must be an allowlist
              (=== true), not a denylist. */}
          {meta?.hasRate === true && (
            <Field label="Rate">
              <RateStrip
                label={`${control.label} modulation`}
                hz={current.rate ?? 0.4}
                onChange={(v) => update({ rate: v })}
              />
            </Field>
          )}

          <Field label="Smoothing" value={formatValue(current.smoothing ?? 0, 0.01)}>
            <Slider
              label={`${control.label} modulation smoothing`}
              value={current.smoothing ?? 0}
              min={0}
              max={0.95}
              step={0.01}
              onChange={(v) => update({ smoothing: v })}
            />
          </Field>

          <div className={s.modPanelRowFoot}>
            {active ? (
              <Button variant="danger" block onClick={() => setModulation(control.id, null)}>
                Remove
              </Button>
            ) : (
              <Button variant="accent" block onClick={() => setModulation(control.id, current)}>
                Assign
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
