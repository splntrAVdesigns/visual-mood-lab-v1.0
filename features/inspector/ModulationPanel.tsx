'use client';

import { useState } from 'react';
import { Button, Field, IconButton, Select, Slider, formatValue } from '@/components/ui';
import { CloseIcon, ChevronDownIcon, ChevronRightIcon, ResetIcon } from '@/components/ui';
import { MOD_SOURCES, defaultAmountFor, defaultSmoothingFor, sourceMeta } from '@/lib/modulation/bus';
import { useTrackLoaded, useMicEnabled } from '@/lib/hooks/useTrackState';
import { ControllerPanel } from '@/features/controllers/ControllerPanel';
import { RateStrip } from './controls/RateStrip';
import type { Control, Modulation, ModSource } from '@/renderers/control-schema';
import { useInspectorStore } from '@/stores';
import s from '../features.module.css';
import ui from './ModulationPanel.module.css';

interface ModulationPanelProps {
  controls: Control[];
  itemId: string;
  onClose: () => void;
  embedded?: boolean;
}

type ModulationView = 'signals' | 'controllers';

const DEFAULT_MOD_BASE: Omit<Modulation, 'amount'> = { source: 'lfo.sine', rate: 0.4, smoothing: 0 };

/** Controller sources now have their own transport-neutral Controllers tab.
 * Keep midi.cc as an internal compatibility token in the ModSource type, but
 * never surface the obsolete "MIDI CC — soon" option in signal routing. */
const SIGNAL_SOURCES = MOD_SOURCES.filter((source) => source.value !== 'midi.cc');

export function ModulationPanel({ controls, itemId, onClose, embedded = false }: ModulationPanelProps) {
  const mod = useInspectorStore((st) => st.mod);
  const setModulation = useInspectorStore((st) => st.setModulation);
  const trackLoaded = useTrackLoaded(itemId);
  const micEnabled = useMicEnabled(itemId);
  const [expanded, setExpanded] = useState<string | null>(controls[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ModulationView>('signals');

  const routedIds = Object.keys(mod);
  const resetAll = () => {
    for (const id of routedIds) setModulation(id, null);
  };

  const signalRows = (
    <div className={embedded ? s.modPanelListEmbedded : s.modPanelList}>
      {controls.length === 0 && <p className={s.notice}>Nothing on this asset can be modulated.</p>}
      {controls.map((control) => (
        <ModRow
          key={control.id}
          control={control}
          active={mod[control.id]}
          trackLoaded={trackLoaded}
          micEnabled={micEnabled}
          expanded={expanded === control.id}
          onToggleExpand={() => setExpanded((current) => current === control.id ? null : control.id)}
          onChange={(next) => setModulation(control.id, next)}
        />
      ))}
    </div>
  );

  const tabs = (
    <div className={ui.modeTabs} role="tablist" aria-label="Modulation mode">
      <button type="button" data-active={view === 'signals' ? 'true' : undefined} onClick={() => setView('signals')}>
        SIGNALS
      </button>
      <button type="button" data-active={view === 'controllers' ? 'true' : undefined} onClick={() => setView('controllers')}>
        CONTROLLERS
      </button>
    </div>
  );

  const content = view === 'signals' ? signalRows : <ControllerPanel itemId={itemId} />;

  if (embedded) {
    return (
      <div className={ui.embeddedRoot}>
        {tabs}
        {content}
      </div>
    );
  }

  return (
    <aside className={s.modPanel} data-collapsed={collapsed ? 'true' : undefined} onClick={(e) => e.stopPropagation()} aria-label="Modulation">
      <header className={s.codeHeader}>
        <IconButton
          label={collapsed ? 'Expand modulation' : 'Collapse modulation'}
          icon={collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          onClick={() => setCollapsed((current) => !current)}
        />
        <span className={s.codeTitle}>Modulation</span>
        <span className={s.codeMeta}>
          {view === 'signals' ? `${routedIds.length} of ${controls.length} routed` : 'controller setup'}
        </span>
        {view === 'signals' && (
          <IconButton
            label="Remove all signal modulation"
            icon={<ResetIcon />}
            onClick={resetAll}
            disabled={routedIds.length === 0}
          />
        )}
        <IconButton label="Close modulation" icon={<CloseIcon />} onClick={onClose} />
      </header>
      <div className={ui.desktopBody}>
        {tabs}
        {content}
      </div>
    </aside>
  );
}

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
  trackLoaded: boolean;
  micEnabled: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (mod: Modulation | null) => void;
  hideHeader?: boolean;
}) {
  const current = active ?? { ...DEFAULT_MOD_BASE, amount: defaultAmountFor(control) };
  const meta = sourceMeta(current.source);

  const update = (patch: Partial<Modulation>) => {
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
              value={current.source === 'midi.cc' ? 'lfo.sine' : current.source}
              options={SIGNAL_SOURCES.map((option) => ({
                value: option.value,
                label: option.requiresTrack && !trackLoaded
                  ? `${option.label} — load track`
                  : option.requiresMic && !micEnabled
                    ? `${option.label} — enable mic`
                    : option.label,
              }))}
              onChange={(value) => {
                const nextSource = value as ModSource;
                const option = SIGNAL_SOURCES.find((source) => source.value === nextSource);
                if (
                  (option?.requiresTrack && !trackLoaded) ||
                  (option?.requiresMic && !micEnabled)
                ) return;

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
              onChange={(value) => update({ amount: value })}
            />
          </Field>

          {meta?.hasRate === true && (
            <Field label="Rate">
              <RateStrip
                label={`${control.label} modulation`}
                hz={current.rate ?? 0.4}
                onChange={(value) => update({ rate: value })}
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
              onChange={(value) => update({ smoothing: value })}
            />
          </Field>

          <div className={s.modPanelRowFoot}>
            {active ? (
              <Button variant="danger" block onClick={() => onChange(null)}>Remove</Button>
            ) : (
              <Button variant="accent" block onClick={() => onChange(current)}>Assign</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
