'use client';

import { useState } from 'react';
import { Button, Field, IconButton, Select, Slider, formatValue } from '@/components/ui';
import { CloseIcon, ChevronDownIcon, ChevronRightIcon, ResetIcon } from '@/components/ui';
import { MOD_SOURCES, defaultAmountFor, defaultSmoothingFor, sourceMeta } from '@/lib/modulation/bus';
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

/** Shape of a routing before anything's been chosen for this control —
    `amount` used to be a flat 0.3 here regardless of the control it was
    about to be attached to. Amount is now computed per-control at the
    ModRow call site (defaultAmountFor(control), modulation diagnostic
    2026-09 fix #5) since a fixed default constant can't know a
    particular control's range; everything else about a not-yet-assigned
    routing (source, rate, smoothing) is still genuinely control-
    independent, so those stay here. */
const DEFAULT_MOD_BASE: Omit<Modulation, 'amount'> = { source: 'lfo.sine', rate: 0.4, smoothing: 0 };

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
          onChange={(next) => setModulation(control.id, next)}
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

/**
 * A single control's modulation routing — source, amount, rate, smoothing,
 * assign/remove. Exported (Phase 4.96) so the VFX rack can reuse this exact
 * UI for an effect param's routing via its own `onChange`, rather than
 * duplicating the whole assignment surface for a second modulatable-thing
 * — see IMPLEMENTATION_PLAN.md §7 Phase 4.96's "one modulation system, not
 * two" decision. `onChange` replaces a direct `useInspectorStore` call so
 * this component has no opinion on WHERE a routing is stored (asset-level
 * `mod` vs. an effect instance's own `mod`) — only that it changed.
 */
export function ModRow({
  control,
  active,
  trackLoaded,
  micEnabled,
  expanded,
  onToggleExpand,
  onChange,
  hideHeader = false,
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
  /** Called with the next Modulation (or null to remove) whenever this
      row's routing changes — see this function's own doc for why this
      replaced a direct store call. */
  onChange: (mod: Modulation | null) => void;
  /** Phase 4.96 — VfxPanel embeds this component but already renders its
      own header (dot/label/source-tag equivalent, plus its own expand
      affordance) above each param it's routing. Without this, ModRow's
      OWN header rendered too — a second "Mix" label stacked directly
      under a caller-provided one that already said the same thing.
      `false` (the default) preserves ModulationPanel's own top-level
      usage exactly as before. */
  hideHeader?: boolean;
}) {
  // Modulation diagnostic (2026-09), fix #5 — the fallback default is
  // now sized against THIS control's own range (defaultAmountFor), not
  // a flat constant every control used to share regardless of how wide
  // or narrow its own span was.
  const current = active ?? { ...DEFAULT_MOD_BASE, amount: defaultAmountFor(control) };
  const meta = sourceMeta(current.source);

  const update = (patch: Partial<Modulation>) => {
    // Writing before an explicit "Assign" click is deliberate here — unlike
    // the old popover, this panel stays open the whole time you're tuning,
    // so there is no separate save step to forget.
    onChange({ ...current, ...patch });
  };

  return (
    <div className={s.modPanelRow} data-active={active ? 'true' : undefined}>
      {!hideHeader && (
        <button type="button" className={s.modPanelRowHead} onClick={onToggleExpand}>
          <span className={s.modPanelDot} data-on={active ? 'true' : undefined} />
          <span className={s.modPanelLabel}>{control.label}</span>
          {active && <span className={s.modPanelSourceTag}>{sourceMeta(active.source)?.label}</span>}
        </button>
      )}

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
                    ? `${o.label} — load track`
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

                const nextSource = v as ModSource;
                // Modulation diagnostic (2026-09), fix #4 — switching
                // manually into Audio/Mic used to leave smoothing at
                // whatever it already was (0, for any routing that
                // hadn't been through SoundPanel's auto-assign path),
                // which is how a hand-assigned Audio/Mic routing stayed
                // just as jump-prone as the bug this whole pass fixes.
                // Only applies when the current value is still exactly
                // 0 — i.e. nobody has deliberately dialed in their own
                // smoothing for this routing yet — so this never
                // overwrites a real, considered choice; it only fills
                // in a sensible starting point the first time a source
                // switch makes one newly relevant.
                const smoothing =
                  current.smoothing === 0 || current.smoothing === undefined
                    ? defaultSmoothingFor(nextSource)
                    : current.smoothing;

                update({ source: nextSource, smoothing });
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
              <Button variant="danger" block onClick={() => onChange(null)}>
                Remove
              </Button>
            ) : (
              <Button variant="accent" block onClick={() => onChange(current)}>
                Assign
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
