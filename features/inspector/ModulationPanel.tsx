'use client';

import { useState } from 'react';
import { Button, Field, IconButton, Select, Slider, formatValue } from '@/components/ui';
import { CloseIcon } from '@/components/ui';
import { MOD_SOURCES, sourceMeta } from '@/lib/modulation/bus';
import type { Control, Modulation, ModSource } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';

interface ModulationPanelProps {
  controls: Control[];
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
export function ModulationPanel({ controls, onClose, embedded = false }: ModulationPanelProps) {
  const mod = useInspectorStore((st) => st.mod);
  const [expanded, setExpanded] = useState<string | null>(controls[0]?.id ?? null);

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
          expanded={expanded === control.id}
          onToggleExpand={() => setExpanded((e) => (e === control.id ? null : control.id))}
        />
      ))}
    </div>
  );

  if (embedded) return rows;

  return (
    <aside className={s.modPanel} onClick={(e) => e.stopPropagation()} aria-label="Modulation">
      <header className={s.codeHeader}>
        <span className={s.codeTitle}>Modulation</span>
        <span className={s.codeMeta}>
          {Object.keys(mod).length} of {controls.length} routed
        </span>
        <IconButton label="Close modulation" icon={<CloseIcon />} onClick={onClose} />
      </header>
      {rows}
    </aside>
  );
}

function ModRow({
  control,
  active,
  expanded,
  onToggleExpand,
}: {
  control: Control;
  active: Modulation | undefined;
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
                label: o.pending ? `${o.label} — soon` : o.label,
              }))}
              onChange={(v) => {
                const opt = MOD_SOURCES.find((o) => o.value === (v as ModSource));
                if (opt?.pending) return;
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

          {meta?.hasRate !== false && (
            <Field label="Rate" value={`${formatValue(current.rate ?? 0.4, 0.01)} Hz`}>
              <Slider
                label={`${control.label} modulation rate`}
                value={current.rate ?? 0.4}
                min={0.01}
                max={8}
                step={0.01}
                scale="log"
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
